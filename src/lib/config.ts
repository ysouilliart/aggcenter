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

export interface OciConfig {
  namespace?: string;
  bucket?: string;
  region?: string;
  /** Path to an OCI config/key file, when using file-based auth. */
  configFile?: string;
  /** True when the minimum settings to attempt a real connection are present. */
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

export function getConfig(): AppConfig {
  const oci: OciConfig = {
    namespace: process.env.OCI_NAMESPACE,
    bucket: process.env.OCI_BUCKET,
    region: process.env.OCI_REGION,
    configFile: process.env.OCI_CONFIG_FILE,
    configured:
      bool(process.env.OCI_NAMESPACE) &&
      bool(process.env.OCI_BUCKET) &&
      bool(process.env.OCI_REGION),
  };

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
