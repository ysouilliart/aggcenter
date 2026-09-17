/**
 * Central runtime configuration, resolved from environment variables.
 *
 * All integrations default to safe local/mock implementations so the app runs
 * end-to-end with zero credentials. Point them at real services by setting the
 * documented env vars (see .env.example) — ideally via Cursor Secrets in a
 * Cloud Agent, never committed to the repo.
 */

import {
  type CashFilePrefixes,
  resolveCashFilePrefixes,
} from "./cash/paths";

export type StorageProviderName = "local" | "oci";
export type DataSourceName = "local" | "snowflake";

export type OciAuthMode = "swift" | "none";

export interface OciConfig {
  namespace?: string;
  bucket?: string;
  region?: string;
  // --- OCI Swift (OpenStack) API access ---
  /** Base URL, e.g. https://swiftobjectstorage.us-ashburn-1.oraclecloud.com
   *  (derived from region when omitted). Not secret. */
  swiftBaseUrl?: string;
  /** Swift username; "<namespace>:<user>" is built automatically if needed. */
  swiftUser?: string;
  /** Swift password / OCI auth token. Secret — never log or expose. */
  swiftPassword?: string;
  /** Which auth strategy the current environment can support. */
  authMode: OciAuthMode;
  /** True when a bucket and a usable auth strategy are present. */
  configured: boolean;
}

export interface SnowflakeConfig {
  account?: string;
  database?: string;
  warehouse?: string;
  schema?: string;
  role?: string;
  user?: string;
  configured: boolean;
}

export interface AppConfig {
  storageProvider: StorageProviderName;
  dataSource: DataSourceName;
  reportingCurrency: string;
  oci: OciConfig;
  snowflake: SnowflakeConfig;
  /** Optional base URL for pulling reference data from an external API. */
  externalApiBaseUrl?: string;
  /**
   * UK cash-management layout: one org root plus INV_112 / PO_112 / SO_112 /
   * REM_112 / BANK_112 prefixes. CSV and PDF statements default to BANK_112.
   */
  cashFiles: CashFilePrefixes;
  /** CSV ingest prefix (`{orgRoot}/BANK_112/<accountId>/<file>.csv`). */
  statementCsvPrefix: string;
  /** PDF ingest prefix (`{orgRoot}/BANK_112/<bankCode>/<file>.pdf`). */
  statementPdfPrefix: string;
  referenceApPrefix: string;
  referencePoPrefix: string;
  referenceSalesOrderPrefix: string;
  referenceRemittancePrefix: string;
  /** Supplier master-data prefix (`supplier/<extract>.csv`). */
  supplierPrefix: string;
  /** Fusion FBDI output prefix (`aggcenter/FBDI/supplier/<batch>/`). */
  supplierFbdiPrefix: string;
  /** Invoice parser drop-zone root (`aggcenter/invoices/{landing,received,processed,archived,anomaly}/`). */
  invoicePrefix: string;
  /** When true, empty landing is seeded from bundled sample invoices. Off by default. */
  invoiceSeedSamples: boolean;
  /** Invoice classify strategy (static regex/overlays vs schema-constrained LLM). */
  invoiceClassify: InvoiceClassifyConfig;
  /** People-docs parser root (`aggcenter/peopleDocs/{landing,processed,archived,anomaly}/`). */
  peopleDocsPrefix: string;
  /** When true, empty landing is seeded from bundled sample people docs. Off by default. */
  peopleDocsSeedSamples: boolean;
  /** People-docs classify — independent of invoice LLM (own kill switch + key). */
  peopleDocsClassify: InvoiceClassifyConfig;
  /** EU VIES REST API base (no trailing path). Public, no key. */
  viesApiUrl: string;
}

export interface InvoiceClassifyConfig {
  /** `INVOICE_LLM_CLASSIFY` — on by default when an API key is present. */
  llmEnabled: boolean;
  /** Enabled and an API key is configured. */
  llmReady: boolean;
  /** Use Hotjar/Tesla/Origin (and high-confidence static) without calling the LLM. */
  staticFastPath: boolean;
  /** Detected chat provider (OpenAI-compatible). */
  provider: "openai" | "xai";
  model: string;
  apiBase: string;
  /** Secret — never log or return to the client. */
  apiKey?: string;
  timeoutMs: number;
  /** Operator-facing reason the static parser is in use. */
  warning?: string;
}

function bool(value: string | undefined): boolean {
  return value != null && value.trim().length > 0;
}

