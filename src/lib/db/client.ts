import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

let pool: Pool | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

/**
 * Lazily create the Drizzle client over a node-postgres pool. Works with a local
 * Postgres and with Neon (over the pooled connection string in the Node runtime).
 * TLS is enabled automatically for Neon / `sslmode=require` connections.
 */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (!db) {
    const needsSsl = /neon\.tech|sslmode=require/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: needsSsl
        ? { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "true" }
        : undefined,
    });
    db = drizzle(pool, { schema });
  }
  return db;
}
