import type { BankTransaction } from "../../domain/types";
import { extractPdfTextItems } from "./extract";
import type {
  ParsedStatementTransaction,
  ParseTraceEvent,
  PdfTextItem,
  SkippedRow,
  StatementHeader,
  StatementParseResult,
  StatementPdfParser,
} from "./types";
import {
  clusterRows,
  joinedText,
  parseUkAmount,
  parseUkDate,
  type PdfRow,
} from "./util";

export const UK_HSBC_PARSER_ID = "uk-hsbc";
export const UK_HSBC_PARSER_VERSION = "1.0.0";

const COLUMNS = [
  { label: "Bank reference", name: "bankReference" },
  { label: "Customer reference", name: "customerReference" },
  { label: "TRN type", name: "trnType" },
  { label: "Value date", name: "valueDate" },
  { label: "Credit amount", name: "creditAmount" },
  { label: "Debit amount", name: "debitAmount" },
  { label: "Balance", name: "balance" },
  { label: "Post date", name: "postDate" },
] as const;

type ColumnName = (typeof COLUMNS)[number]["name"];

interface ColumnRange {
  name: ColumnName;
  left: number;
  right: number;
}

const HEADER_LABELS: { label: string; key: keyof StatementHeader; kind: "text" | "amount" | "date" }[] =
  [
    { label: "Account name", key: "accountName", kind: "text" },
    { label: "Account number", key: "accountNumber", kind: "text" },
    { label: "Bank name", key: "bankName", kind: "text" },
    { label: "Currency", key: "currency", kind: "text" },
    { label: "Location", key: "location", kind: "text" },
    { label: "BIC", key: "bic", kind: "text" },
    { label: "IBAN", key: "iban", kind: "text" },
    { label: "Account status", key: "accountStatus", kind: "text" },
    { label: "Account type", key: "accountType", kind: "text" },
    { label: "Specified date range", key: "periodStart", kind: "text" },
    { label: "Current available balance", key: "currentAvailableBalance", kind: "amount" },
    { label: "Current ledger balance", key: "currentLedgerBalance", kind: "amount" },
    {
      label: "Closing available balance brought forward",
      key: "closingAvailableBroughtForward",
      kind: "amount",
    },
    {
      label: "Closing ledger balance brought forward",
      key: "closingLedgerBroughtForward",
      kind: "amount",
    },
    { label: "From", key: "broughtForwardFrom", kind: "date" },
    { label: "As at", key: "currentBalanceAsAt", kind: "text" },
  ];

function rowHasColumnHeaders(row: PdfRow): boolean {
  const text = joinedText(row);
  return COLUMNS.every((col) => text.includes(col.label));
}

function columnRanges(headerRow: PdfRow): ColumnRange[] | null {
  const found: { name: ColumnName; left: number }[] = [];
  for (const col of COLUMNS) {
    const item = headerRow.items.find((i) => i.str === col.label);
    if (!item) return null;
    found.push({ name: col.name, left: item.x });
  }
  found.sort((a, b) => a.left - b.left);
  return found.map((col, index) => ({
    name: col.name,
    left: col.left,
    right: index + 1 < found.length ? found[index + 1].left : 1000,
  }));
}

function assignColumn(item: PdfTextItem, cols: ColumnRange[]): ColumnName | "unknown" {
  const center = item.x + item.width / 2;
  for (const col of cols) {
    if (center >= col.left - 4 && center < col.right) return col.name;
  }
  return "unknown";
}

