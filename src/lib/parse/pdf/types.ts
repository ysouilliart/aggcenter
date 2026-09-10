/**
 * Shared types for PDF bank-statement parsers.
 *
 * Amounts are integer minor units (cents), matching the rest of the domain.
 */

import type {
  ParseTraceEvent,
  ParseTraceLevel,
  ParseTraceStage,
  StatementHeader,
} from "../../domain/types";

export type {
  ParseTraceEvent,
  ParseTraceLevel,
  ParseTraceStage,
  StatementHeader,
};

export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  str: string;
  fontName?: string;
}

export interface SkippedRow {
  page: number;
  y: number;
  reason: "noise" | "unparsed" | "chrome";
  text: string;
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
