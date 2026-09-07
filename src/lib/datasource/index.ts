import { getConfig } from "../config";
import { LocalDataSource } from "./local";
import { SnowflakeDataSource } from "./snowflake";
import type { DataSource } from "./types";

export type { DataSource, StatementManifestEntry } from "./types";

let cached: DataSource | null = null;

/**
 * Resolve the active reference DataSource. Uses Snowflake when explicitly
 * selected and configured; otherwise falls back to bundled sample data.
 */
export function getDataSource(): DataSource {
  if (cached) return cached;

  const config = getConfig();
  if (config.dataSource === "snowflake" && config.snowflake.configured) {
    cached = new SnowflakeDataSource(config.snowflake);
  } else {
    cached = new LocalDataSource();
  }
  return cached;
}
