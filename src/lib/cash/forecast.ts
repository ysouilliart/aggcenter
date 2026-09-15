import type {
  BankTransaction,
  CashForecast,
  CashForecastLine,
  ReconciliationResult,
  Remittance,
} from "../domain/types";
import { amountsMatch, datesMatch } from "../recon/match-notes";

function normalizeKey(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

function identifiedKeys(reconciliation: ReconciliationResult[]): Set<string> {
  const keys = new Set<string>();
  for (const result of reconciliation) {
    if (result.status === "unmatched" || !result.matchedId) continue;
    keys.add(normalizeKey(result.matchedId));
  }
  return keys;
}

function remittanceKeys(rem: Remittance): string[] {
  const keys = [rem.id, rem.reference, rem.remittanceNumber, ...(rem.invoiceNumbers ?? [])];
  return keys
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(normalizeKey);
}

function amountDateMatch(rem: Remittance, txn: BankTransaction): boolean {
  const expectedSign = rem.party === "customer" ? 1 : -1;
  return (
    Math.sign(txn.amount) === expectedSign &&
    txn.currency === rem.currency &&
    amountsMatch(Math.abs(txn.amount), rem.amount) &&
    datesMatch(rem.date, txn.date)
  );
}

/**
 * Remittances already represented on the statement. Id/invoice hits are
 * applied first (any remittance whose keys include a matched SO/PO/remittance
 * id). Amount+date then consumes at most one leftover remittance per matched
 * bank line, and only if that line did not already consume a remittance.
 */
export function consumedRemittanceIds(input: {
  remittances: Remittance[];
  reconciliation: ReconciliationResult[];
  transactions: BankTransaction[];
  periodStart?: string;
}): Set<string> {
  const { remittances, reconciliation, transactions, periodStart } = input;
  const inPeriod = remittances.filter(
    (rem) => !(periodStart && rem.date < periodStart),
  );
  const consumed = new Set<string>();
  const txnConsumed = new Set<string>();
  const identified = identifiedKeys(reconciliation);
  const txnById = new Map(transactions.map((txn) => [txn.id, txn]));

  for (const rem of inPeriod) {
    if (!remittanceKeys(rem).some((key) => identified.has(key))) continue;
    consumed.add(rem.id);
    for (const result of reconciliation) {
      if (result.status === "unmatched" || !result.matchedId) continue;
      if (remittanceKeys(rem).includes(normalizeKey(result.matchedId))) {
        txnConsumed.add(result.transactionId);
      }
    }
  }

  const matchedResults = reconciliation
    .filter((result) => result.status === "matched")
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId),
    );

  for (const result of matchedResults) {
    if (txnConsumed.has(result.transactionId)) continue;
    const txn = txnById.get(result.transactionId);
    if (!txn) continue;

    const leftover = inPeriod
      .filter((rem) => !consumed.has(rem.id) && amountDateMatch(rem, txn))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const pick = leftover[0];
    if (!pick) continue;
    consumed.add(pick.id);
    txnConsumed.add(result.transactionId);
  }

  return consumed;
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
  const periodStart = input.periodStart;
  const consumed = consumedRemittanceIds(input);

  const pending = input.remittances.filter((rem) => {
    if (periodStart && rem.date < periodStart) return false;
    return !consumed.has(rem.id);
  });

  const identifiedCountByCcy = new Map<string, number>();
  for (const rem of input.remittances) {
    if (periodStart && rem.date < periodStart) continue;
    if (!consumed.has(rem.id)) continue;
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
