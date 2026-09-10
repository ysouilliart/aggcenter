import type {
  Anomaly,
  BankAccount,
  BankTransaction,
  ReconciliationResult,
  Remittance,
} from "../domain/types";
import { openingFromRunningBalances, toRunningBalanceLine } from "../cash/opening";
import { formatCentsPlain } from "../money";

export interface AnomalyInput {
  transactions: BankTransaction[];
  reconciliation: ReconciliationResult[];
  remittances: Remittance[];
  accounts: BankAccount[];
}

// Monetary thresholds are in cents.
const UNMATCHED_LARGE_THRESHOLD = 40_000_00;
const UNMATCHED_HIGH_SEVERITY = 75_000_00;
const OUTLIER_K = 2;
const OUTLIER_MIN_SAMPLES = 5;
const DUPLICATE_WINDOW_DAYS = 5;

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

/**
 * Detect operational cash anomalies across bank data and reconciliation output:
 *   - duplicate       : the same payment appears more than once
 *   - amount_mismatch : bank amount differs from the referenced PO/SO
 *   - unmatched_large : a large transaction with no matching document
 *   - missing_receipt : an expected customer receipt never hit the bank
 *   - outlier         : a transaction far larger than its peers
 *   - overdraft_risk  : an account balance drops below zero
 */