/** Drop iText overlay tokens that repeat across every column of a row. */
function stripOverlay(row: PdfRow): PdfRow {
  const counts = new Map<string, number>();
  for (const item of row.items) {
    const token = item.str.trim();
    if (token.length < 8) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const overlay = new Set(
    [...counts.entries()].filter(([, n]) => n >= 4).map(([token]) => token),
  );
  if (overlay.size === 0) return row;
  return { ...row, items: row.items.filter((i) => !overlay.has(i.str.trim())) };
}

function isChrome(row: PdfRow): boolean {
  const text = joinedText(row);
  if (text === "|" || text.includes("Statement details")) return true;
  if (/\bPage\b/.test(text) && /\bof\b/.test(text)) return true;
  if (row.y < 40) return true;
  return false;
}

function cellsOf(row: PdfRow, cols: ColumnRange[]): Partial<Record<ColumnName, string>> {
  const cells: Partial<Record<ColumnName, string>> = {};
  for (const item of row.items) {
    const name = assignColumn(item, cols);
    if (name === "unknown") continue;
    const str = item.str.trim();
    if (!str) continue;
    cells[name] = cells[name] ? `${cells[name]} ${str}` : str;
  }
  return cells;
}

function isNarrativeRow(row: PdfRow): boolean {
  return row.items.some((i) => i.str.trim() === "Narrative");
}

function narrativeText(row: PdfRow): string {
  return row.items
    .filter((i) => i.str.trim() !== "Narrative")
    .map((i) => i.str.trim())
    .filter(Boolean)
    .join(" ");
}

function takeHeaderPairs(group: PdfTextItem[], header: StatementHeader): void {
  for (const { label, key, kind } of HEADER_LABELS) {
    const lab = group.find((i) => i.str === label);
    if (!lab) continue;
    const vals = group.filter((i) => i.x > lab.x + 8 && i.str.trim() && i.str !== label);
    if (vals.length === 0) continue;

    if (kind === "amount") {
      const amountItem = [...vals]
        .reverse()
        .find((v) => /^-?[\d,]+\.\d{2}$/.test(v.str.trim()));
      if (amountItem) {
        const cents = parseUkAmount(amountItem.str);
        if (cents != null) {
          (header as Record<string, number>)[key] = cents;
        }
      }
      continue;
    }

    const text = vals
      .map((v) => v.str.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    if (label === "Specified date range") {
      const match = text.match(
        /(\d{1,2} \w{3} \d{4}) to (\d{1,2} \w{3} \d{4})/,
      );
      if (match) {
        header.periodStart = parseUkDate(match[1]) ?? undefined;
        header.periodEnd = parseUkDate(match[2]) ?? undefined;
      }
      continue;
    }

    if (kind === "date") {
      const iso = parseUkDate(text);
      (header as Record<string, string>)[key] = iso ?? text;
      continue;
    }

    if (header[key] == null) {
      (header as Record<string, string>)[key] = text;
    }
  }
}

function parseHeaderRow(row: PdfRow, header: StatementHeader): void {
  takeHeaderPairs(
    row.items.filter((i) => i.x < 380),
    header,
  );
  takeHeaderPairs(
    row.items.filter((i) => i.x >= 380),
    header,
  );
}

function applyAccountNumberExtras(header: StatementHeader): void {
  const raw = header.accountNumber;
  if (!raw) return;
  const match = raw.trim().match(/^(\d{6})-(\d+)$/);
  if (!match) return;
  const [, sc, _acct] = match;
  header.sortCode = `${sc.slice(0, 2)}-${sc.slice(2, 4)}-${sc.slice(4, 6)}`;
}

function footerMeta(items: PdfTextItem[]): { statementDate?: string } {
  const foot = items.find(
    (i) => i.y < 40 && /Account number/.test(i.str) && /^\d{1,2} \w{3} \d{4}/.test(i.str),
  );
  if (!foot) return {};
  const date = parseUkDate(foot.str.slice(0, 11).trim());
  return date ? { statementDate: date } : {};
}

function appendNarrative(
  txn: ParsedStatementTransaction,
  text: string,
): void {
  const chunk = text.trim();
  if (!chunk) return;
  txn.narrative = txn.narrative ? `${txn.narrative} ${chunk}` : chunk;
}

function isBankRefWrap(
  row: PdfRow,
  cells: Partial<Record<ColumnName, string>>,
  postDate: string | null,
  balance: number | null,
): boolean {
  if (postDate || balance != null) return false;
  // True wraps continue the left-most column (x≈31). Narrative bodies sit
  // around x≈82 and must not be concatenated onto bankReference.
  const minX = Math.min(...row.items.map((i) => i.x));
  if (minX > 50) return false;
  const filled = Object.entries(cells).filter(([, v]) => v && v.trim());
  return filled.length === 1 && filled[0][0] === "bankReference";
}

function isNarrativeContinuation(
  row: PdfRow,
  postDate: string | null,
  balance: number | null,
): boolean {
  if (postDate || balance != null) return false;
  const minX = Math.min(...row.items.map((i) => i.x));
  return minX > 60 && minX < 120;
}

function validateContinuity(
  transactions: ParsedStatementTransaction[],
): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < transactions.length - 1; i++) {
    const current = transactions[i];
    const older = transactions[i + 1];
    if (current.balanceAfter == null || older.balanceAfter == null) continue;
    const expected = older.balanceAfter + current.amount;
    if (expected !== current.balanceAfter) {
      warnings.push(
        `Line ${current.lineNumber}: running balance ${current.balanceAfter} ` +
          `does not equal previous ${older.balanceAfter} + amount ${current.amount} ` +
          `(expected ${expected}).`,
      );
    }
  }
  return warnings;
}

