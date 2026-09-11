/**
 * Central runtime configuration, resolved from environment variables.
 *
 * All integrations default to safe local/mock implementations so the app runs
 * end-to-end with zero credentials. Point them at real services by setting the
 * documented env vars (see .env.example) — ideally via Cursor Secrets in a
 * Cloud Agent, never committed to the repo.
 */

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
  /** CSV ingest prefix (`inbox/<accountId>/<file>.csv`). */
  statementCsvPrefix: string;
  /** PDF ingest prefix (`aggCenter/bankStatements/<bankCode>/<file>.pdf`). */
  statementPdfPrefix: string;
  referenceApPrefix: string;
  referenceSalesOrderPrefix: string;
  referenceRemittancePrefix: string;
}

function bool(value: string | undefined): boolean {
  return value != null && value.trim().length > 0;
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

  return {
    storageProvider,
    dataSource,
    reportingCurrency: process.env.REPORTING_CURRENCY || "USD",
    oci,
    snowflake,
    externalApiBaseUrl: process.env.EXTERNAL_API_BASE_URL,
    statementCsvPrefix: withTrailingSlash(
      process.env.STATEMENT_CSV_PREFIX || "inbox",
    ),
    statementPdfPrefix: withTrailingSlash(
      process.env.STATEMENT_PDF_PREFIX || "aggCenter/bankStatements",
    ),
    referenceApPrefix: withTrailingSlash(
      process.env.REFERENCE_AP_PREFIX || "aggCenter/APInvoices",
    ),
    referenceSalesOrderPrefix: withTrailingSlash(
      process.env.REFERENCE_SO_PREFIX || "aggCenter/salesOrder",
    ),
    referenceRemittancePrefix: withTrailingSlash(
      process.env.REFERENCE_REMITTANCE_PREFIX || "aggCenter/remittance",
    ),
  };
}
