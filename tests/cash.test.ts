import { describe, expect, it } from "vitest";

import type { BankAccount, BankTransaction } from "@/lib/domain/types";
import { computeCashPosition } from "@/lib/cash/position";

const accounts: BankAccount[] = [
  {
    id: "A",
    name: "Operating",
    bank: "Bank",
    currency: "USD",
    openingBalance: 1000,
  },
  {
    id: "E",
    name: "Euro",
    bank: "Bank",
    currency: "EUR",
    openingBalance: 500,
  },
];

function txn(o: Partial<BankTransaction>): BankTransaction {
  return {
    id: "T",
    accountId: "A",
    date: "2026-08-01",
    description: "",
    amount: 0,
    currency: "USD",
    statementId: "S",
    ...o,
  };
}

describe("computeCashPosition", () => {
  it("computes totals, closing balance and net for one currency", () => {
    const pos = computeCashPosition({
      currency: "USD",
      accounts,
      transactions: [
        txn({ id: "1", amount: 500, date: "2026-08-01" }),
        txn({ id: "2", amount: -200, date: "2026-08-01" }),
        txn({ id: "3", amount: 300, date: "2026-08-02" }),
      ],
    });

    expect(pos.totalInflows).toBe(800);
    expect(pos.totalOutflows).toBe(200);
    expect(pos.netCashFlow).toBe(600);
    expect(pos.closingBalance).toBe(1600);
    expect(pos.accounts).toHaveLength(1);
    expect(pos.accounts[0].closingBalance).toBe(1600);
    expect(pos.accounts[0].reportedClosingBalance).toBeUndefined();
  });

  it("builds a running-balance time series", () => {
    const pos = computeCashPosition({
      currency: "USD",
      accounts,
      transactions: [
        txn({ id: "1", amount: 500, date: "2026-08-01" }),
        txn({ id: "2", amount: -200, date: "2026-08-01" }),
        txn({ id: "3", amount: 300, date: "2026-08-02" }),
      ],
    });

    expect(pos.series).toHaveLength(2);
    expect(pos.series[0]).toMatchObject({
      date: "2026-08-01",
      inflow: 500,
      outflow: 200,
      net: 300,
      runningBalance: 1300,
    });
    expect(pos.series[1].runningBalance).toBe(1600);
  });

  it("only includes accounts and transactions of the reporting currency", () => {
    const pos = computeCashPosition({
      currency: "EUR",
      accounts,
      transactions: [
        txn({ id: "1", amount: 500, currency: "USD", accountId: "A" }),
        txn({ id: "2", amount: 100, currency: "EUR", accountId: "E" }),
      ],
    });
    expect(pos.openingBalance).toBe(500);
    expect(pos.totalInflows).toBe(100);
    expect(pos.accounts).toHaveLength(1);
    expect(pos.accounts[0].accountId).toBe("E");
  });

  it("derives opening from oldest running balance on newest-first listings", () => {
    const pos = computeCashPosition({
      currency: "GBP",
      accounts: [
        {
          id: "HSBC",
          name: "GBP Current",
          bank: "HSBC UK Bank PLC",
          currency: "GBP",
          // Wrong stored opening (closing-brought-forward of the newest line).
          openingBalance: 100_000,
        },
      ],
      transactions: [
        txn({
          id: "L1",
          accountId: "HSBC",
          currency: "GBP",
          date: "2026-08-28",
          lineNumber: 1,
          amount: 10_000,
          balanceAfter: 100_000,
        }),
        txn({
          id: "L2",
          accountId: "HSBC",
          currency: "GBP",
          date: "2026-08-28",
          lineNumber: 2,
          amount: 17_500,
          balanceAfter: 90_000,
        }),
        txn({
          id: "L3",
          accountId: "HSBC",
          currency: "GBP",
          date: "2026-08-28",
          lineNumber: 3,
          amount: -5_000,
          balanceAfter: 72_500,
        }),
        txn({
          id: "L4",
          accountId: "HSBC",
          currency: "GBP",
          date: "2026-08-28",
          lineNumber: 4,
          amount: -2_500,
          balanceAfter: 77_500,
        }),
      ],
    });

    expect(pos.openingBalance).toBe(80_000);
    expect(pos.totalInflows).toBe(27_500);
    expect(pos.totalOutflows).toBe(7_500);
    expect(pos.closingBalance).toBe(100_000);
    expect(pos.accounts[0].reportedClosingBalance).toBe(100_000);
    expect(pos.accounts[0].transactionCount).toBe(4);
  });
});
