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
});
