import { afterEach, describe, expect, it } from "vitest";

import { formatDbError, poolOptionsFromDatabaseUrl, stripSslMode } from "@/lib/db/client";

describe("poolOptionsFromDatabaseUrl", () => {
  const prevNoVerify = process.env.DATABASE_SSL_NO_VERIFY;
  const prevMax = process.env.DATABASE_POOL_MAX;

  afterEach(() => {
    if (prevNoVerify === undefined) delete process.env.DATABASE_SSL_NO_VERIFY;
    else process.env.DATABASE_SSL_NO_VERIFY = prevNoVerify;
    if (prevMax === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = prevMax;
  });

  it("leaves a local URL without TLS and strips nothing useful", () => {
    const opts = poolOptionsFromDatabaseUrl("postgresql://app:secret@localhost:5432/aggcenter");
    expect(opts.ssl).toBeUndefined();
    expect(opts.connectionString).toBe("postgresql://app:secret@localhost:5432/aggcenter");
    expect(opts.connectionTimeoutMillis).toBe(8000);
    expect(opts.statement_timeout).toBe(15000);
    expect(opts.max).toBe(5);
  });

  it("enables TLS for Neon and removes sslmode=require so pg does not warn", () => {
    const opts = poolOptionsFromDatabaseUrl(
      "postgresql://user:pass@ep-example-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=require",
    );
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
    expect(opts.connectionString).toBe(
      "postgresql://user:pass@ep-example-pooler.ap-southeast-2.aws.neon.tech/neondb",
    );
    expect(opts.connectionString).not.toMatch(/sslmode/);
  });

  it("honours DATABASE_SSL_NO_VERIFY and DATABASE_POOL_MAX", () => {
    process.env.DATABASE_SSL_NO_VERIFY = "true";
    process.env.DATABASE_POOL_MAX = "2";
    const opts = poolOptionsFromDatabaseUrl(
      "postgresql://user:pass@ep-example.neon.tech/neondb?sslmode=require",
    );
    expect(opts.ssl).toEqual({ rejectUnauthorized: false });
    expect(opts.max).toBe(2);
  });

  it("stripSslMode keeps other query params", () => {
    expect(stripSslMode("postgresql://u:p@h/db?sslmode=require&connect_timeout=10")).toBe(
      "postgresql://u:p@h/db?connect_timeout=10",
    );
  });
});

describe("formatDbError", () => {
  it("surfaces a timeout/connection cause as unreachable", () => {
    const err = new Error("Failed query: select \"id\" from \"aggc-supplier\".\"supplier_sites\"\nparams: ");
    err.cause = new Error("Connection terminated due to connection timeout");
    expect(formatDbError(err)).toBe(
      "Database unreachable: Connection terminated due to connection timeout",
    );
  });

  it("hides the raw SQL when Drizzle fails without a network cause", () => {
    const err = new Error("Failed query: select 1\nparams: ");
    err.cause = new Error("column does not exist");
    expect(formatDbError(err)).toBe("Database query failed: column does not exist");
  });
});
