/**
 * Derive the cash-position opening from bank running balances.
 *
 * HSBC "Statement details" listings are newest-first: line 1 is the most
 * recent posting, and "Closing ledger brought forward" matches that newest
 * running balance (period close), not the start-of-period opening.
 */

export interface RunningBalanceLine {
  date: string;
  amount: number;
  balanceAfter?: number;
  lineNumber?: number;
}

/** Oldest first. When both rows have line numbers, larger line = older (newest-first listing). */
export function compareChronological(
  a: RunningBalanceLine,
  b: RunningBalanceLine,
): number {
  const byDate = a.date.localeCompare(b.date);
  if (byDate !== 0) return byDate;
  if (a.lineNumber != null && b.lineNumber != null) {
    return b.lineNumber - a.lineNumber;
  }
  return 0;
}

export function openingFromRunningBalances(
  lines: RunningBalanceLine[],
): number | undefined {
  const withBal = lines.filter((l) => l.balanceAfter != null);
  if (withBal.length === 0) return undefined;
  const oldest = [...withBal].sort(compareChronological)[0];
  return oldest.balanceAfter! - oldest.amount;
}

export function closingFromRunningBalances(
  lines: RunningBalanceLine[],
): number | undefined {
  const withBal = lines.filter((l) => l.balanceAfter != null);
  if (withBal.length === 0) return undefined;
  const newest = [...withBal].sort(compareChronological).at(-1);
  return newest?.balanceAfter;
}

export function toRunningBalanceLine(txn: {
  date: string;
  amount: number;
  balanceAfter?: number;
  lineNumber?: number;
}): RunningBalanceLine {
  return {
    date: txn.date,
    amount: txn.amount,
    balanceAfter: txn.balanceAfter,
    lineNumber: txn.lineNumber,
  };
}
