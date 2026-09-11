import type { PurchaseOrder, Remittance, SalesOrder } from "../domain/types";
import {
  compactId,
  isGbCountry,
  parseExtractAmount,
  parseExtractDate,
} from "./util";

export const REFERENCE_SOURCE = "oci-uk";

export function mapSalesOrders(input: {
  headers: Record<string, string>[];
  chargeComponents: Record<string, string>[];
}): SalesOrder[] {
  const netBySource = new Map<string, number>();
  for (const row of input.chargeComponents) {
    if ((row.price_element_code ?? "").toUpperCase() !== "QP_NET_PRICE") continue;
    const sourceId = compactId(row.source_trans_id ?? "");
    if (!sourceId) continue;
    netBySource.set(
      sourceId,
      (netBySource.get(sourceId) ?? 0) + parseExtractAmount(row.charge_crncy_extended_amount),
    );
  }

  const orders: SalesOrder[] = [];
  const seen = new Set<string>();
  for (const row of input.headers) {
    const sourceId = compactId(row.sourcetransid ?? row.source_trans_id ?? "");
    const orderNum = compactId(row.source_trans_num ?? sourceId);
    if (!orderNum || seen.has(orderNum)) continue;
    seen.add(orderNum);
    const date = parseExtractDate(row.trans_on) || "1970-01-01";
    orders.push({
      id: orderNum,
      customer: row.byng_pty_nme || "Unknown customer",
      amount: netBySource.get(sourceId) ?? 0,
      currency: (row.transal_crncy_code || "EUR").toUpperCase(),
      orderDate: date,
      dueDate: date,
      status: "invoiced",
      customerPo: row.cust_ponum || undefined,
      operatingUnit: row.rqstng_bu_unit || undefined,
    });
  }
  return orders;
}

export function mapUkApInvoices(input: {
  headers: Record<string, string>[];
  lines: Record<string, string>[];
}): PurchaseOrder[] {
  const poByInvoice = new Map<string, Set<string>>();
  for (const row of input.lines) {
    const invoiceId = compactId(row.invoice_id ?? "");
    const po = (row.po_number ?? "").trim();
    if (!invoiceId || !po) continue;
    const set = poByInvoice.get(invoiceId) ?? new Set<string>();
    set.add(po);
    poByInvoice.set(invoiceId, set);
  }

  const invoices: PurchaseOrder[] = [];
  for (const row of input.headers) {
    if (!isGbCountry(row.taxation_country)) continue;
    const invoiceId = compactId(row.invoice_id ?? "");
    const invoiceNumber = (row.invoice_number ?? "").trim() || invoiceId;
    if (!invoiceId) continue;
    const date = parseExtractDate(row.invoice_date) || "1970-01-01";
    const due = parseExtractDate(row.terms_date) || date;
    invoices.push({
      id: `AP-${invoiceId}`,
      vendor: row.supplier_name || "Unknown supplier",
      amount: parseExtractAmount(row.invoice_amount),
      currency: (row.invoice_currency || row.payment_currency || "EUR").toUpperCase(),
      orderDate: date,
      dueDate: due,
      status: (row.invoice_type ?? "").toUpperCase() === "CREDIT" ? "billed" : "billed",
      invoiceNumber,
      poNumbers: [...(poByInvoice.get(invoiceId) ?? [])],
      operatingUnit: row.business_unit || undefined,
      country: (row.taxation_country || "").toUpperCase(),
    });
  }
  return invoices;
}

interface RemittanceAcc {
  id: string;
  party: Remittance["party"];
  name: string;
  remittanceNumber: string;
  date: string;
  amount: number;
  currency: string;
  status: string;
  operatingUnit: string;
  invoices: Set<string>;
}

export function mapUkRemittances(rows: Record<string, string>[]): Remittance[] {
  const grouped = new Map<string, RemittanceAcc>();
  for (const row of rows) {
    const ou = row.operating_unit_name ?? "";
    if (!/uk/i.test(ou) && row.org_id !== "112") continue;
    const flow = (row.flow_direction ?? "").toUpperCase();
    const party: Remittance["party"] =
      flow === "OU_TO_SUPPLIER" || (row.source_module ?? "").toUpperCase() === "AP"
        ? "vendor"
        : "customer";
    const remittanceId = compactId(row.remittance_id ?? row.oracle_payment_id ?? "");
    const currency = (row.payment_currency_code || "GBP").toUpperCase();
    const amount = parseExtractAmount(row.payment_total_amount);
    if (!remittanceId) continue;
    const id = `${party === "vendor" ? "AP" : "AR"}-${remittanceId}`;
    let acc = grouped.get(id);
    if (!acc) {
      acc = {
        id,
        party,
        name: row.counterparty_name || "Unknown",
        remittanceNumber: (row.remittance_number ?? "").trim(),
        date: parseExtractDate(row.remittance_date) || "1970-01-01",
        amount,
        currency,
        status: (row.remittance_status ?? "").trim(),
        operatingUnit: ou,
        invoices: new Set(),
      };
      grouped.set(id, acc);
    }
    if (row.invoice_number) acc.invoices.add(row.invoice_number.trim());
    if (!acc.name && row.counterparty_name) acc.name = row.counterparty_name;
  }

  return [...grouped.values()].map((acc) => {
    const invoices = [...acc.invoices];
    return {
      id: acc.id,
      party: acc.party,
      name: acc.name,
      reference: invoices[0] ?? acc.remittanceNumber,
      amount: acc.amount,
      currency: acc.currency,
      date: acc.date,
      remittanceNumber: acc.remittanceNumber || undefined,
      invoiceNumbers: invoices,
      operatingUnit: acc.operatingUnit || undefined,
      status: acc.status || undefined,
    };
  });
}
