import { describe, expect, it } from "vitest";

import type {
  BankTransaction,
  PurchaseOrder,
  Remittance,
  SalesOrder,
} from "@/lib/domain/types";
import { foundFlags, type MatchContext } from "@/lib/recon/match-notes";
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
    expect(r.lookup?.narrative).toBe("");
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
    expect(r.lookup?.poFound).toBe(true);
    expect(r.lookup?.supportingDocs.some((d) => d.id === "PO-1")).toBe(true);
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
    expect(r.lookup?.narrative).toBe("wire");
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
    expect(r.lookup?.narrative).toBe("");
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

  it("keeps remittance numbers visible when many SOs share the amount", () => {
    const salesOrdersMany: SalesOrder[] = Array.from({ length: 12 }, (_, i) => ({
      ...salesOrders[0],
      id: `SO-${i + 1}`,
    }));
    const [r] = reconcile({
      transactions: [txn({ id: "crowd", amount: 1000, description: "wire" })],
      salesOrders: salesOrdersMany,
      purchaseOrders,
      remittances: [
        remittance({ id: "AR-1", remittanceNumber: "REM-100" }),
        remittance({
          id: "AR-2",
          remittanceNumber: "REM-200",
          reference: "INV-200",
          invoiceNumbers: ["INV-200"],
        }),
      ],
    });
    expect(r.status).toBe("partial");
    expect(r.lookup?.soFound).toBe(true);
    expect(r.lookup?.remittanceFound).toBe(true);
    const labels = (r.lookup?.supportingDocs ?? []).map((d) => d.label).join(" ");
    expect(labels).toMatch(/REM-100/);
    expect(labels).toMatch(/REM-200/);
    expect(labels).toMatch(/SO-/);
  });

  it("does not list every amount-sharing SO when a remittance uniquely matches", () => {
    const salesOrdersMany: SalesOrder[] = Array.from({ length: 12 }, (_, i) => ({
      ...salesOrders[0],
      id: `SO-${i + 1}`,
    }));
    const [r] = reconcile({
      transactions: [txn({ id: "unique-rem", amount: 1000, description: "wire" })],
      salesOrders: salesOrdersMany,
      purchaseOrders,
      remittances: [remittance()],
    });
    expect(r.status).toBe("matched");
    expect(r.matchedType).toBe("remittance");
    expect(r.lookup?.remittanceFound).toBe(true);
    expect(r.lookup?.soFound).toBe(true);
    const docs = r.lookup?.supportingDocs ?? [];
    expect(docs.some((d) => d.label.includes("REM-100"))).toBe(true);
    expect(docs.filter((d) => d.kind === "SO")).toHaveLength(0);
  });
});

