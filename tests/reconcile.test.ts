import { describe, expect, it } from "vitest";

import type {
  BankTransaction,
  PurchaseOrder,
  SalesOrder,
} from "@/lib/domain/types";
import { reconcile, summarize } from "@/lib/recon/reconcile";

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
];

const purchaseOrders: PurchaseOrder[] = [
  {
    id: "PO-1",
    vendor: "CloudHost",
    amount: 500,
    currency: "USD",
    orderDate: "2026-07-01",
    dueDate: "2026-07-15",
    status: "billed",
  },
];

function txn(overrides: Partial<BankTransaction>): BankTransaction {
  return {
    id: "T",
    accountId: "ACC-1",
    date: "2026-08-01",
    description: "",
    amount: 0,
    currency: "USD",
    statementId: "S",
    ...overrides,
  };
}

describe("reconcile", () => {
  it("matches a credit to a sales order by reference and amount", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "t1", amount: 1000, reference: "SO-1" })],
      salesOrders,
      purchaseOrders,
    });
    expect(r.status).toBe("matched");
    expect(r.flow).toBe("O2C");
    expect(r.matchedType).toBe("SO");
    expect(r.matchedId).toBe("SO-1");
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(r.matchPattern).toBe("so_po_id");
    expect(r.lookup?.soFound).toBe(true);
    expect(r.lookup?.remittanceFound).toBe(false);
    expect(r.reasons[0]).toMatch(/SO\/PO id token/);
    expect(r.remediation).toBeUndefined();
  });

  it("flags a reference match with wrong amount as partial", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "t2", amount: 900, reference: "SO-1" })],
      salesOrders,
      purchaseOrders,
    });
    expect(r.status).toBe("partial");
    expect(r.amountDiff).toBe(-100);
    expect(r.matchPattern).toBe("so_po_id");
    expect(r.lookup?.soFound).toBe(true);
    expect(r.remediation).toMatch(/partial collection|FX/);
  });

  it("matches a debit to a purchase order", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "t3", amount: -500, reference: "PO-1" })],
      salesOrders,
      purchaseOrders,
    });
    expect(r.status).toBe("matched");
    expect(r.flow).toBe("P2P");
    expect(r.matchedType).toBe("PO");
  });

  it("falls back to a unique amount match without a reference", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "t4", amount: 1000, description: "wire" })],
      salesOrders,
      purchaseOrders,
    });
    expect(r.status).toBe("matched");
    expect(r.matchedId).toBe("SO-1");
    expect(r.confidence).toBeCloseTo(0.7);
    expect(r.matchPattern).toBe("so_po_unique_amount");
    expect(r.lookup?.soFound).toBe(true);
    expect(r.lookup?.source).toMatch(/no invoice token/);
  });

  it("marks an ambiguous amount match (multiple candidates) as partial", () => {
    const twoSameAmount: SalesOrder[] = [
      { ...salesOrders[0], id: "SO-1" },
      { ...salesOrders[0], id: "SO-9" },
    ];
    const [r] = reconcile({
      transactions: [txn({ id: "amb", amount: 1000, description: "wire" })],
      salesOrders: twoSameAmount,
      purchaseOrders,
    });
    expect(r.status).toBe("partial");
    expect(r.matchedId).toBeUndefined();
    expect(r.matchPattern).toBe("exhausted");
    expect(r.lookup?.soFound).toBe(true);
    expect(r.lookup?.candidateCount).toBe(2);
    expect(r.remediation).toMatch(/ambiguous/);
    expect(r.reasons.join(" ")).toMatch(/ambiguous/);
  });

  it("marks a transaction with no candidate as unmatched", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "t5", amount: 250 })],
      salesOrders,
      purchaseOrders,
    });
    expect(r.status).toBe("unmatched");
    expect(r.matchPattern).toBe("exhausted");
    expect(r.lookup?.soFound).toBe(false);
    expect(r.lookup?.remittanceFound).toBe(false);
    expect(r.lookup?.source).toMatch(/no invoice token/);
    expect(r.lookup?.target).toMatch(/SO USD/);
    expect(r.remediation).toMatch(/payroll\/tax\/internal|missing remittance/);
  });

  it("summarizes counts and value-weighted match rate", () => {
    const results = reconcile({
      transactions: [
        txn({ id: "a", amount: 1000, reference: "SO-1" }),
        txn({ id: "b", amount: -500, reference: "PO-1" }),
        txn({ id: "c", amount: 250 }),
      ],
      salesOrders,
      purchaseOrders,
    });
    const s = summarize(results);
    expect(s.total).toBe(3);
    expect(s.matched).toBe(2);
    expect(s.unmatched).toBe(1);
    // 1500 reconciled of 1750 total.
    expect(s.matchRate).toBeCloseTo(1500 / 1750, 5);
  });
});
