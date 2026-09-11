import { describe, expect, it } from "vitest";

import {
  mapSalesOrders,
  mapUkApInvoices,
  mapUkRemittances,
} from "@/lib/reference/fromExtracts";
import { extractMatchTokens, isGbCountry } from "@/lib/reference/util";
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
  });

  it("matches a unique remittance amount inside a 5-day window", () => {
    const [r] = reconcile({
      transactions: [txn({ id: "t2", amount: 15000, date: "2026-08-12" })],
      salesOrders: [],
      purchaseOrders: [],
      remittances: [rem],
    });
    expect(r.status).toBe("matched");
    expect(r.reasons[0]).toMatch(/date window/);
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
});
