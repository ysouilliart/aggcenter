import { describe, expect, it } from "vitest";

import type {
  BankTransaction,
  Remittance,
  SalesOrder,
} from "@/lib/domain/types";
import { detectAnomalies } from "@/lib/anomalies/detect";
import { reconcile } from "@/lib/recon/reconcile";

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

const salesOrders: SalesOrder[] = [
  {
    id: "SO-1",
    customer: "Acme",
    amount: 1000,
    currency: "USD",
    orderDate: "2026-07-01",
    dueDate: "2026-07-15",
    status: "invoiced",
  },
  {
    id: "SO-2",
    customer: "Globex",
    amount: 5000,
    currency: "USD",
    orderDate: "2026-07-01",
    dueDate: "2026-07-15",
    status: "invoiced",
  },
];

describe("detectAnomalies", () => {
  const transactions: BankTransaction[] = [
    txn({ id: "dup1", amount: -100, counterparty: "Vendor X", date: "2026-08-01" }),
    txn({ id: "dup2", amount: -100, counterparty: "Vendor X", date: "2026-08-02" }),
    txn({ id: "mismatch", amount: 900, reference: "SO-1", date: "2026-08-03" }),
    txn({ id: "biglarge", amount: 50000, description: "wire", date: "2026-08-04" }),
  ];

  const remittances: Remittance[] = [
    {
      id: "REM-1",
      party: "customer",
      name: "Globex",
      reference: "SO-2",
      amount: 5000,
      currency: "USD",
      date: "2026-08-05",
    },
  ];

  const reconciliation = reconcile({
    transactions,
    salesOrders,
    purchaseOrders: [],
  });

  const anomalies = detectAnomalies({
    transactions,
    reconciliation,
    remittances,
    accounts: [],
  });

  const types = anomalies.map((a) => a.type);

  it("detects duplicate payments", () => {
    expect(types).toContain("duplicate");
  });

  it("detects amount mismatches against referenced documents", () => {
    const mismatch = anomalies.find((a) => a.type === "amount_mismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch?.relatedIds).toContain("SO-1");
  });

  it("detects large unmatched transactions", () => {
    const large = anomalies.find((a) => a.type === "unmatched_large");
    expect(large).toBeDefined();
    expect(large?.amount).toBe(50000);
  });

  it("detects missing customer receipts", () => {
    const missing = anomalies.find((a) => a.type === "missing_receipt");
    expect(missing).toBeDefined();
    expect(missing?.relatedIds).toContain("SO-2");
  });

  it("flags overdraft risk when an account goes negative", () => {
    const result = detectAnomalies({
      transactions: [txn({ id: "x", amount: -2000, accountId: "A" })],
      reconciliation: [],
      remittances: [],
      accounts: [
        {
          id: "A",
          name: "Operating",
          bank: "Bank",
          currency: "USD",
          openingBalance: 1000,
        },
      ],
    });
    expect(result.some((a) => a.type === "overdraft_risk")).toBe(true);
  });
});
