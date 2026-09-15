import { describe, expect, it } from "vitest";

import type {
  BankTransaction,
  PurchaseOrder,
  Remittance,
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
    expect(r.lookup?.supportingDocs.map((d) => d.id).sort()).toEqual([
      "SO-1",
      "SO-9",
    ]);
    expect(r.lookup?.supportingDocs.every((d) => d.label.includes("SO"))).toBe(
      true,
    );
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

function remittance(overrides: Partial<Remittance> = {}): Remittance {
  return {
    id: "AR-1",
    party: "customer",
    name: "Acme",
    reference: "INV-100",
    remittanceNumber: "REM-100",
    amount: 1000,
    currency: "USD",
    date: "2026-08-01",
    invoiceNumbers: ["INV-100"],
    ...overrides,
  };
}

describe("reconcile supporting documents", () => {
  it("treats a unique SO id plus a unique remittance as a match and lists both numbers", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "so-rem", amount: 1000, reference: "SO-1" })],
      salesOrders,
      purchaseOrders,
      remittances: [remittance()],
    });
    expect(r.status).toBe("matched");
    expect(r.matchedType).toBe("SO");
    expect(r.matchedId).toBe("SO-1");
    expect(r.lookup?.soFound).toBe(true);
    expect(r.lookup?.remittanceFound).toBe(true);
    const labels = (r.lookup?.supportingDocs ?? []).map((d) => d.label).join(" ");
    expect(labels).toMatch(/SO-1/);
    expect(labels).toMatch(/REM-100/);
  });

  it("matches when a unique remittance and a unique SO both identify the line", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "both", amount: 1000, description: "wire" })],
      salesOrders,
      purchaseOrders,
      remittances: [remittance()],
    });
    expect(r.status).toBe("matched");
    expect(r.lookup?.soFound).toBe(true);
    expect(r.lookup?.remittanceFound).toBe(true);
    const labels = (r.lookup?.supportingDocs ?? []).map((d) => d.label).join(" ");
    expect(labels).toMatch(/REM-100/);
    expect(labels).toMatch(/SO-1/);
    expect(r.lookup?.supportingDocs.map((d) => d.kind).sort()).toEqual([
      "SO",
      "remittance",
    ]);
  });

  it("lists remittance numbers on a remittance match", () => {
    const [r] = reconcile({
      transactions: [
        txn({
          id: "rem-ref",
          amount: 1000,
          narrative: "Receipt INV-100 Acme",
        }),
      ],
      salesOrders: [],
      purchaseOrders,
      remittances: [remittance()],
    });
    expect(r.status).toBe("matched");
    expect(r.matchedType).toBe("remittance");
    expect(r.lookup?.supportingDocs[0]?.number).toBe("REM-100");
    expect(r.lookup?.supportingDocs[0]?.label).toMatch(/REM-100/);
  });

  it("lists PO and remittance numbers when several share the amount", () => {
    const pos: PurchaseOrder[] = [
      { ...purchaseOrders[0], id: "PO-1", amount: 500 },
      { ...purchaseOrders[0], id: "PO-9", amount: 500 },
    ];
    const remittances: Remittance[] = [
      remittance({
        id: "AP-1",
        party: "vendor",
        name: "CloudHost",
        remittanceNumber: "REM-V-1",
        reference: "INV-V-1",
        amount: 500,
        invoiceNumbers: ["INV-V-1"],
      }),
      remittance({
        id: "AP-2",
        party: "vendor",
        name: "Other Host",
        remittanceNumber: "REM-V-2",
        reference: "INV-V-2",
        amount: 500,
        invoiceNumbers: ["INV-V-2"],
      }),
    ];
    const [r] = reconcile({
      transactions: [txn({ id: "p2p-amb", amount: -500, description: "payment" })],
      salesOrders,
      purchaseOrders: pos,
      remittances,
    });
    expect(r.status).toBe("partial");
    expect(r.matchedId).toBeUndefined();
    expect(r.lookup?.poFound).toBe(true);
    expect(r.lookup?.remittanceFound).toBe(true);
    const labels = (r.lookup?.supportingDocs ?? []).map((d) => d.label).join(" ");
    expect(labels).toMatch(/PO-1/);
    expect(labels).toMatch(/PO-9/);
    expect(labels).toMatch(/REM-V-1/);
    expect(labels).toMatch(/REM-V-2/);
  });
});
