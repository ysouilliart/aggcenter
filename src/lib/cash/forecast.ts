import type {
  BankTransaction,
  CashForecast,
  CashForecastLine,
  ReconciliationResult,
  Remittance,
} from "../domain/types";
import { DATE_WINDOW_DAYS } from "../recon/match-notes";
import { daysBetween } from "../reference/util";

function amountsMatch(a: number, b: number): boolean {
  const tolerance = Math.max(1, Math.round(Math.abs(b) * 0.005));
  return Math.abs(a - b) <= tolerance;
}

function identifiedKeys(reconciliation: ReconciliationResult[]): Set<string> {
  const keys = new Set<string>();
  for (const result of reconciliation) {
    if (result.status === "unmatched" || !result.matchedId) continue;
    keys.add(result.matchedId.toUpperCase().replace(/\s+/g, ""));
  }
  return keys;
}

function remittanceKeys(rem: Remittance): string[] {
  const keys = [rem.id, rem.reference, rem.remittanceNumber, ...(rem.invoiceNumbers ?? [])];
  return keys
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => value.toUpperCase().replace(/\s+/g, ""));
}

function remittanceOnStatement(
  rem: Remittance,
  identified: Set<string>,
  matchedTxns: BankTransaction[],
): boolean {
  if (remittanceKeys(rem).some((key) => identified.has(key))) return true;

  const expectedSign = rem.party === "customer" ? 1 : -1;
  return matchedTxns.some(
    (txn) =>
      Math.sign(txn.amount) === expectedSign &&
      txn.currency === rem.currency &&
      amountsMatch(Math.abs(txn.amount), rem.amount) &&
      daysBetween(rem.date, txn.date) <= DATE_WINDOW_DAYS,
  );
}

export interface CashForecastInput {
  remittances: Remittance[];
  reconciliation: ReconciliationResult[];
  transactions: BankTransaction[];
  /** Statement period start; remittances before this date are other periods. */
  periodStart?: string;
  closingByCurrency?: Record<string, number>;
}

/**
 * Remittances that did not identify a bank-statement payment become the cash
 * forecast: customer = predicted in, vendor = predicted out. They are not
 * anomalies — the statement is the baseline, the remittance is still to land.
 */
export function buildCashForecast(input: CashForecastInput): CashForecast[] {
  const identified = identifiedKeys(input.reconciliation);
  const matchedTxnIds = new Set(
    input.reconciliation
      .filter((r) => r.status !== "unmatched")
      .map((r) => r.transactionId),
  );
  const matchedTxns = input.transactions.filter((txn) => matchedTxnIds.has(txn.id));
  const periodStart = input.periodStart;

  const pending = input.remittances.filter((rem) => {
    if (periodStart && rem.date < periodStart) return false;
    return !remittanceOnStatement(rem, identified, matchedTxns);
  });

  const identifiedCountByCcy = new Map<string, number>();
  for (const rem of input.remittances) {
    if (periodStart && rem.date < periodStart) continue;
    if (!remittanceOnStatement(rem, identified, matchedTxns)) continue;
    identifiedCountByCcy.set(
      rem.currency,
      (identifiedCountByCcy.get(rem.currency) ?? 0) + 1,
    );
  }

  const byCurrency = new Map<string, Remittance[]>();
  for (const rem of pending) {
    const list = byCurrency.get(rem.currency) ?? [];
    list.push(rem);
    byCurrency.set(rem.currency, list);
  }

  const currencies = [...byCurrency.keys()].sort();
  for (const currency of Object.keys(input.closingByCurrency ?? {})) {
    if (!byCurrency.has(currency)) currencies.push(currency);
  }
  const unique = [...new Set(currencies)].sort();

  return unique.map((currency) => {
    const rems = byCurrency.get(currency) ?? [];
    const lines: CashForecastLine[] = rems
      .map((rem) => ({
        id: rem.id,
        party: rem.party,
        direction: (rem.party === "customer" ? "in" : "out") as CashForecastLine["direction"],
        name: rem.name,
        reference: rem.reference,
        amount: rem.amount,
        currency: rem.currency,
        date: rem.date,
        remittanceNumber: rem.remittanceNumber,
        status: rem.status,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    const predictedInflows = lines
      .filter((line) => line.direction === "in")
      .reduce((sum, line) => sum + line.amount, 0);
    const predictedOutflows = lines
      .filter((line) => line.direction === "out")
      .reduce((sum, line) => sum + line.amount, 0);
    const statementClosing = input.closingByCurrency?.[currency] ?? 0;

    return {
      currency,
      predictedInflows,
      predictedOutflows,
      netPredicted: predictedInflows - predictedOutflows,
      statementClosing,
      projectedClosing: statementClosing + predictedInflows - predictedOutflows,
      identifiedCount: identifiedCountByCcy.get(currency) ?? 0,
      forecastCount: lines.length,
      inflowCount: lines.filter((line) => line.direction === "in").length,
      outflowCount: lines.filter((line) => line.direction === "out").length,
      lines,
    };
  });
}
