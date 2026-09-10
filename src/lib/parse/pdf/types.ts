/**
 * Shared types for PDF bank-statement parsers.
 *
 * Amounts are integer minor units (cents), matching the rest of the domain.
 */

export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  str: string;
  fontName?: string;
}

export type ParseTraceLevel = "info" | "warn" | "error";
export type ParseTraceStage =
  | "extract"
  | "header"
  | "transaction"
  | "validate";

export interface ParseTraceEvent {
  level: ParseTraceLevel;
  stage: ParseTraceStage;
  message: string;
  page?: number;
  line?: number;
  detail?: Record<string, unknown>;
}

export interface SkippedRow {
  page: number;
  y: number;
  reason: "noise" | "unparsed" | "chrome";
  text: string;
}

export interface StatementHeader {
  accountName?: string;
  accountNumber?: string;
  /** Formatted sort code when the account number is `SSSSSS-AAAAAAAA`. */
  sortCode?: string;
  bankName?: string;
  currency?: string;
  location?: string;
  bic?: string;
  iban?: string;
  accountStatus?: string;
  accountType?: string;
  periodStart?: string;
  periodEnd?: string;
  /** ISO date of the statement (footer / generation date). */
  statementDate?: string;
  /** Bank "As at" timestamp for current balances, e.g. "01 Sep 2026 10:31". */
  currentBalanceAsAt?: string;
  /** ISO date the closing balances were brought forward from. */
  broughtForwardFrom?: string;
  currentAvailableBalance?: number;
  currentLedgerBalance?: number;
  closingAvailableBroughtForward?: number;
  closingLedgerBroughtForward?: number;
  pageCount?: number;
}

export interface ParsedStatementTransaction {
  lineNumber: number;
  page: number;
  postDate: string;
  valueDate?: string;
  trnType?: string;
  customerReference?: string;
  bankReference?: string;
  /** Credit magnitude in cents (positive when present). */
  creditAmount?: number;
  /** Debit magnitude in cents (positive when present). */
  debitAmount?: number;
  /** Signed cents: credit − debit. */
  amount: number;
  /** Running ledger balance after this posting, in cents. */
  balanceAfter?: number;
  /**
   * Full HSBC "Narrative" block printed under the posting row (including
   * wrapped continuation lines). Empty string when the statement omitted one.
   */
  narrative: string;
}

export interface StatementParseResult {
  parserId: string;
  parserVersion: string;
  header: StatementHeader;
  transactions: ParsedStatementTransaction[];
  warnings: string[];
  skipped: SkippedRow[];
  perPageCounts: Record<number, number>;
  trace: ParseTraceEvent[];
  pageCount: number;
}

export interface StatementPdfParser {
  readonly id: string;
  readonly version: string;
  canParse(input: { fileName?: string; items: PdfTextItem[] }): boolean;
  parse(
    buffer: Buffer | Uint8Array,
    options?: { fileName?: string },
  ): Promise<StatementParseResult>;
}