function findColumnHeaderRow(rows: PdfRow[]): PdfRow | undefined {
  return rows.find(rowHasColumnHeaders);
}

/**
 * Parse already-extracted text items from an HSBC UK "Statement details" PDF.
 * Exported for unit tests so layout cases can be exercised without a PDF file.
 */
export function parseUkHsbcFromItems(
  items: PdfTextItem[],
  pageCount: number,
): StatementParseResult {
  const trace: ParseTraceEvent[] = [];
  const skipped: SkippedRow[] = [];
  const transactions: ParsedStatementTransaction[] = [];
  const header: StatementHeader = { pageCount };
  Object.assign(header, footerMeta(items));

  trace.push({
    level: "info",
    stage: "extract",
    message: `Using ${items.length} text items across ${pageCount} page(s).`,
    detail: { items: items.length, pageCount },
  });

  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  let cols: ColumnRange[] | null = null;
  let current: ParsedStatementTransaction | null = null;

  for (const page of pages) {
    const pageItems = items.filter((i) => i.page === page);
    const probeRows = clusterRows(pageItems, 0.5);
    const headerRow = findColumnHeaderRow(probeRows);
    if (headerRow) {
      const next = columnRanges(headerRow);
      if (next) cols = next;
    }
    if (!cols) {
      skipped.push({ page, y: 0, reason: "unparsed", text: "no column headers" });
      continue;
    }

    const colY = headerRow?.y ?? Math.max(...pageItems.map((i) => i.y));
    const headerItems = pageItems.filter((i) => i.y > colY + 2);
    const bodyItems = pageItems.filter((i) => i.y <= colY + 2);
    const headerRows = clusterRows(headerItems, 1);
    const bodyRows = clusterRows(bodyItems, 0.5);

    if (page === pages[0]) {
      for (const row of headerRows) {
        if (isChrome(row)) continue;
        parseHeaderRow(row, header);
      }
    }

    for (const raw of bodyRows) {
      if (rowHasColumnHeaders(raw)) continue;
      if (isChrome(raw)) continue;

      const row = stripOverlay(raw);
      if (row.items.length === 0) {
        skipped.push({
          page,
          y: raw.y,
          reason: "noise",
          text: joinedText(raw).slice(0, 120),
        });
        continue;
      }

      const text = joinedText(row);

      if (isNarrativeRow(row)) {
        if (current) appendNarrative(current, narrativeText(row));
        else {
          trace.push({
            level: "warn",
            stage: "transaction",
            message: "Orphan narrative before the first transaction.",
            page,
            detail: { text: text.slice(0, 80) },
          });
        }
        continue;
      }

      const cells = cellsOf(row, cols);
      const postDate = parseUkDate(cells.postDate);
      const valueDate = parseUkDate(cells.valueDate);
      const balance = parseUkAmount(cells.balance);

      if (postDate && balance != null) {
        const creditMag = Math.abs(parseUkAmount(cells.creditAmount) ?? 0);
        const debitMag = Math.abs(parseUkAmount(cells.debitAmount) ?? 0);
        current = {
          lineNumber: transactions.length + 1,
          page,
          postDate,
          valueDate: valueDate ?? undefined,
          trnType: cells.trnType?.trim() || undefined,
          customerReference: cells.customerReference?.trim() || undefined,
          bankReference: cells.bankReference?.trim() || undefined,
          creditAmount: creditMag || undefined,
          debitAmount: debitMag || undefined,
          amount: creditMag - debitMag,
          balanceAfter: balance,
          narrative: "",
        };
        transactions.push(current);
        continue;
      }

      // Narrative body is indented (~x=82) under the posting. Classify it
      // before bank-ref wraps; short narratives otherwise look like a single
      // bankReference cell and get swallowed.
      if (current && isNarrativeContinuation(row, postDate, balance)) {
        appendNarrative(current, text);
        continue;
      }

      if (current && isBankRefWrap(row, cells, postDate, balance)) {
        current.bankReference =
          (current.bankReference ?? "") + (cells.bankReference ?? "");
        continue;
      }

      skipped.push({
        page,
        y: Math.round(row.y),
        reason: "unparsed",
        text: text.slice(0, 120),
      });
    }
  }

  applyAccountNumberExtras(header);

  trace.push({
    level: header.accountName || header.iban ? "info" : "warn",
    stage: "header",
    message: header.accountName
      ? `Parsed header for ${header.accountName}.`
      : "Header fields were incomplete.",
    detail: {
      periodStart: header.periodStart,
      periodEnd: header.periodEnd,
      currency: header.currency,
    },
  });

  const perPageCounts: Record<number, number> = {};
  for (const txn of transactions) {
    perPageCounts[txn.page] = (perPageCounts[txn.page] ?? 0) + 1;
  }

  const withNarrative = transactions.filter((t) => t.narrative.length > 0).length;
  trace.push({
    level: "info",
    stage: "transaction",
    message: `Parsed ${transactions.length} transaction(s) (${withNarrative} with narrative).`,
    detail: { count: transactions.length, withNarrative, perPageCounts },
  });

  const warnings = [
    ...trace.filter((e) => e.level === "warn").map((e) => e.message),
    ...validateContinuity(transactions),
  ];
  if (skipped.some((s) => s.reason === "unparsed")) {
    warnings.push(
      `${skipped.filter((s) => s.reason === "unparsed").length} row(s) could not be parsed.`,
    );
  }

  const continuityIssues = warnings.filter((w) => w.includes("running balance"));
  trace.push({
    level: continuityIssues.length ? "warn" : "info",
    stage: "validate",
    message: continuityIssues.length
      ? `Running-balance continuity failed on ${continuityIssues.length} line(s).`
      : "Running-balance continuity holds (newest-first).",
  });

  if (!cols) {
    warnings.push("No HSBC column-header row was found.");
  }
  if (transactions.length === 0) {
    warnings.push("No transactions were parsed from the statement.");
  }

  return {
    parserId: UK_HSBC_PARSER_ID,
    parserVersion: UK_HSBC_PARSER_VERSION,
    header,
    transactions,
    warnings,
    skipped,
    perPageCounts,
    trace,
    pageCount,
  };
}