export function detectAnomalies(input: AnomalyInput): Anomaly[] {
  const { transactions, reconciliation, remittances, accounts } = input;
  const anomalies: Anomaly[] = [];
  const flagged = new Set<string>();
  const txnById = new Map(transactions.map((t) => [t.id, t]));

  // 1) Duplicates: same account + amount + counterparty within a short window.
  const groups = new Map<string, BankTransaction[]>();
  for (const txn of transactions) {
    const key = `${txn.accountId}|${txn.amount}|${(
      txn.counterparty ??
      txn.reference ??
      ""
    ).toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), txn]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      if (daysBetween(sorted[0].date, sorted[i].date) <= DUPLICATE_WINDOW_DAYS) {
        const txn = sorted[i];
        flagged.add(txn.id);
        anomalies.push({
          id: `AN-DUP-${txn.id}`,
          type: "duplicate",
          severity: "high",
          title: "Possible duplicate payment",
          description: `${txn.counterparty ?? txn.reference ?? "Transaction"} of ${formatCentsPlain(
            Math.abs(txn.amount),
          )} ${txn.currency} on ${txn.date} matches ${sorted[0].date} (${sorted[0].id}).`,
          amount: Math.abs(txn.amount),
          currency: txn.currency,
          date: txn.date,
          relatedIds: [sorted[0].id, txn.id],
        });
      }
    }
  }

  // 2) Amount mismatches: reference matched but bank amount differs.
  for (const r of reconciliation) {
    if (r.status === "partial" && r.matchedId && Math.abs(r.amountDiff) > 0) {
      const txn = txnById.get(r.transactionId);
      anomalies.push({
        id: `AN-MIS-${r.transactionId}`,
        type: "amount_mismatch",
        severity: "medium",
        title: "Amount mismatch vs document",
        description: `Bank amount for ${r.matchedId} differs by ${formatCentsPlain(
          r.amountDiff,
        )} ${r.currency} (${txn?.counterparty ?? ""}).`,
        amount: Math.abs(r.amount),
        currency: r.currency,
        date: r.date,
        relatedIds: [r.transactionId, r.matchedId],
      });
    }
  }

  // 3) Unmatched large transactions.
  for (const r of reconciliation) {
    if (r.status === "unmatched" && Math.abs(r.amount) >= UNMATCHED_LARGE_THRESHOLD) {
      const txn = txnById.get(r.transactionId);
      flagged.add(r.transactionId);
      anomalies.push({
        id: `AN-UNM-${r.transactionId}`,
        type: "unmatched_large",
        severity: Math.abs(r.amount) >= UNMATCHED_HIGH_SEVERITY ? "high" : "medium",
        title: "Large unmatched transaction",
        description: `${
          r.amount > 0 ? "Unidentified receipt" : "Unidentified payment"
        } of ${formatCentsPlain(Math.abs(r.amount))} ${r.currency}${
          txn?.counterparty ? ` (${txn.counterparty})` : ""
        } has no matching ${r.flow === "O2C" ? "sales order" : "purchase order"}.`,
        amount: Math.abs(r.amount),
        currency: r.currency,
        date: r.date,
        relatedIds: [r.transactionId],
      });
    }
  }

  // 4) Missing customer receipts: remittance advised but no bank credit seen.
  const matchedRefs = new Set(
    reconciliation
      .filter((r) => r.matchedId && r.status !== "unmatched")
      .map((r) => r.matchedId as string),
  );
  for (const rem of remittances) {
    if (rem.party !== "customer") continue;
    const hasReceipt =
      matchedRefs.has(rem.reference) ||
      transactions.some(
        (t) =>
          t.amount > 0 &&
          t.currency === rem.currency &&
          Math.abs(Math.abs(t.amount) - rem.amount) <= 1,
      );
    if (!hasReceipt) {
      anomalies.push({
        id: `AN-MISS-${rem.id}`,
        type: "missing_receipt",
        severity: "medium",
        title: "Expected receipt not received",
        description: `Remittance ${rem.id} from ${rem.name} for ${rem.reference} (${formatCentsPlain(rem.amount)} ${rem.currency}) has no matching bank credit.`,
        amount: rem.amount,
        currency: rem.currency,
        date: rem.date,
        relatedIds: [rem.id, rem.reference],
      });
    }
  }

  // 5) Statistical outliers, measured against "normal" (not already-flagged)
  //    transactions of the same currency and direction.
  const pool = transactions.filter((t) => !flagged.has(t.id));
  for (const currency of new Set(pool.map((t) => t.currency))) {
    for (const direction of ["in", "out"] as const) {
      const values = pool.filter(
        (t) =>
          t.currency === currency &&
          (direction === "in" ? t.amount > 0 : t.amount < 0),
      );
      if (values.length < OUTLIER_MIN_SAMPLES) continue;
      const amounts = values.map((t) => Math.abs(t.amount));
      const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      const variance =
        amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length;
      const std = Math.sqrt(variance);
      const threshold = mean + OUTLIER_K * std;
      for (const txn of values) {
        if (Math.abs(txn.amount) > threshold) {
          anomalies.push({
            id: `AN-OUT-${txn.id}`,
            type: "outlier",
            severity: "low",
            title: "Statistical outlier",
            description: `${txn.counterparty ?? txn.reference ?? "Transaction"} of ${formatCentsPlain(
              Math.abs(txn.amount),
            )} ${txn.currency} is well above the typical ${
              direction === "in" ? "receipt" : "payment"
            } (~${formatCentsPlain(Math.round(mean))} ${txn.currency}).`,
            amount: Math.abs(txn.amount),
            currency: txn.currency,
            date: txn.date,
            relatedIds: [txn.id],
          });
        }
      }
    }
  }

  // 6) Overdraft risk: any account whose closing balance falls below zero.
  for (const account of accounts) {
    const txns = transactions.filter((t) => t.accountId === account.id);
    const opening =
      openingFromRunningBalances(txns.map(toRunningBalanceLine)) ??
      account.openingBalance;
    const closing = opening + txns.reduce((s, t) => s + t.amount, 0);
    if (closing < 0) {
      anomalies.push({
        id: `AN-OVR-${account.id}`,
        type: "overdraft_risk",
        severity: "high",
        title: "Overdraft risk",
        description: `${account.name} closing balance is ${formatCentsPlain(closing)} ${account.currency}.`,
        amount: closing,
        currency: account.currency,
        relatedIds: [account.id],
      });
    }
  }

  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  return anomalies.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity],
  );
}
