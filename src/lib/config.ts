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
   * UK cash-management layout: one org root plus inv/po/so/rem/bank prefixes.
   * `statementCsvPrefix` / `statementPdfPrefix` default to `bank`.
   */
  cashFiles: CashFilePrefixes;
  /** CSV ingest prefix (`{orgRoot}/bank/<accountId>/<file>.csv`). */
  statementCsvPrefix: string;
  /** PDF ingest prefix (`{orgRoot}/bank/<bankCode>/<file>.pdf`). */
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
  /** EU VIES REST API base (no trailing path). Public, no key. */
  viesApiUrl: string;
}

export interface InvoiceClassifyConfig {
  /** `INVOICE_LLM_CLASSIFY` — request the LLM path when a key is also present. */
  llmEnabled: boolean;
  /** Enabled and an API key is configured. */
  llmReady: boolean;
  /** Use Hotjar/Tesla/Origin (and high-confidence static) without calling the LLM. */
  staticFastPath: boolean;
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

function resolveInvoiceClassifyConfig(): InvoiceClassifyConfig {
  const llmEnabled = flag(process.env.INVOICE_LLM_CLASSIFY, false);
  const apiKey = process.env.INVOICE_LLM_API_KEY?.trim() || undefined;
  const llmReady = llmEnabled && bool(apiKey);
  const staticFastPath = flag(process.env.INVOICE_STATIC_FAST_PATH, true);
  const model = process.env.INVOICE_LLM_MODEL?.trim() || "gpt-4o-mini";
  const apiBase = (process.env.INVOICE_LLM_API_BASE?.trim() || "https://api.openai.com/v1").replace(
    /\/+$/,
    "",
  );
  const timeoutMs = Number(process.env.INVOICE_LLM_TIMEOUT_MS);
  let warning: string | undefined;
  if (!llmEnabled) {
    warning = "LLM classify is off. Using the static vendor/regex parser.";
  } else if (!llmReady) {
    warning =
      "LLM classify is enabled but INVOICE_LLM_API_KEY is missing. Using the static parser.";
  }
  return {
    llmEnabled,
    llmReady,
    staticFastPath,
    model,
    apiBase,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
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
    invoiceClassify: resolveInvoiceClassifyConfig(),
    viesApiUrl: (process.env.VIES_API_URL || "https://ec.europa.eu/taxation_customs/vies/rest-api").replace(
      /\/+$/,
      "",
    ),
  };
}
