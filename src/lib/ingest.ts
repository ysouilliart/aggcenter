import { createHash } from "crypto";

import { getConfig } from "./config";
import { getDataSource } from "./datasource";
import type { BankAccount, Statement } from "./domain/types";
import { resolveAccountFromHeader } from "./ingest/accounts";
import { parseBankStatementCsv } from "./parse/bankStatement";
import {
  extractPdfTextItems,
  parserForPdf,
  type StatementPdfParser,
} from "./parse/pdf";
import { getStatementRepository, type StatementRepository } from "./statements";
import { recordsFromParseFailure, recordsFromParseResult } from "./statements/fromParse";
import { getStorageProvider, type StorageProvider } from "./storage";

export const DEFAULT_CSV_INGEST_PREFIX = "inbox/";
export const DEFAULT_PDF_INGEST_PREFIX = "aggCenter/bankStatements/";
export const DEFAULT_INGEST_PREFIXES = [
  DEFAULT_CSV_INGEST_PREFIX,
  DEFAULT_PDF_INGEST_PREFIX,
];
/** @deprecated Use DEFAULT_CSV_INGEST_PREFIX. Kept for callers that still pass a single inbox prefix. */
export const DEFAULT_INGEST_PREFIX = DEFAULT_CSV_INGEST_PREFIX;

export interface IngestResult {
  provider: string;
  prefix: string;
  ingested: {
    key: string;
    statementId: string;
    accountId: string;
    transactionCount: number;
    warnings: number;
    parseStatus?: Statement["parseStatus"];
  }[];
  skipped: { key: string; reason: string }[];
  errors: { key: string; error: string; statementId?: string }[];
}

export interface IngestDeps {
  storage: StorageProvider;
  repo: StatementRepository;
  accounts: BankAccount[];
  prefix?: string;
  prefixes?: string[];
}

/** Stable statement id derived from the object key, so re-scans can't duplicate. */
function statementIdForKey(key: string): string {
  return `OCI-${createHash("sha1").update(key).digest("hex").slice(0, 12)}`;
}

function withTrailingSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function resolvePrefixes(deps: IngestDeps): string[] {
  if (deps.prefixes?.length) return deps.prefixes.map(withTrailingSlash);
  if (deps.prefix != null) return [withTrailingSlash(deps.prefix)];
  return [...DEFAULT_INGEST_PREFIXES];
}

function fileNameOf(key: string): string {
  const parts = key.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? key;
}

/**
 * Ingest statement files from object storage.
 *
 * CSV: `{csvPrefix}{accountId}/<file>.csv` — account comes from the folder.
 * PDF: `{pdfPrefix}{bankCode}/<file>.pdf` — `UK-HSBC` uses the HSBC parser;
 * account identity comes from the statement header (IBAN / account number)
 * and is upserted when missing.
 *
 * Idempotent on `storage_key`. PDF parse failures are still persisted so the
 * UI can show why.
 */
