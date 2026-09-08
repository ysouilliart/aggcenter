import { createHash } from "crypto";

import { getDataSource } from "./datasource";
import type { BankAccount, Statement } from "./domain/types";
import { parseBankStatementCsv } from "./parse/bankStatement";
import { getStatementRepository, type StatementRepository } from "./statements";
import { getStorageProvider, type StorageProvider } from "./storage";

export const DEFAULT_INGEST_PREFIX = "inbox/";

export interface IngestResult {
  provider: string;
  prefix: string;
  ingested: {
    key: string;
    statementId: string;
    accountId: string;
    transactionCount: number;
    warnings: number;
  }[];
  skipped: { key: string; reason: string }[];
  errors: { key: string; error: string }[];
}

export interface IngestDeps {
  storage: StorageProvider;
  repo: StatementRepository;
  accounts: BankAccount[];
  prefix?: string;
}

/** Stable statement id derived from the object key, so re-scans can't duplicate. */
function statementIdForKey(key: string): string {
  return `OCI-${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

/**
 * Ingest statement CSVs from object storage under `{prefix}{accountId}/<file>.csv`.
 * The account is taken from the first path segment; ingestion is idempotent
 * (a file already recorded by its object key is skipped).
 */
export async function ingestStatements(deps: IngestDeps): Promise<IngestResult> {
  const prefix = deps.prefix ?? DEFAULT_INGEST_PREFIX;
  const result: IngestResult = {
    provider: deps.storage.name,
    prefix,
    ingested: [],
    skipped: [],
    errors: [],
  };

  const accountIds = new Set(deps.accounts.map((a) => a.id));
  const accountById = new Map(deps.accounts.map((a) => [a.id, a]));
  const existingKeys = new Set(
    (await deps.repo.listStatements())
      .map((s) => s.storageKey)
      .filter((k): k is string => Boolean(k)),
  );

  const objects = await deps.storage.list(prefix);

  for (const obj of objects) {
    const key = obj.key;
    if (!key.toLowerCase().endsWith(".csv")) continue;
    if (existingKeys.has(key)) {
      result.skipped.push({ key, reason: "already ingested" });
      continue;
    }

    const rel = key.slice(prefix.length);
    const parts = rel.split("/").filter(Boolean);
    if (parts.length < 2) {
      result.errors.push({
        key,
        error: `expected ${prefix}<accountId>/<file>.csv`,
      });
      continue;
    }
    const accountId = parts[0];
    if (!accountIds.has(accountId)) {
      result.errors.push({ key, error: `unknown account '${accountId}'` });
      continue;
    }

    try {
      const buffer = await deps.storage.get(key);
      const statementId = statementIdForKey(key);
      const { transactions, errors } = parseBankStatementCsv(buffer.toString("utf8"), {
        statementId,
        accountId,
        defaultCurrency: accountById.get(accountId)?.currency,
      });

      if (transactions.length === 0) {
        result.errors.push({
          key,
          error: errors[0] ?? "no transactions parsed",
        });
        continue;
      }

      const dates = transactions.map((t) => t.date).sort();
      const statement: Statement = {
        id: statementId,
        accountId,
        fileName: parts[parts.length - 1],
        source: "oci",
        periodStart: dates[0],
        periodEnd: dates[dates.length - 1],
        transactionCount: transactions.length,
        storageKey: key,
        uploadedAt: new Date().toISOString(),
      };

      await deps.repo.addUpload(statement, transactions);
      result.ingested.push({
        key,
        statementId,
        accountId,
        transactionCount: transactions.length,
        warnings: errors.length,
      });
    } catch (err) {
      result.errors.push({
        key,
        error: err instanceof Error ? err.message : "ingest failed",
      });
    }
  }

  return result;
}

/** Ingest using the active storage provider, statement repository and accounts. */
export async function ingestFromObjectStorage(prefix?: string): Promise<IngestResult> {
  return ingestStatements({
    storage: getStorageProvider(),
    repo: getStatementRepository(),
    accounts: await getDataSource().getAccounts(),
    prefix,
  });
}
