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

export type OciAuthMode = "simple" | "configfile" | "none";

export interface OciConfig {
  namespace?: string;
  bucket?: string;
  region?: string;
  /** Path to an OCI config/key file, when using file-based auth. */
  configFile?: string;
  configProfile?: string;
  // --- Simple (env-based) auth. Secret values; never log or expose these. ---
  tenancy?: string;
  user?: string;
  fingerprint?: string;
  passphrase?: string;
  /** PEM private key (may contain literal \n which we normalize). */
  privateKey?: string;
  /** Base64-encoded PEM private key (preferred for single-line env/secrets). */
  privateKeyB64?: string;
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
  const hasSimple =
    bool(process.env.OCI_TENANCY) &&
    bool(process.env.OCI_USER) &&
    bool(process.env.OCI_FINGERPRINT) &&
    (bool(process.env.OCI_PRIVATE_KEY) || bool(process.env.OCI_PRIVATE_KEY_B64)) &&
    bool(process.env.OCI_REGION);
  const hasConfigFile = bool(process.env.OCI_CONFIG_FILE);

  const authMode: OciAuthMode = hasSimple
    ? "simple"
    : hasConfigFile
      ? "configfile"
      : "none";

  return {
    namespace: process.env.OCI_NAMESPACE,
    bucket: process.env.OCI_BUCKET,
    region: process.env.OCI_REGION,
    configFile: process.env.OCI_CONFIG_FILE,
    configProfile: process.env.OCI_CONFIG_PROFILE,
    tenancy: process.env.OCI_TENANCY,
    user: process.env.OCI_USER,
    fingerprint: process.env.OCI_FINGERPRINT,
    passphrase: process.env.OCI_PRIVATE_KEY_PASSPHRASE,
    privateKey: process.env.OCI_PRIVATE_KEY,
    privateKeyB64: process.env.OCI_PRIVATE_KEY_B64,
    authMode,
    configured: bool(process.env.OCI_BUCKET) && authMode !== "none",
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
