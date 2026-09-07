import type { BankTransaction, Currency } from "../domain/types";
import { parseCsv } from "./csv";

export interface ParseOptions {
  statementId: string;
  accountId: string;
  /** Fallback currency when a row omits one. */
  defaultCurrency?: Currency;
}

export interface ParseResult {
  transactions: BankTransaction[];
  errors: string[];
}

function pick(row: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
  }
  return undefined;
}

function parseAmount(value: string | undefined): number {
  if (!value) return NaN;
  // Strip currency symbols, thousands separators and spaces; support
  // parenthesised negatives, e.g. "(1,200.00)".
  const negative = /^\(.*\)$/.test(value.trim());
  const cleaned = value.replace(/[(),$£€\s]/g, "");
  const num = Number(cleaned);
  if (Number.isNaN(num)) return NaN;
  return negative ? -Math.abs(num) : num;
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  // ISO already.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // DD/MM/YYYY or MM/DD/YYYY -> best-effort ISO (assume DD/MM/YYYY).
  const slash = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const [, a, b, y] = slash;
    const day = a.padStart(2, "0");
    const month = b.padStart(2, "0");
    return `${y}-${month}-${day}`;
  }
  const parsed = new Date(v);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Parse a bank-statement CSV into normalized {@link BankTransaction}s.
 *
 * Supported columns (case-insensitive, flexible naming):
 *   - date / posting date / transaction date
 *   - description / details / narrative
 *   - reference / ref
 *   - counterparty / payee / name
 *   - amount (signed)  OR  debit + credit
 *   - currency / ccy
 *   - balance / running balance
 */
export function parseBankStatementCsv(
  csv: string,
  options: ParseOptions,
): ParseResult {
  const rows = parseCsv(csv);
  const transactions: BankTransaction[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const rawDate = pick(row, ["date", "posting date", "transaction date", "value date"]);
    const date = normalizeDate(rawDate);
    if (!date) {
      errors.push(`Row ${index + 1}: unparseable or missing date "${rawDate ?? ""}"`);
      return;
    }

    let amount: number;
    const signed = pick(row, ["amount", "value"]);
    if (signed != null) {
      amount = parseAmount(signed);
    } else {
      const debit = parseAmount(pick(row, ["debit", "withdrawal", "paid out"]));
      const credit = parseAmount(pick(row, ["credit", "deposit", "paid in"]));
      const d = Number.isNaN(debit) ? 0 : Math.abs(debit);
      const c = Number.isNaN(credit) ? 0 : Math.abs(credit);
      amount = c - d;
    }

    if (Number.isNaN(amount)) {
      errors.push(`Row ${index + 1}: unparseable amount`);
      return;
    }

    const currency = (pick(row, ["currency", "ccy"]) ??
      options.defaultCurrency ??
      "USD") as Currency;

    const balanceRaw = pick(row, ["balance", "running balance"]);
    const balanceAfter = balanceRaw ? parseAmount(balanceRaw) : undefined;

    transactions.push({
      id: `${options.statementId}-L${index + 1}`,
      accountId: options.accountId,
      date,
      description: pick(row, ["description", "details", "narrative"]) ?? "",
      reference: pick(row, ["reference", "ref"]),
      counterparty: pick(row, ["counterparty", "payee", "name"]),
      amount,
      currency,
      balanceAfter:
        balanceAfter != null && !Number.isNaN(balanceAfter)
          ? balanceAfter
          : undefined,
      statementId: options.statementId,
    });
  });

  return { transactions, errors };
}
