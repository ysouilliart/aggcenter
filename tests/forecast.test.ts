import { describe, expect, it } from "vitest";

import { buildCashForecast } from "@/lib/cash/forecast";
import type {
  BankTransaction,
  ReconciliationResult,
  Remittance,
} from "@/lib/domain/types";

function txn(o: Partial<BankTransaction>): BankTransaction {
  return {
    id: "T",
    accountId: "A",
    date: "2026-08-10",
    description: "",
    amount: 0,
    currency: "GBP",
    statementId: "S",
    ...o,
  };
}

function rem(o: Partial<Remittance>): Remittance {
  return {
    id: "AR-1",
    party: "customer",
    name: "NHS",
    reference: "INV-1",
    amount: 15_000_00,
    currency: "GBP",
    date: "2026-08-10",
    ...o,
  };
}

function matched(o: Partial<ReconciliationResult>): ReconciliationResult {
  return {
    transactionId: "T1",
    accountId: "A",
    date: "2026-08-10",
    amount: 15_000_00,
    currency: "GBP",
    flow: "O2C",
    status: "matched",
    matchedType: "remittance",
    matchedId: "AR-1",
    confidence: 1,
    amountDiff: 0,
    reasons: [],
    ...o,
  };
}

describe("buildCashForecast", () => {
  it("treats unidentified customer remittances as predicted in, vendor as predicted out", () => {
    const forecasts = buildCashForecast({
      remittances: [
        rem({ id: "AR-OPEN", amount: 8_000_00, date: "2026-08-20" }),
        rem({
          id: "AP-OPEN",
          party: "vendor",
          name: "Supplier",
          reference: "PO-9",
          amount: 3_000_00,
          date: "2026-08-22",
        }),
      ],
      reconciliation: [],
      transactions: [txn({ id: "T0", amount: 100, date: "2026-08-01" })],
      periodStart: "2026-08-01",
      closingByCurrency: { GBP: 100_000_00 },
    });

    expect(forecasts).toHaveLength(1);
    expect(forecasts[0].predictedInflows).toBe(8_000_00);
    expect(forecasts[0].predictedOutflows).toBe(3_000_00);
    expect(forecasts[0].netPredicted).toBe(5_000_00);
    expect(forecasts[0].projectedClosing).toBe(105_000_00);
    expect(forecasts[0].forecastCount).toBe(2);
    expect(forecasts[0].inflowCount).toBe(1);
    expect(forecasts[0].outflowCount).toBe(1);
    expect(forecasts[0].identifiedCount).toBe(0);
  });

  it("excludes remittances that already identified a bank line", () => {
    const forecasts = buildCashForecast({
      remittances: [
        rem({ id: "AR-1", amount: 15_000_00 }),
        rem({ id: "AR-2", amount: 4_000_00, date: "2026-08-18", reference: "INV-2" }),
      ],
      reconciliation: [matched({ matchedId: "AR-1", transactionId: "T1" })],
      transactions: [txn({ id: "T1", amount: 15_000_00 })],
      periodStart: "2026-08-01",
      closingByCurrency: { GBP: 50_000_00 },
    });

    expect(forecasts[0].identifiedCount).toBe(1);
    expect(forecasts[0].forecastCount).toBe(1);
    expect(forecasts[0].lines[0].id).toBe("AR-2");
    expect(forecasts[0].predictedInflows).toBe(4_000_00);
  });

  it("excludes a remittance whose SO/invoice already matched the bank line", () => {
    const forecasts = buildCashForecast({
      remittances: [rem({ id: "AR-9", reference: "SO-1", amount: 10_000_00 })],
      reconciliation: [
        matched({
          matchedType: "SO",
          matchedId: "SO-1",
          transactionId: "T1",
          amount: 10_000_00,
        }),
      ],
      transactions: [txn({ id: "T1", amount: 10_000_00 })],
      periodStart: "2026-08-01",
    });

    expect(forecasts[0]?.forecastCount ?? 0).toBe(0);
  });

  it("ignores remittances from before the statement period", () => {
    const forecasts = buildCashForecast({
      remittances: [rem({ id: "AR-OLD", date: "2026-07-01", amount: 9_000_00 })],
      reconciliation: [],
      transactions: [txn({ date: "2026-08-01" })],
      periodStart: "2026-08-01",
      closingByCurrency: { GBP: 1 },
    });

    expect(forecasts[0].forecastCount).toBe(0);
    expect(forecasts[0].predictedInflows).toBe(0);
  });

  it("does not exclude a second remittance when one matched line already consumed via id", () => {
    // Before 1:1, AR-2 would also drop because it shares amount+date with T1.
    const forecasts = buildCashForecast({
      remittances: [
        rem({ id: "AR-1", amount: 15_000_00, date: "2026-08-10", reference: "INV-1" }),
        rem({ id: "AR-2", amount: 15_000_00, date: "2026-08-11", reference: "INV-2" }),
      ],
      reconciliation: [matched({ matchedId: "AR-1", transactionId: "T1", amount: 15_000_00 })],
      transactions: [txn({ id: "T1", amount: 15_000_00, date: "2026-08-10" })],
      periodStart: "2026-08-01",
      closingByCurrency: { GBP: 50_000_00 },
    });

    expect(forecasts[0].identifiedCount).toBe(1);
    expect(forecasts[0].forecastCount).toBe(1);
    expect(forecasts[0].lines.map((line) => line.id)).toEqual(["AR-2"]);
    expect(forecasts[0].predictedInflows).toBe(15_000_00);
  });

  it("consumes only one leftover remittance per matched txn via exact amount and same date", () => {
    const forecasts = buildCashForecast({
      remittances: [
        rem({ id: "AR-A", amount: 15_000_00, date: "2026-08-10", reference: "INV-A" }),
        rem({ id: "AR-B", amount: 15_000_00, date: "2026-08-12", reference: "INV-B" }),
      ],
      reconciliation: [
        matched({
          matchedType: "SO",
          matchedId: "SO-9",
          transactionId: "T1",
          amount: 15_000_00,
        }),
      ],
      transactions: [txn({ id: "T1", amount: 15_000_00, date: "2026-08-10" })],
      periodStart: "2026-08-01",
      closingByCurrency: { GBP: 1 },
    });

    expect(forecasts[0].identifiedCount).toBe(1);
    expect(forecasts[0].forecastCount).toBe(1);
    expect(forecasts[0].lines.map((line) => line.id)).toEqual(["AR-B"]);
    expect(forecasts[0].predictedInflows).toBe(15_000_00);
  });

  it("lets two matched txns consume two same-amount remittances 1:1", () => {
    const forecasts = buildCashForecast({
      remittances: [
        rem({ id: "AR-A", amount: 15_000_00, date: "2026-08-10", reference: "INV-A" }),
        rem({ id: "AR-B", amount: 15_000_00, date: "2026-08-11", reference: "INV-B" }),
      ],
      reconciliation: [
        matched({
          matchedType: "SO",
          matchedId: "SO-8",
          transactionId: "T1",
          amount: 15_000_00,
          date: "2026-08-10",
        }),
        matched({
          matchedType: "SO",
          matchedId: "SO-9",
          transactionId: "T2",
          amount: 15_000_00,
          date: "2026-08-11",
        }),
      ],
      transactions: [
        txn({ id: "T1", amount: 15_000_00, date: "2026-08-10" }),
        txn({ id: "T2", amount: 15_000_00, date: "2026-08-11" }),
      ],
      periodStart: "2026-08-01",
      closingByCurrency: { GBP: 1 },
    });

    expect(forecasts[0].identifiedCount).toBe(2);
    expect(forecasts[0].forecastCount).toBe(0);
  });
});