export function looksLikeUkHsbc(input: {
  fileName?: string;
  items: PdfTextItem[];
}): boolean {
  const name = (input.fileName ?? "").toLowerCase();
  if (name.includes("hsbc") && name.endsWith(".pdf")) return true;
  const sample = input.items
    .slice(0, 80)
    .map((i) => i.str)
    .join(" ");
  return (
    sample.includes("TRN type") &&
    sample.includes("Bank reference") &&
    (sample.includes("HSBC") || sample.includes("Statement details"))
  );
}

export async function parseUkHsbcPdf(
  buffer: Buffer | Uint8Array,
  _options?: { fileName?: string },
): Promise<StatementParseResult> {
  const { items, pageCount } = await extractPdfTextItems(buffer);
  return parseUkHsbcFromItems(items, pageCount);
}

export const ukHsbcParser: StatementPdfParser = {
  id: UK_HSBC_PARSER_ID,
  version: UK_HSBC_PARSER_VERSION,
  canParse: looksLikeUkHsbc,
  parse: parseUkHsbcPdf,
};

/** Map HSBC lines onto the existing cash-position transaction shape. */
export function toBankTransactions(
  parsed: StatementParseResult,
  options: { statementId: string; accountId: string },
): BankTransaction[] {
  const currency = parsed.header.currency ?? "GBP";
  return parsed.transactions.map((txn) => ({
    id: `${options.statementId}-L${txn.lineNumber}`,
    accountId: options.accountId,
    date: txn.postDate,
    description: txn.narrative,
    reference: txn.customerReference,
    counterparty: txn.bankReference,
    amount: txn.amount,
    currency,
    balanceAfter: txn.balanceAfter,
    statementId: options.statementId,
  }));
}