describe("analysis plan and remittance precedence", () => {
  it("prefers a unique remittance exact amount when SO id hits but amount differs", () => {
    const [r] = reconcile({
      transactions: [
        txn({
          id: "health",
          amount: 12769,
          currency: "GBP",
          narrative: "THE HEALTH SUITE L /EREF/3139693 /ROC/3139693",
          sourceFile: "UK GBP HSBC CURRENT ACC AUG-26_3840.pdf",
          lineNumber: 249,
          page: 23,
        }),
      ],
      salesOrders: [
        {
          id: "3139693",
          customer: "The Health Suite",
          amount: 10641,
          currency: "GBP",
          orderDate: "2026-09-14",
          dueDate: "2026-09-14",
          status: "invoiced",
          sourceFile: "SO_Header_112.csv",
          sourceRow: 57963,
        },
      ],
      purchaseOrders: [],
      remittances: [
        {
          id: "AR-12068352",
          party: "customer",
          name: "The Health Suite",
          reference: "2000854260",
          amount: 12769,
          currency: "GBP",
          date: "2026-08-19",
          remittanceNumber: "BACS",
          invoiceNumbers: ["2000854260"],
          sourceFile: "remittance_112.csv",
          sourceRow: 7208,
        },
      ],
    });
    expect(r.status).toBe("matched");
    expect(r.matchedType).toBe("remittance");
    expect(r.matchedId).toBe("AR-12068352");
    expect(r.lookup?.soFound).toBe(true);
    expect(r.lookup?.analysisPlan?.[0]).toMatchObject({
      label: "Bank baseline",
      fileName: "UK GBP HSBC CURRENT ACC AUG-26_3840.pdf",
      row: 249,
      page: 23,
    });
    expect(
      r.lookup?.analysisPlan?.some(
        (step) => step.fileName === "SO_Header_112.csv" && step.row === 57963,
      ),
    ).toBe(true);
    expect(
      r.lookup?.analysisPlan?.some(
        (step) => step.fileName === "remittance_112.csv" && step.row === 7208,
      ),
    ).toBe(true);
    expect(r.lookup?.analysisPlan?.at(-1)?.label).toBe("Result");
    expect(
      r.lookup?.analysisPlan?.find((step) => /invoice\/payment ref/.test(step.label))?.detail,
    ).toBe("0 hit(s)");
  });

  it("prefers a unique remittance when PO/AP invoice amount differs", () => {
    const [r] = reconcile({
      transactions: [
        txn({
          id: "fleet",
          amount: -1028366,
          currency: "GBP",
          narrative: "3MJN335-278103, FLEET OPERATIONS",
          sourceFile: "UK GBP HSBC CURRENT ACC AUG-26_3840.pdf",
          lineNumber: 248,
          page: 23,
        }),
      ],
      salesOrders: [],
      purchaseOrders: [
        {
          id: "AP-13338806",
          vendor: "FLEET OPERATIONS LIMITED",
          amount: 0,
          currency: "GBP",
          orderDate: "2026-07-26",
          dueDate: "2026-07-26",
          status: "billed",
          invoiceNumber: "278103",
          sourceFile: "INV_Header_112.csv",
          sourceRow: 18138,
        },
      ],
      remittances: [
        {
          id: "AP-6798339",
          party: "vendor",
          name: "FLEET OPERATIONS LIMITED",
          reference: "278103",
          amount: 1028366,
          currency: "GBP",
          date: "2026-08-20",
          remittanceNumber: "114388",
          invoiceNumbers: ["278103"],
          sourceFile: "remittance_112.csv",
          sourceRow: 7150,
        },
      ],
    });
    expect(r.status).toBe("matched");
    expect(r.matchedType).toBe("remittance");
    expect(r.matchedId).toBe("AP-6798339");
    expect(r.matchPattern).toBe("remittance_invoice_ref");
    expect(r.lookup?.poFound).toBe(true);
    expect(
      r.lookup?.analysisPlan?.some(
        (step) => step.fileName === "INV_Header_112.csv" && step.row === 18138,
      ),
    ).toBe(true);
    expect(
      r.lookup?.analysisPlan?.some(
        (step) => step.fileName === "remittance_112.csv" && step.row === 7150,
      ),
    ).toBe(true);
  });
});

function emptyMatchCtx(
  overrides: Partial<MatchContext> & Pick<MatchContext, "flow">,
): MatchContext {
  return {
    txn: txn({ id: "ctx", amount: overrides.flow === "P2P" ? -500 : 500 }),
    tokens: [],
    soLoaded: 0,
    poLoaded: 0,
    remLoaded: 0,
    soIdHits: 0,
    poIdHits: 0,
    poInvoiceHits: 0,
    remRefHits: 0,
    remWindowHits: 0,
    remNamedHits: 0,
    soPoAmountHits: 0,
    attempts: [],
    soDocs: [],
    poDocs: [],
    remDocs: [],
    ...overrides,
  };
}

describe("foundFlags", () => {
  it("sets poFound from P2P id hits even when invoice and amount hits are zero", () => {
    const flags = foundFlags(
      emptyMatchCtx({
        flow: "P2P",
        poIdHits: 1,
        poDocs: [{ kind: "PO", id: "PO-1", number: "PO-1", label: "PO PO-1" }],
      }),
    );
    expect(flags.poFound).toBe(true);
    expect(flags.soFound).toBe(false);
  });

  it("does not treat SO id hits as a P2P PO find", () => {
    const flags = foundFlags(
      emptyMatchCtx({
        flow: "P2P",
        soIdHits: 2,
      }),
    );
    expect(flags.poFound).toBe(false);
  });
});
