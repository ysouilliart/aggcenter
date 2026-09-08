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
}

function bool(value: string | undefined): boolean {
  return value != null && value.trim().length > 0;
}

function resolveOciConfig(): OciConfig {
  const swiftUser = process.env.OCI_SWIFT_USER;
  const swiftPassword = process.env.OCI_SWIFT_PASSWORD;
  const swiftBaseUrl = process.env.OCI_SWIFT_BASE_URL;

  // Swift needs credentials, a bucket, a namespace, and either an explicit base
  // URL or a region to derive it from.
  const hasSwift =
    bool(swiftUser) &&
    bool(swiftPassword) &&
    bool(process.env.OCI_BUCKET) &&
    bool(process.env.OCI_NAMESPACE) &&
    (bool(swiftBaseUrl) || bool(process.env.OCI_REGION));

  const authMode: OciAuthMode = hasSwift ? "swift" : "none";

  return {
    namespace: process.env.OCI_NAMESPACE,
    bucket: process.env.OCI_BUCKET,
    region: process.env.OCI_REGION,
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
  };
}