export async function ingestStatements(deps: IngestDeps): Promise<IngestResult> {
  const prefixes = resolvePrefixes(deps);
  const result: IngestResult = {
    provider: deps.storage.name,
    prefix: prefixes.join(", "),
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

  const seen = new Set<string>();
  for (const prefix of prefixes) {
    const objects = await deps.storage.list(prefix);
    for (const obj of objects) {
      const key = obj.key;
      if (seen.has(key)) continue;
      seen.add(key);

      const lower = key.toLowerCase();
      const isCsv = lower.endsWith(".csv");
      const isPdf = lower.endsWith(".pdf");
      if (!isCsv && !isPdf) continue;

      if (existingKeys.has(key)) {
        result.skipped.push({ key, reason: "already ingested" });
        continue;
      }

      if (isCsv) {
        await ingestCsv({ deps, key, prefix, accountIds, accountById, result, existingKeys });
      } else {
        await ingestPdf({ deps, key, result, existingKeys });
      }
    }
  }

  return result;
}

async function ingestCsv(input: {
  deps: IngestDeps;
  key: string;
  prefix: string;
  accountIds: Set<string>;
  accountById: Map<string, BankAccount>;
  result: IngestResult;
  existingKeys: Set<string>;
}): Promise<void> {
  const { deps, key, prefix, accountIds, accountById, result, existingKeys } = input;
  const rel = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 2) {
    result.errors.push({
      key,
      error: `expected ${prefix}<accountId>/<file>.csv`,
    });
    return;
  }
  const accountId = parts[0];
  if (!accountIds.has(accountId)) {
    result.errors.push({ key, error: `unknown account '${accountId}'` });
    return;
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
      return;
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
    existingKeys.add(key);
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

async function ingestPdf(input: {
  deps: IngestDeps;
  key: string;
  result: IngestResult;
  existingKeys: Set<string>;
}): Promise<void> {
  const { deps, key, result, existingKeys } = input;
  const fileName = fileNameOf(key);
  const statementId = statementIdForKey(key);
  const startedAt = new Date().toISOString();

  try {
    const buffer = await deps.storage.get(key);
    const routed = await resolvePdfParser(key, fileName, buffer);

    if (!routed) {
      await persistFailure({
        deps,
        key,
        statementId,
        fileName,
        startedAt,
        error: "No PDF parser matched this file (expected a UK-HSBC statement).",
        existingKeys,
      });
      result.errors.push({
        key,
        statementId,
        error: "No PDF parser matched this file (expected a UK-HSBC statement).",
      });
      return;
    }

    const parsed = await routed.parser.parse(buffer, { fileName });
    const { account } = await resolveAccountFromHeader({
      header: parsed.header,
      bankCode: routed.bankCode,
      seed: deps.accounts,
      repo: deps.repo,
    });

    const records = recordsFromParseResult(parsed, {
      statementId,
      accountId: account.id,
      fileName,
      source: "oci",
      storageKey: key,
      bankCode: routed.bankCode,
      startedAt,
    });

    await deps.repo.addParsedStatement(
      records.statement,
      records.transactions,
      records.job,
    );
    existingKeys.add(key);

    if (records.statement.parseStatus === "failed") {
      result.errors.push({
        key,
        statementId,
        error: parsed.warnings[0] ?? "no transactions parsed",
      });
      return;
    }

    result.ingested.push({
      key,
      statementId,
      accountId: account.id,
      transactionCount: records.transactions.length,
      warnings: parsed.warnings.length,
      parseStatus: records.statement.parseStatus,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "ingest failed";
    try {
      await persistFailure({
        deps,
        key,
        statementId,
        fileName,
        startedAt,
        error,
        existingKeys,
      });
      result.errors.push({ key, statementId, error });
    } catch {
      result.errors.push({ key, error });
    }
  }
}

async function resolvePdfParser(
  key: string,
  fileName: string,
  buffer: Buffer,
): Promise<{ bankCode: string; parser: StatementPdfParser } | undefined> {
  const fromPath = parserForPdf({ key, fileName });
  if (fromPath) return fromPath;
  const { items } = await extractPdfTextItems(buffer);
  return parserForPdf({ key, fileName, items });
}

async function persistFailure(input: {
  deps: IngestDeps;
  key: string;
  statementId: string;
  fileName: string;
  startedAt: string;
  error: string;
  existingKeys: Set<string>;
  parser?: StatementPdfParser;
  bankCode?: string;
}): Promise<void> {
  const records = recordsFromParseFailure({
    statementId: input.statementId,
    accountId: "UNATTRIBUTED",
    fileName: input.fileName,
    source: "oci",
    storageKey: input.key,
    bankCode: input.bankCode,
    parserId: input.parser?.id,
    parserVersion: input.parser?.version,
    startedAt: input.startedAt,
    error: input.error,
  });
  await input.deps.repo.addParsedStatement(
    records.statement,
    records.transactions,
    records.job,
  );
  input.existingKeys.add(input.key);
}

/** Ingest using the active storage provider, statement repository and accounts. */
export async function ingestFromObjectStorage(prefix?: string): Promise<IngestResult> {
  const config = getConfig();
  return ingestStatements({
    storage: getStorageProvider(),
    repo: getStatementRepository(),
    accounts: await getDataSource().getAccounts(),
    prefixes: prefix
      ? [prefix]
      : [config.statementCsvPrefix, config.statementPdfPrefix],
  });
}
