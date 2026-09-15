import { describe, expect, it } from "vitest";
import os from "os";
import path from "path";

import {
  mapSalesOrders,
  mapUkApInvoices,
  mapUkPurchaseOrders,
  mapUkRemittances,
} from "@/lib/reference/fromExtracts";
import { extractMatchTokens, isGbCountry } from "@/lib/reference/util";
import { ingestReferenceDocuments } from "@/lib/reference/ingest";
import { LocalJsonReferenceRepository } from "@/lib/reference/repository";
import { cashObjectPrefix } from "@/lib/cash/paths";
import { LocalStorageProvider } from "@/lib/storage/local";
import { reconcile } from "@/lib/recon/reconcile";
import type { BankTransaction, Remittance } from "@/lib/domain/types";

describe("UK extract mapping", () => {
  it("keeps only GB-tax AP invoices", () => {
    const invoices = mapUkApInvoices({
      headers: [
        {
          invoice_id: "1",
          invoice_number: "INV-GB-1",
          invoice_amount: "10.00",
          invoice_date: "2026/08/01",
          supplier_name: "UK Supplier Ltd",
          invoice_currency: "EUR",
          taxation_country: "GB",
          business_unit: "ResMed EPN",
          invoice_type: "STANDARD",
        },
        {
          invoice_id: "2",
          invoice_number: "INV-IT-1",
          invoice_amount: "20.00",
          invoice_date: "2026/08/01",
          supplier_name: "IT Supplier",
          invoice_currency: "EUR",
          taxation_country: "IT",
          business_unit: "ResMed EPN - Italy",
          invoice_type: "STANDARD",
        },
      ],
      lines: [{ invoice_id: "1", po_number: "PO12345" }],
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      id: "AP-1",
      invoiceNumber: "INV-GB-1",
      amount: 1000,
      poNumbers: ["PO12345"],
      country: "GB",
    });
    expect(isGbCountry("IT")).toBe(false);
  });

  it("aggregates remittance applications to one UK payment", () => {
    const remittances = mapUkRemittances([
      {
        flow_direction: "CUSTOMER_TO_OU",
        source_module: "AR",
        org_id: "112",
        operating_unit_name: "OU: ResMed UK",
        remittance_id: "100",
        remittance_number: "BACS",
        remittance_date: "2026-08-10 00:00:00.00000",
        remittance_status: "APP",
        payment_currency_code: "GBP",
        payment_total_amount: "150.00",
        invoice_number: "2000000001",
        counterparty_name: "NHS Trust Alpha",
      },
      {
        flow_direction: "CUSTOMER_TO_OU",
        source_module: "AR",
        org_id: "112",
        operating_unit_name: "OU: ResMed UK",
        remittance_id: "100",
        remittance_number: "BACS",
        remittance_date: "2026-08-10 00:00:00.00000",
        remittance_status: "APP",
        payment_currency_code: "GBP",
        payment_total_amount: "150.00",
        invoice_number: "2000000002",
        counterparty_name: "NHS Trust Alpha",
      },
    ]);
    expect(remittances).toHaveLength(1);
    expect(remittances[0]).toMatchObject({
      id: "AR-100",
      party: "customer",
      amount: 15000,
      currency: "GBP",
      date: "2026-08-10",
    });
    expect(remittances[0].invoiceNumbers).toEqual(["2000000001", "2000000002"]);
  });

  it("sums net charge components onto a sales order", () => {
    const orders = mapSalesOrders({
      headers: [
        {
          sourcetransid: "88.00000000",
          source_trans_num: "2529032.00000000",
          byng_pty_nme: "ResMed CZ",
          transal_crncy_code: "CZK",
          trans_on: "2026/09/10",
          cust_ponum: "PO-CUST",
        },
      ],
      chargeComponents: [
        {
          source_trans_id: "88.00000000",
          price_element_code: "QP_LIST_PRICE",
          charge_crncy_extended_amount: "100.0",
        },
        {
          source_trans_id: "88.00000000",
          price_element_code: "QP_NET_PRICE",
          charge_crncy_extended_amount: "80.0",
        },
      ],
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("2529032");
    expect(orders[0].amount).toBe(8000);
    expect(orders[0].customerPo).toBe("PO-CUST");
  });

  it("maps UK purchase orders and drops other countries when geography is present", () => {
    const orders = mapUkPurchaseOrders({
      headers: [
        {
          po_number: "UKPO1001",
          vendor_name: "UK Vendor Ltd",
          currency_code: "GBP",
          amount: "250.00",
          ordered_date: "2026/08/01",
          need_by_date: "2026/08/15",
          status: "OPEN",
          operating_unit: "OU: ResMed UK",
          org_id: "112",
          country: "GB",
        },
        {
          po_number: "ITPO9",
          vendor_name: "Italy Vendor",
          currency_code: "EUR",
          amount: "10.00",
          ordered_date: "2026/08/01",
          operating_unit: "ResMed Italy",
          org_id: "99",
          country: "IT",
        },
      ],
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: "PO-UKPO1001",
      vendor: "UK Vendor Ltd",
      amount: 25000,
      currency: "GBP",
      poNumbers: ["UKPO1001", "PO-UKPO1001"],
      status: "open",
    });
  });

  it("sums PO line amounts when the header has no total", () => {
    const orders = mapUkPurchaseOrders({
      headers: [
        {
          po_header_id: "88",
          po_number: "4500123",
          vendor_name: "Parts Co",
          currency_code: "GBP",
          org_id: "112",
        },
      ],
      lines: [
        { po_number: "4500123", line_amount: "100.00" },
        { po_number: "4500123", quantity: "2", unit_price: "25.50" },
      ],
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("PO-4500123");
    expect(orders[0].amount).toBe(15100);
  });

  it("keeps purchase orders that have no geography columns", () => {
    const orders = mapUkPurchaseOrders({
      headers: [
        {
          po_number: "PO-9001",
          vendor_name: "No Geo Ltd",
          currency_code: "USD",
          amount: "12.00",
        },
      ],
    });
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe("PO-9001");
  });
});

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

const rem: Remittance = {
  id: "AR-9",
  party: "customer",
  name: "NHS Trust Alpha",
  reference: "2000000001",
  amount: 15000,
  currency: "GBP",
  date: "2026-08-10",
  invoiceNumbers: ["2000000001"],
};

describe("reconcile remittances", () => {
  it("matches a GBP credit by invoice number in the narrative", () => {
    const [r] = reconcile({
      transactions: [
        txn({
          id: "t1",
          amount: 15000,
          narrative: "Receipt 2000000001 NHS",
        }),
      ],
      salesOrders: [],
      purchaseOrders: [],
      remittances: [rem],
    });
    expect(r.status).toBe("matched");
    expect(r.matchedType).toBe("remittance");
    expect(r.matchedId).toBe("AR-9");
    expect(r.matchPattern).toBe("remittance_invoice_ref");
    expect(r.lookup?.soFound).toBe(false);
    expect(r.lookup?.remittanceFound).toBe(true);
    expect(r.lookup?.source).toMatch(/2000000001/);
    expect(r.lookup?.target).toMatch(/remittance customer GBP/);
    expect(r.remediation).toBeUndefined();
  });

  it("matches a unique remittance amount inside a 5-day window", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "t2", amount: 15000, date: "2026-08-12" })],
      salesOrders: [],
      purchaseOrders: [],
      remittances: [rem],
    });
    expect(r.status).toBe("matched");
    expect(r.matchPattern).toBe("remittance_amount_window");
    expect(r.lookup?.soFound).toBe(false);
    expect(r.lookup?.remittanceFound).toBe(true);
    expect(r.reasons[0]).toMatch(/date window/);
    expect(r.lookup?.approach).toMatch(/±5d/);
  });

  it("still matches sample SO references", () => {
    const [r] = reconcile({
      transactions: [
        txn({
          id: "t3",
          amount: 1000,
          currency: "USD",
          reference: "SO-1",
        }),
      ],
      salesOrders: [
        {
          id: "SO-1",
          customer: "Acme",
          amount: 1000,
          currency: "USD",
          orderDate: "2026-07-01",
          dueDate: "2026-07-15",
          status: "invoiced",
        },
      ],
      purchaseOrders: [],
      remittances: [rem],
    });
    expect(r.status).toBe("matched");
    expect(r.matchedId).toBe("SO-1");
  });

  it("extracts invoice-like tokens from mixed bank text", () => {
    expect(extractMatchTokens(["R0359X 2000859443 OGILVIE"])).toContain("2000859443");
    expect(extractMatchTokens(["SO-5001 customer"])).toContain("SO-5001");
  });

  it("explains a missing remittance token and proposes loading the invoice", () => {
    const [r] = reconcile({
      transactions: [
        txn({
          id: "miss",
          amount: 4400,
          narrative: "Receipt 064613",
          customerReference: "064613",
        }),
      ],
      salesOrders: [],
      purchaseOrders: [],
      remittances: [rem],
    });
    expect(r.status).toBe("unmatched");
    expect(r.matchPattern).toBe("exhausted");
    expect(r.lookup?.soFound).toBe(false);
    expect(r.lookup?.remittanceFound).toBe(false);
    expect(r.lookup?.tokens).toContain("064613");
    expect(r.lookup?.source).toMatch(/064613/);
    expect(r.lookup?.approach).toMatch(/remittance invoice\/payment ref → 0/);
    expect(r.remediation).toMatch(/map bank customerReference → Oracle invoice/);
  });

  it("flags an ambiguous remittance amount window and asks for invoice numbers", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "amb-rem", amount: 15000, date: "2026-08-12" })],
      salesOrders: [],
      purchaseOrders: [],
      remittances: [
        rem,
        { ...rem, id: "AR-10", name: "Other Trust", invoiceNumbers: ["2000000099"] },
      ],
    });
    expect(r.status).toBe("unmatched");
    expect(r.lookup?.remittanceFound).toBe(true);
    expect(r.lookup?.soFound).toBe(false);
    expect(r.lookup?.approach).toMatch(/remittance amount ±5d → 2/);
    expect(r.remediation).toMatch(/counterparty alias|invoice numbers/);
  });

  it("proposes a short-pay check when remittance ref hits but amount differs", () => {
    const [r] = reconcile({
      transactions: [
        txn({
          id: "short",
          amount: 14000,
          narrative: "Receipt 2000000001",
        }),
      ],
      salesOrders: [],
      purchaseOrders: [],
      remittances: [rem],
    });
    expect(r.status).toBe("partial");
    expect(r.matchPattern).toBe("remittance_invoice_ref");
    expect(r.lookup?.remittanceFound).toBe(true);
    expect(r.remediation).toMatch(/short-pay|split applications/);
  });

  it("matches a debit to a native purchase-order number", () => {
    const [po] = mapUkPurchaseOrders({
      headers: [
        {
          po_number: "45001234",
          vendor_name: "UK Vendor Ltd",
          currency_code: "GBP",
          amount: "250.00",
          org_id: "112",
        },
      ],
    });
    const [r] = reconcile({
      transactions: [
        txn({
          id: "po-debit",
          amount: -25000,
          currency: "GBP",
          reference: "PO-45001234",
          narrative: "Payment PO-45001234",
        }),
      ],
      salesOrders: [],
      purchaseOrders: [po],
    });
    expect(r.status).toBe("matched");
    expect(r.matchedType).toBe("PO");
    expect(r.matchedId).toBe("PO-45001234");
  });
});