function flag(value: string | undefined, defaultValue = false): boolean {
  if (value == null || value.trim() === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function resolveInvoiceClassifyConfig(
  env: Record<string, string | undefined> = process.env,
): InvoiceClassifyConfig {
  const invoiceKey = env.INVOICE_LLM_API_KEY?.trim() || undefined;
  const xaiKey = env.XAI_API_KEY?.trim() || undefined;
  const openaiKey = env.OPENAI_API_KEY?.trim() || undefined;
  const apiKey = firstNonEmpty(invoiceKey, xaiKey, openaiKey);
  const explicitBase = env.INVOICE_LLM_API_BASE?.trim() || undefined;
  const looksXai =
    Boolean(explicitBase?.includes("api.x.ai")) ||
    Boolean(apiKey?.startsWith("xai-")) ||
    Boolean(xaiKey && apiKey === xaiKey);
  const provider: "openai" | "xai" = looksXai ? "xai" : "openai";
  const llmEnabled = flag(env.INVOICE_LLM_CLASSIFY, bool(apiKey));
  const llmReady = llmEnabled && bool(apiKey);
  const staticFastPath = flag(env.INVOICE_STATIC_FAST_PATH, true);
  const model =
    env.INVOICE_LLM_MODEL?.trim() ||
    (provider === "xai" ? "grok-4-fast-non-reasoning" : "gpt-4o-mini");
  const apiBase = (
    explicitBase || (provider === "xai" ? "https://api.x.ai/v1" : "https://api.openai.com/v1")
  ).replace(/\/+$/, "");
  const timeoutMs = Number(env.INVOICE_LLM_TIMEOUT_MS);
  let warning: string | undefined;
  if (!bool(apiKey)) {
    warning =
      "LLM classify is off. Add INVOICE_LLM_API_KEY (or OPENAI_API_KEY / XAI_API_KEY) to enable. Using the static parser.";
  } else if (!llmEnabled) {
    warning = "LLM classify is off (INVOICE_LLM_CLASSIFY=false). Using the static vendor/regex parser.";
  }
  return {
    llmEnabled,
    llmReady,
    staticFastPath,
    provider,
    model,
    apiBase,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
    warning,
  };
}

/**
 * People-docs classify is independent of invoices.
 * A dedicated PEOPLE_DOCS_LLM_API_KEY turns people LLM on (production HR).
 * PEOPLE_DOCS_LLM_CLASSIFY=false only blocks lab fallback from invoice/OpenAI/xAI
 * keys — it does not ignore a dedicated people-docs key.
 * When the people key is unset, auto-enable uses INVOICE_LLM_API_KEY /
 * OPENAI_API_KEY / XAI_API_KEY unless PEOPLE_DOCS_LLM_CLASSIFY=false.
 */
export function resolvePeopleDocsClassifyConfig(
  env: Record<string, string | undefined> = process.env,
): InvoiceClassifyConfig {
  const invoice = resolveInvoiceClassifyConfig(env);
  const dedicatedKey = env.PEOPLE_DOCS_LLM_API_KEY?.trim() || undefined;
  const labFallbackKey = firstNonEmpty(
    env.INVOICE_LLM_API_KEY,
    env.OPENAI_API_KEY,
    env.XAI_API_KEY,
  );
  const classifyFlag = env.PEOPLE_DOCS_LLM_CLASSIFY;
  const forcedOff =
    classifyFlag != null && classifyFlag.trim() !== "" && !flag(classifyFlag, true);
  // Dedicated HR key always enables people LLM. The kill switch only blocks
  // using an invoice/OpenAI/xAI key as a lab fallback.
  const apiKey = dedicatedKey ?? (forcedOff ? undefined : labFallbackKey);
  const llmEnabled = bool(dedicatedKey) || (!forcedOff && bool(apiKey));
  const llmReady = llmEnabled && bool(apiKey);
  const explicitBase = env.PEOPLE_DOCS_LLM_API_BASE?.trim() || undefined;
  const looksXai =
    Boolean(explicitBase?.includes("api.x.ai")) ||
    Boolean(apiKey?.startsWith("xai-")) ||
    Boolean(env.XAI_API_KEY?.trim() && apiKey === env.XAI_API_KEY.trim());
  const provider: "openai" | "xai" = looksXai ? "xai" : invoice.provider;
  const model =
    env.PEOPLE_DOCS_LLM_MODEL?.trim() ||
    invoice.model ||
    (provider === "xai" ? "grok-4-fast-non-reasoning" : "gpt-4o-mini");
  const apiBase = (
    explicitBase ||
    invoice.apiBase ||
    (provider === "xai" ? "https://api.x.ai/v1" : "https://api.openai.com/v1")
  ).replace(/\/+$/, "");
  const timeoutOverride = Number(env.PEOPLE_DOCS_LLM_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutOverride) && timeoutOverride > 0
      ? timeoutOverride
      : Math.max(invoice.timeoutMs, 45_000);
  let warning: string | undefined;
  if (!bool(apiKey)) {
    if (forcedOff) {
      warning =
        "People docs LLM classify is off (PEOPLE_DOCS_LLM_CLASSIFY=false) and no PEOPLE_DOCS_LLM_API_KEY is set. Using the static parser. Invoice classify is unchanged.";
    } else {
      warning =
        "People docs LLM classify is off. Add PEOPLE_DOCS_LLM_API_KEY for production HR, or a lab fallback INVOICE_LLM_API_KEY / OPENAI_API_KEY / XAI_API_KEY. Using the static parser.";
    }
  }
  return {
    llmEnabled,
    llmReady,
    staticFastPath: invoice.staticFastPath,
    provider,
    model,
    apiBase,
    apiKey,
    timeoutMs,
    warning,
  };
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveOciConfig(): OciConfig {
  const swiftUser = process.env.OCI_SWIFT_USER;
  const swiftPassword = process.env.OCI_SWIFT_PASSWORD;
  const swiftBaseUrl = process.env.OCI_SWIFT_BASE_URL;
  const namespace = process.env.OCI_NAMESPACE;
  const bucket = process.env.OCI_BUCKET;
  const region = process.env.OCI_REGION;

  // A container URL can be resolved either from a full base URL (already
  // containing /v1/{namespace}/{bucket}), or from host/region + namespace + bucket.
  const hasFullPathBase = bool(swiftBaseUrl) && swiftBaseUrl!.includes("/v1/");
  const canResolveUrl =
    hasFullPathBase ||
    ((bool(swiftBaseUrl) || bool(region)) && bool(namespace) && bool(bucket));

  // Swift needs Basic Auth credentials plus a resolvable container URL.
  const hasSwift = bool(swiftUser) && bool(swiftPassword) && canResolveUrl;

  const authMode: OciAuthMode = hasSwift ? "swift" : "none";

  return {
    namespace,
    bucket,
    region,
    swiftBaseUrl,
    swiftUser,
    swiftPassword,
    authMode,
    configured: authMode !== "none",
  };
}

export function getConfig(): AppConfig {
  const oci = resolveOciConfig();

  const snowflake: SnowflakeConfig = {
    account: process.env.SNOWFLAKE_ACCOUNT,
    database: process.env.SNOWFLAKE_DATABASE,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    role: process.env.SNOWFLAKE_ROLE,
    user: process.env.SNOWFLAKE_USER,
    configured:
      bool(process.env.SNOWFLAKE_ACCOUNT) &&
      bool(process.env.SNOWFLAKE_USER) &&
      bool(process.env.SNOWFLAKE_DATABASE),
  };

  const storageProvider =
    (process.env.STORAGE_PROVIDER as StorageProviderName) ||
    (oci.configured ? "oci" : "local");

  const dataSource =
    (process.env.DATA_SOURCE as DataSourceName) ||
    (snowflake.configured ? "snowflake" : "local");

  const cashFiles = resolveCashFilePrefixes();
  const invoiceClassify = resolveInvoiceClassifyConfig();
  const peopleDocsClassify = resolvePeopleDocsClassifyConfig();

  return {
    storageProvider,
    dataSource,
    reportingCurrency: process.env.REPORTING_CURRENCY || "USD",
    oci,
    snowflake,
    externalApiBaseUrl: process.env.EXTERNAL_API_BASE_URL,
    cashFiles,
    statementCsvPrefix: cashFiles.statementCsv,
    statementPdfPrefix: cashFiles.statementPdf,
    referenceApPrefix: cashFiles.inv,
    referencePoPrefix: cashFiles.po,
    referenceSalesOrderPrefix: cashFiles.so,
    referenceRemittancePrefix: cashFiles.rem,
    supplierPrefix: withTrailingSlash(process.env.SUPPLIER_PREFIX || "supplier"),
    supplierFbdiPrefix: withTrailingSlash(
      process.env.SUPPLIER_FBDI_PREFIX || "aggcenter/FBDI/supplier",
    ),
    invoicePrefix: withTrailingSlash(
      process.env.INVOICE_PREFIX || "aggcenter/invoices",
    ),
    invoiceSeedSamples: flag(process.env.INVOICE_SEED_SAMPLES, false),
    invoiceClassify,
    peopleDocsPrefix: withTrailingSlash(
      process.env.PEOPLE_DOCS_PREFIX || "aggcenter/peopleDocs",
    ),
    peopleDocsSeedSamples: flag(process.env.PEOPLE_DOCS_SEED_SAMPLES, false),
    peopleDocsClassify,
    viesApiUrl: (process.env.VIES_API_URL || "https://ec.europa.eu/taxation_customs/vies/rest-api").replace(
      /\/+$/,
      "",
    ),
  };
}
