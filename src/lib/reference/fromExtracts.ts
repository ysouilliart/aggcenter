import type { PurchaseOrder, Remittance, SalesOrder } from "../domain/types";
import type { CsvRecord } from "../parse/csv";
import {
  compactId,
  firstField,
  isGbCountry,
  isUkOrgRow,
  parseExtractAmount,
  parseExtractDate,
  sourceFileName,
} from "./util";

export type ExtractInputRow = Record<string, string> | CsvRecord;

export function isCsvRecord(row: ExtractInputRow): row is CsvRecord {
  return (
    typeof row === "object" &&
    row != null &&
    "record" in row &&
    typeof (row as CsvRecord).rowNumber === "number" &&
    typeof (row as CsvRecord).record === "object" &&
    (row as CsvRecord).record != null
  );
}

export function extractRecord(row: ExtractInputRow): {
  record: Record<string, string>;
  rowNumber?: number;
} {
  if (isCsvRecord(row)) return { record: row.record, rowNumber: row.rowNumber };
  return { record: row };
}

/**
 * Fusion AP extracts often store `invoice_amount` as 0 while the payable
 * total is `discountable_amount` + `tax_control_amount` (net + VAT).
 */
export function apInvoiceAmount(row: Record<string, string>): number {
  const header = parseExtractAmount(row.invoice_amount);
  if (header) return header;
  return (
    parseExtractAmount(row.discountable_amount) +
    parseExtractAmount(row.tax_control_amount)
  );
}

export const REFERENCE_SOURCE = "oci-uk";

export function mapSalesOrders(input: {
  headers: ExtractInputRow[];
  chargeComponents: ExtractInputRow[];
  headerFile?: string;
}): SalesOrder[] {
  const netBySource = new Map<string, number>();
  for (const raw of input.chargeComponents) {
    const { record: row } = extractRecord(raw);
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
  const headerFile = sourceFileName(input.headerFile);
  for (const raw of input.headers) {
    const { record: row, rowNumber } = extractRecord(raw);
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
      sourceFile: headerFile,
      sourceRow: rowNumber,
    });
  }
  return orders;
}

export function mapUkApInvoices(input: {
  headers: ExtractInputRow[];
  lines: ExtractInputRow[];
  headerFile?: string;
}): PurchaseOrder[] {
  const poByInvoice = new Map<string, Set<string>>();
  for (const raw of input.lines) {
    const { record: row } = extractRecord(raw);
    const invoiceId = compactId(row.invoice_id ?? "");
    const po = (row.po_number ?? "").trim();
    if (!invoiceId || !po) continue;
    const set = poByInvoice.get(invoiceId) ?? new Set<string>();
    set.add(po);
    poByInvoice.set(invoiceId, set);
  }

  const invoices: PurchaseOrder[] = [];
  const headerFile = sourceFileName(input.headerFile);
  for (const raw of input.headers) {
    const { record: row, rowNumber } = extractRecord(raw);
    if (!isGbCountry(row.taxation_country)) continue;
    const invoiceId = compactId(row.invoice_id ?? "");
    const invoiceNumber = (row.invoice_number ?? "").trim() || invoiceId;
    if (!invoiceId) continue;
    const date = parseExtractDate(row.invoice_date) || "1970-01-01";
    const due = parseExtractDate(row.terms_date) || date;
    invoices.push({
      id: `AP-${invoiceId}`,
      vendor: row.supplier_name || "Unknown supplier",
      amount: apInvoiceAmount(row),
      currency: (row.invoice_currency || row.payment_currency || "EUR").toUpperCase(),
      orderDate: date,
      dueDate: due,
      status: (row.invoice_type ?? "").toUpperCase() === "CREDIT" ? "billed" : "billed",
      invoiceNumber,
      poNumbers: [...(poByInvoice.get(invoiceId) ?? [])],
      operatingUnit: row.business_unit || undefined,
      country: (row.taxation_country || "").toUpperCase(),
      sourceFile: headerFile,
      sourceRow: rowNumber,
    });
  }
  return invoices;
}

function poStatus(raw: string): PurchaseOrder["status"] {
  const v = raw.toUpperCase();
  if (/CANCEL/.test(v)) return "cancelled";
  if (/PAID|FINALLY CLOSED/.test(v)) return "paid";
  if (/BILL|CLOSED/.test(v)) return "billed";
  return "open";
}