function csv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

describe("ingestReferenceDocuments", () => {
  it("loads AP, PO, SO and remittance CSVs from the UK org folders", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const storage = new LocalStorageProvider(
      path.join(os.tmpdir(), `aggc-ref-store-${stamp}`),
    );
    const repo = new LocalJsonReferenceRepository(
      path.join(os.tmpdir(), `aggc-ref-${stamp}.json`),
    );

    await storage.put(
      `${cashObjectPrefix("inv")}ap_invoice_header.csv`,
      Buffer.from(
        csv(
          [
            "invoice_id",
            "invoice_number",
            "invoice_amount",
            "invoice_date",
            "supplier_name",
            "invoice_currency",
            "taxation_country",
            "business_unit",
            "invoice_type",
          ],
          [
            [
              "1",
              "INV-GB-1",
              "10.00",
              "2026/08/01",
              "UK Supplier Ltd",
              "GBP",
              "GB",
              "ResMed UK",
              "STANDARD",
            ],
          ],
        ),
      ),
    );
    await storage.put(
      `${cashObjectPrefix("inv")}ap_invoice_line.csv`,
      Buffer.from(csv(["invoice_id", "po_number"], [["1", "PO12345"]])),
    );
    await storage.put(
      `${cashObjectPrefix("po")}po_header.csv`,
      Buffer.from(
        csv(
          [
            "po_number",
            "vendor_name",
            "currency_code",
            "amount",
            "ordered_date",
            "org_id",
            "country",
          ],
          [["UKPO1001", "UK Vendor Ltd", "GBP", "250.00", "2026/08/01", "112", "GB"]],
        ),
      ),
    );
    await storage.put(
      `${cashObjectPrefix("so")}sales_order_header.csv`,
      Buffer.from(
        csv(
          ["sourcetransid", "source_trans_num", "byng_pty_nme", "transal_crncy_code", "trans_on"],
          [["88.00000000", "2529032.00000000", "ResMed CZ", "CZK", "2026/09/10"]],
        ),
      ),
    );
    await storage.put(
      `${cashObjectPrefix("so")}charges_component.csv`,
      Buffer.from(
        csv(
          ["source_trans_id", "price_element_code", "charge_crncy_extended_amount"],
          [["88.00000000", "QP_NET_PRICE", "80.0"]],
        ),
      ),
    );
    await storage.put(
      `${cashObjectPrefix("rem")}remittance.csv`,
      Buffer.from(
        csv(
          [
            "flow_direction",
            "source_module",
            "org_id",
            "operating_unit_name",
            "remittance_id",
            "remittance_number",
            "remittance_date",
            "payment_currency_code",
            "payment_total_amount",
            "invoice_number",
            "counterparty_name",
          ],
          [
            [
              "CUSTOMER_TO_OU",
              "AR",
              "112",
              "OU: ResMed UK",
              "100",
              "BACS",
              "2026-08-10 00:00:00.00000",
              "GBP",
              "150.00",
              "2000000001",
              "NHS Trust Alpha",
            ],
          ],
        ),
      ),
    );

    const result = await ingestReferenceDocuments({ storage, repo });
    expect(result.errors).toEqual([]);
    expect(result.orgRoot).toBe("aggCenter/ORG_112 - UK");
    expect(result.apInvoices).toBe(1);
    expect(result.purchaseOrders).toBe(1);
    expect(result.salesOrders).toBe(1);
    expect(result.remittances).toBe(1);
    expect(result.files.map((f) => f.key).sort()).toEqual([
      "aggCenter/ORG_112 - UK/inv/ap_invoice_header.csv",
      "aggCenter/ORG_112 - UK/inv/ap_invoice_line.csv",
      "aggCenter/ORG_112 - UK/po/po_header.csv",
      "aggCenter/ORG_112 - UK/rem/remittance.csv",
      "aggCenter/ORG_112 - UK/so/charges_component.csv",
      "aggCenter/ORG_112 - UK/so/sales_order_header.csv",
    ]);

    const counts = await repo.counts();
    expect(counts).toEqual({
      salesOrders: 1,
      purchaseOrders: 1,
      apInvoices: 1,
      remittances: 1,
    });
    const pos = await repo.listPurchaseOrders();
    expect(pos.map((p) => p.id).sort()).toEqual(["AP-1", "PO-UKPO1001"]);
  });
});

