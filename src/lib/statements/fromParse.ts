import type { BankTransaction, ParseJob, Statement } from "../domain/types";
import type { StatementParseResult } from "../parse/pdf";
import { toBankTransactions } from "../parse/pdf";

export interface ParsedStatementRecords {
  statement: Statement;
  transactions: BankTransaction[];
  job: ParseJob;
}

export interface FromParseOptions {
  statementId: string;
  accountId: string;
  fileName: string;
  source: Statement["source"];
  storageKey?: string;
  bankCode?: string;
  uploadedAt?: string;
  startedAt?: string;
}

/** Turn a parser result into persistable statement + transactions + parse job. */
export function recordsFromParseResult(
  parsed: StatementParseResult,
  options: FromParseOptions,
): ParsedStatementRecords {
  const finishedAt = new Date().toISOString();
  const startedAt = options.startedAt ?? finishedAt;
  const header = parsed.header;
  const periodStart =
    header.periodStart ??
    parsed.transactions.at(-1)?.postDate ??
    finishedAt.slice(0, 10);
  const periodEnd =
    header.periodEnd ?? parsed.transactions[0]?.postDate ?? periodStart;

  const warnings = parsed.warnings.length;
  const status =
    parsed.transactions.length === 0
      ? "failed"
      : warnings > 0
        ? "partial"
        : "parsed";

  const statement: Statement = {
    id: options.statementId,
    accountId: options.accountId,
    fileName: options.fileName,
    source: options.source,
    periodStart,
    periodEnd,
    transactionCount: parsed.transactions.length,
    storageKey: options.storageKey,
    uploadedAt: options.uploadedAt ?? finishedAt,
    bankCode: options.bankCode,
    parserId: parsed.parserId,
    parserVersion: parsed.parserVersion,
    parseStatus: status,
    header,
  };

  const transactions = toBankTransactions(parsed, {
    statementId: options.statementId,
    accountId: options.accountId,
  });

  const job: ParseJob = {
    id: `${options.statementId}-JOB`,
    statementId: options.statementId,
    storageKey: options.storageKey,
    parserId: parsed.parserId,
    parserVersion: parsed.parserVersion,
    status,
    startedAt,
    finishedAt,
    transactionCount: parsed.transactions.length,
    warningCount: warnings,
    skippedNoise: parsed.skipped.filter((s) => s.reason === "noise").length,
    skippedUnparsed: parsed.skipped.filter((s) => s.reason === "unparsed").length,
    pageCount: parsed.pageCount,
    events: parsed.trace,
  };

  return { statement, transactions, job };
}
