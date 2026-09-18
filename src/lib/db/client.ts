import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema";

type AppDb = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __aggcPgPool?: Pool;
  __aggcDb?: AppDb;
};

let pool: Pool | undefined;
let db: AppDb | undefined;

/** Fail connect before a ~15s Neon/pg `timeout expired` and well under a ~22s hung Next request. */
export const CONNECT_TIMEOUT_MS = 5_000;
export const STATEMENT_TIMEOUT_MS = 8_000;
export const REQUEST_TIMEOUT_MS = 8_000;
const IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_POOL_MAX = 5;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

/**
 * Drop sslmode from the URL so pg-connection-string does not override an
 * explicit `ssl` object (and so require/prefer/verify-ca do not emit the
 * verify-full deprecation warning on every boot).
 */
export function stripSslMode(url: string): string {
  return url
    .replace(/([?&])sslmode=[^&]*/gi, (match, prefix: string) => (prefix === "?" ? "?" : ""))
    .replace(/\?&/, "?")
    .replace(/[?&]$/, "");
}

export function poolOptionsFromDatabaseUrl(url: string): PoolConfig {
  const noVerify =
    process.env.DATABASE_SSL_NO_VERIFY === "true" || /[?&]sslmode=no-verify(?:&|$)/i.test(url);
  const disableSsl = /[?&]sslmode=disable(?:&|$)/i.test(url);
  const neon = /neon\.tech/i.test(url);
  const sslmode = /[?&]sslmode=([^&]+)/i.exec(url)?.[1];
  const wantsSsl = !disableSsl && (neon || Boolean(sslmode && sslmode !== "disable"));
  const max = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);

  return {
    connectionString: stripSslMode(url),
    ssl: wantsSsl ? { rejectUnauthorized: !noVerify } : undefined,
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_POOL_MAX,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS,
  };
}

/**
 * Turn a Drizzle / pg failure into a short public message. Prefer the driver
 * cause over the full SQL text so a hung Neon connection reads as unreachable
 * instead of a giant "Failed query: select …" blob.
 */
export function formatDbError(err: unknown, fallback = "Database query failed"): string {
  if (!(err instanceof Error)) return fallback;
  const cause = err.cause instanceof Error ? err.cause.message : "";
  const combined = [err.message, cause].filter(Boolean).join(" — ");
  const unreachable =
    /timeout|ECONN|ENOTFOUND|EAI_AGAIN|SSL|connect|unreachable|Connection terminated|remaining connection slots|too many clients|Connection ended|query_timeout|statement timeout/i;
  if (unreachable.test(combined)) {
    const timeoutish = [err.message, cause].find((m) => /timeout expired|connection timeout|query_timeout|statement timeout/i.test(m));
    const detail = timeoutish ? firstLine(timeoutish) : cause || firstLine(err.message);
    return `Database unreachable: ${detail}`;
  }
  if (err.message.startsWith("Failed query:")) {
    return cause ? `Database query failed: ${cause}` : fallback;
  }
  return err.message || fallback;
}

function firstLine(message: string): string {
  return message.split("\n")[0] ?? message;
}

/**
 * Hard cap for a single API call so a dead Neon/pg handshake cannot sit on the
 * Next request until the ~22s proxy cutoff. pg `connectionTimeoutMillis` is
 * still the first line of defence (A7_MAX: `select 1` died at 15017ms with
 * `timeout expired` when that was set to 15000).
 */
export async function withDbTimeout<T>(
  work: Promise<T>,
  ms: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout expired (${ms}ms)`));
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Lazily create the Drizzle client over a node-postgres pool. Works with a local
 * Postgres and with Neon (over the pooled connection string in the Node runtime).
 * TLS is enabled automatically for Neon / `sslmode=require` connections.
 *
 * The pool is stored on `globalThis` so `next dev` HMR does not leak extra
 * Neon-pooler clients. Timeouts fail fast when the database is unreachable
 * instead of hanging until a ~22s proxy cutoff.
 */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  if (globalForDb.__aggcDb) {
    db = globalForDb.__aggcDb;
    pool = globalForDb.__aggcPgPool;
    return globalForDb.__aggcDb;
  }
  if (!db) {
    pool = new Pool(poolOptionsFromDatabaseUrl(url));
    pool.on("error", (err) => {
      console.error("pg pool error", err.message);
    });
    db = drizzle(pool, { schema });
    globalForDb.__aggcPgPool = pool;
    globalForDb.__aggcDb = db;
  }
  return db;
}
