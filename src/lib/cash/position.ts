import type {
  AccountCashPosition,
  BankAccount,
  BankTransaction,
  CashFlowPoint,
  CashPosition,
  Currency,
} from "../domain/types";
import {
  closingFromRunningBalances,
  openingFromRunningBalances,
  toRunningBalanceLine,
} from "./opening";

export interface CashPositionInput {
  currency: Currency;
  accounts: BankAccount[];
  transactions: BankTransaction[];
}

function linesFor(txns: BankTransaction[]) {
  return txns.map(toRunningBalanceLine);
}

function openingForAccount(account: BankAccount, txns: BankTransaction[]): number {
  return openingFromRunningBalances(linesFor(txns)) ?? account.openingBalance;
}

/**
 * Compute the cash position for a single reporting currency:
 *   - per-account opening/closing balances and inflow/outflow totals
 *   - a daily time series of inflow, outflow, net and running balance
 *   - the split between Order-to-Cash inflows and Procure-to-Pay outflows
 *
 * When transactions carry a bank running balance, opening is derived from the
 * oldest line (balanceAfter − amount) so newest-first listings such as HSBC
 * are not treated as if "closing brought forward" were the period start.
 */
export function computeCashPosition(input: CashPositionInput): CashPosition {
  const { currency } = input;
  const accounts = input.accounts.filter((a) => a.currency === currency);
  const accountIds = new Set(accounts.map((a) => a.id));
  const transactions = input.transactions.filter(
    (t) => t.currency === currency && accountIds.has(t.accountId),
  );

  const perAccount: AccountCashPosition[] = accounts.map((account) => {
    const txns = transactions.filter((t) => t.accountId === account.id);
    const opening = openingForAccount(account, txns);
    const inflows = txns
      .filter((t) => t.amount > 0)
      .reduce((s, t) => s + t.amount, 0);
    const outflows = txns
      .filter((t) => t.amount < 0)
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const reportedClosing = closingFromRunningBalances(linesFor(txns));
    return {
      accountId: account.id,
      accountName: account.name,
      bank: account.bank,
      currency: account.currency,
      openingBalance: opening,
      inflows: round(inflows),
      outflows: round(outflows),
      closingBalance: round(opening + inflows - outflows),
      transactionCount: txns.length,
      reportedClosingBalance: reportedClosing,
    };
  });

  const openingBalance = perAccount.reduce((s, a) => s + a.openingBalance, 0);
  const totalInflows = round(perAccount.reduce((s, a) => s + a.inflows, 0));
  const totalOutflows = round(perAccount.reduce((s, a) => s + a.outflows, 0));
  const o2cInflows = totalInflows;
  const p2pOutflows = totalOutflows;
  const series = buildSeries(transactions, openingBalance);

  return {
    currency,
    openingBalance: round(openingBalance),
    totalInflows,
    totalOutflows,
    netCashFlow: round(totalInflows - totalOutflows),
    closingBalance: round(openingBalance + totalInflows - totalOutflows),
    accounts: perAccount,
    series,
    o2cInflows,
    p2pOutflows,
    generatedAt: new Date().toISOString(),
  };
}

function buildSeries(
  transactions: BankTransaction[],
  openingBalance: number,
): CashFlowPoint[] {
  const byDate = new Map<string, { inflow: number; outflow: number }>();
  for (const txn of transactions) {
    const entry = byDate.get(txn.date) ?? { inflow: 0, outflow: 0 };
    if (txn.amount > 0) entry.inflow += txn.amount;
    else entry.outflow += Math.abs(txn.amount);
    byDate.set(txn.date, entry);
  }

  const dates = [...byDate.keys()].sort();
  let running = openingBalance;
  return dates.map((date) => {
    const { inflow, outflow } = byDate.get(date)!;
    const net = inflow - outflow;
    running += net;
    return {
      date,
      inflow: round(inflow),
      outflow: round(outflow),
      net: round(net),
      runningBalance: round(running),
    };
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