function poDocumentId(raw: string): string {
  if (/^PO[-_]?/i.test(raw)) return raw;
  return `PO-${raw}`;
}

function lineAmount(row: Record<string, string>): number {
  const direct = parseExtractAmount(
    firstField(row, ["line_amount", "amount", "extended_amount", "ordered_amount"]),
  );
  if (direct) return direct;
  const qty = Number(String(row.quantity ?? "").replace(/,/g, "").trim());
  const price = Number(
    String(row.unit_price ?? row.price ?? "").replace(/,/g, "").trim(),
  );
  if (Number.isFinite(qty) && Number.isFinite(price) && qty && price) {
    return Math.round(qty * price * 100);
  }
  return 0;
}

/**
 * Map Fusion/EBS purchase-order extracts into the P2P expected-side records.
 * Header amount is used when present; otherwise line amounts are summed.
 */
export function mapUkPurchaseOrders(input: {
  headers: ExtractInputRow[];
  lines?: ExtractInputRow[];
  headerFile?: string;
}): PurchaseOrder[] {
  const amountByKey = new Map<string, number>();
  for (const raw of input.lines ?? []) {
    const { record: row } = extractRecord(raw);
    const keys = [
      compactId(
        firstField(row, ["po_number", "document_number", "order_number", "po_order"]),
      ),
      compactId(firstField(row, ["interface_header_key", "po_header_id"])),
    ].filter(Boolean);
    const amt = lineAmount(row);
    for (const key of keys) {
      amountByKey.set(key, (amountByKey.get(key) ?? 0) + amt);
    }
  }

  const orders: PurchaseOrder[] = [];
  const seen = new Set<string>();
  const headerFile = sourceFileName(input.headerFile);
  for (const raw of input.headers) {
    const { record: row, rowNumber } = extractRecord(raw);
    if (!isUkOrgRow(row)) continue;
    const rawNumber = compactId(
      firstField(row, [
        "po_number",
        "po_order",
        "document_number",
        "order_number",
      ]),
    );
    const headerKey = compactId(
      firstField(row, ["interface_header_key", "po_header_id"]),
    );
    if (!rawNumber || seen.has(rawNumber)) continue;
    seen.add(rawNumber);
    const date =
      parseExtractDate(
        firstField(row, ["ordered_date", "po_date", "creation_date", "order_date", "rate_date"]),
      ) || "1970-01-01";
    const due =
      parseExtractDate(
        firstField(row, ["need_by_date", "promised_date", "due_date"]),
      ) || date;
    const headerAmount = parseExtractAmount(
      firstField(row, ["amount", "order_amount", "total_amount", "po_amount"]),
    );
    const id = poDocumentId(rawNumber);
    orders.push({
      id,
      vendor:
        firstField(row, ["vendor_name", "supplier_name", "vendor"]) ||
        "Unknown supplier",
      amount: headerAmount || amountByKey.get(rawNumber) || amountByKey.get(headerKey) || 0,
      currency: (
        firstField(row, ["currency_code", "currency", "order_currency"]) || "GBP"
      ).toUpperCase(),
      orderDate: date,
      dueDate: due,
      status: poStatus(firstField(row, ["status", "authorization_status", "document_status"])),
      poNumbers: [rawNumber, id].filter((v, i, arr) => arr.indexOf(v) === i),
      operatingUnit:
        firstField(row, [
          "operating_unit",
          "operating_unit_name",
          "business_unit",
          "bill_to_location",
          "ship_to_location",
        ]) || undefined,
      country:
        firstField(row, ["country", "bill_to_country", "taxation_country"]).toUpperCase() ||
        undefined,
      sourceFile: headerFile,
      sourceRow: rowNumber,
    });
  }
  return orders;
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
  sourceRow?: number;
}

export function mapUkRemittances(
  rows: ExtractInputRow[],
  sourceFile?: string,
): Remittance[] {
  const grouped = new Map<string, RemittanceAcc>();
  const file = sourceFileName(sourceFile);
  for (const raw of rows) {
    const { record: row, rowNumber } = extractRecord(raw);
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
        sourceRow: rowNumber,
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
      sourceFile: file,
      sourceRow: acc.sourceRow,
    };
  });
}
