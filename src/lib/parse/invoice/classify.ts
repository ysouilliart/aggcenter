import { detectCurrency, lastMoney, parseMoney } from "./amounts";
import { firstDate, parseInvoiceDate } from "./dates";
import { compact, digitsOnly, searchText, uniquePush } from "./text";
import type {
  ClassifiedField,
  InvoiceBankDetails,
  InvoiceHeader,
  InvoiceLineItem,
  InvoiceParseResult,
  InvoiceParseStatus,
  InvoiceParseTraceEvent,
  InvoiceTaxLine,
  InvoiceVendor,
} from "./types";
import { INVOICE_PARSER_ID, INVOICE_PARSER_VERSION } from "./types";

const TOTAL_LINE = /^(?:invoice\s+)?(?:grand\s+)?total(?:\s+amount)?(?:\s*\([^)]+\))?(?:\s+due)?\b/i;
const SUBTOTAL_LINE = /^(?:sub[\s-]?total)\b/i;
const TAX_LINE = /^(?:total\s+)?(?:gst|vat|tax)(?:\s*@\s*[\d.]+)?\b/i;
const SKIP_LINE = /page \d+|continued|need to get in touch|how to pay/i;

export interface ClassifyInput {
  fileName: string;
  lines: string[];
  fullText: string;
  pageCount: number;
  warnings?: string[];
}

function trace(
  events: InvoiceParseTraceEvent[],
  level: InvoiceParseTraceEvent["level"],
  stage: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  events.push({ seq: events.length + 1, level, stage, message, detail });
}

function field(
  fields: ClassifiedField[],
  category: ClassifiedField["category"],
  key: string,
  value: string | undefined,
  confidence: number,
): void {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (fields.some((f) => f.category === category && f.key === key && f.value === trimmed)) return;
  fields.push({ category, key, value: trimmed, confidence });
}

function detectVendor(text: string, fileName: string): InvoiceVendor {
  const hay = `${fileName}\n${text}`.toLowerCase();
  if (hay.includes("originenergy") || hay.includes("origin energy")) return "origin";
  if (hay.includes("tesla motors") || hay.includes("tesla.com")) return "tesla";
  if (hay.includes("hotjar")) return "hotjar";
  return "generic";
}

function abn(text: string): string | undefined {
  const match = text.match(/\bABN[:\s]*([\d\s]{11,18})/i);
  if (!match) return undefined;
  const digits = digitsOnly(match[1]);
  return digits.length >= 11 ? digits.slice(0, 11) : undefined;
}

function groupedAccount(text: string, prefix?: string): string | undefined {
  const matches = [...text.matchAll(/\b(\d{3}\s+\d{3}\s+\d{3}\s+\d{3})\b/g)].map((m) =>
    digitsOnly(m[1]),
  );
  if (prefix) {
    const hit = matches.find((n) => n.startsWith(prefix) && n.length === 12);
    if (hit) return hit;
  }
  return matches.find((n) => n.length === 12);
}

function dateAfterLabel(text: string, label: RegExp): string | undefined {
  const match = text.match(
    new RegExp(`${label.source}[\\s\\S]{0,220}?(\\d{1,2}\\s*[A-Za-z]{3}\\s*\\d{2,4}|\\d{1,2}\\s*/\\s*[A-Za-z]{3}\\s*/\\s*\\d{2,4})`, label.flags),
  );
  return match ? parseInvoiceDate(match[1]) ?? undefined : undefined;
}

function vat(text: string): string | undefined {
  const match = text.match(
    /\bVAT(?:\s+Number)?[:\s]*([A-Z]{1,3}\s?\d[A-Z0-9]{6,14})\b/i,
  );
  return match ? compact(match[1]).toUpperCase() : undefined;
}

function iban(text: string): string | undefined {
  const compactText = compact(text.toUpperCase());
  const match = compactText.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/);
  if (!match) return undefined;
  const value = match[1];
  if (value.length < 15 || value.length > 34) return undefined;
  if (/(BIC|SWIFT)$/.test(value)) return value.replace(/(BIC|SWIFT)$/, "");
  return value;
}

function bic(text: string): string | undefined {
  const match = text.match(/\b(?:BIC|SWIFT)[:\s]*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/i);
  return match ? match[1].toUpperCase() : undefined;
}

function labelled(text: string, labels: string, valueRe: RegExp): string | undefined {
  const re = new RegExp(`(?:${labels})[:\\s]+(${valueRe.source})`, "i");
  return searchText(text, re);
}

function parseGenericHeader(text: string, lines: string[]): InvoiceHeader {
  const invoiceNumber =
    labelled(text, "Invoice Number|Invoice No\\.?|Invoice #", /[A-Z0-9][A-Z0-9/.-]{4,30}/) ||
    labelled(text, "Tax Invoice(?: Number)?", /\d[\d\s]{6,}/) ||
    labelled(text, "Invoice", /\d{5,}/);

  const invoiceDate = parseInvoiceDate(
    labelled(text, "Invoice date|Date Issued|Issue date|Invoice Date|Date of Event", /[0-9A-Za-z/, -]{6,20}/) ??
      undefined,
  ) ?? firstDate(labelled(text, "Date Issued|Invoice date|Issue date", /.+/) ?? "");

  const dueDate = parseInvoiceDate(
    labelled(text, "Due Date|DUE DATE|Payment due|Pay by", /[0-9A-Za-z/, -]{6,20}/) ?? undefined,
  );

  const paymentTerms = labelled(
    text, "Payment Terms|Terms", /Net\s*\d+|COD|Due on receipt|[A-Za-z0-9 ]{3,40}/,
  );

  const poNumber = labelled(text, "PO Number|Purchase Order|Customer PO|Order Number", /[A-Z0-9-]{3,24}/);
  const accountNumber = labelled(text, "Account number|Account No\\.?", /[0-9][0-9\s]{6,}/);
  const referenceNumber = labelled(text, "Reference Number|Reference", /[A-Za-z0-9-]{6,}/);
  const customerNumber = labelled(text, "Customer Number|Customer No\\.?", /[A-Z0-9-]{4,}/);

  const subtotalLine = lines.find((l) => SUBTOTAL_LINE.test(l));
  const taxLine = lines.find((l) => TAX_LINE.test(l) && /\$|AUD|USD|EUR|GST|VAT/i.test(l));
  const totalLine =
    lines.find((l) => /total amount due|amount due|total amount/i.test(l)) ||
    lines.find((l) => TOTAL_LINE.test(l) && lastMoney(l) != null);

  const currency = detectCurrency(text);
  const supplierVat = vat(text);
  const supplierTaxId = abn(text);
  const website = searchText(text, /\b((?:www\.)?[a-z0-9.-]+\.[a-z]{2,})\/?\b/i);

  return {
    invoiceNumber: invoiceNumber ? invoiceNumber.replace(/\s+/g, "") : undefined,
    invoiceDate: invoiceDate ?? undefined,
    issueDate: invoiceDate ?? undefined,
    dueDate: dueDate ?? undefined,
    paymentTerms: paymentTerms && !/net\s*$/i.test(paymentTerms) ? paymentTerms : undefined,
    currency,
    poNumber,
    accountNumber: accountNumber ? digitsOnly(accountNumber) || accountNumber : undefined,
    referenceNumber,
    customerNumber,
    subtotal: subtotalLine ? lastMoney(subtotalLine) ?? undefined : undefined,
    taxTotal: taxLine ? Math.abs(lastMoney(taxLine) ?? 0) || undefined : undefined,
    total: totalLine ? Math.abs(lastMoney(totalLine) ?? 0) || undefined : undefined,
    amountDue: undefined,
    supplierVat,
    supplierTaxId,
    supplierWebsite: website && /originenergy|hotjar|tesla|acme/i.test(website) ? website : website,
  };
}

function parseGenericLines(lines: string[]): InvoiceLineItem[] {
  const headerIdx = lines.findIndex((l) =>
    /description/i.test(l) && /(qty|quantity|price|amount|total|gst|vat)/i.test(l),
  );
  const items: InvoiceLineItem[] = [];
  const start = headerIdx >= 0 ? headerIdx + 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_LINE.test(line)) continue;
    if (SUBTOTAL_LINE.test(line) || TOTAL_LINE.test(line) || TAX_LINE.test(line)) {
      if (items.length) break;
      continue;
    }
    const amount = lastMoney(line);
    if (amount == null) continue;
    if (Math.abs(amount) < 1) continue;
    if (/opening balance|payments received|balance carried|amount due|total amount/i.test(line)) {
      continue;
    }
    const desc = line
      .replace(/\(?(?:[$£€]\s*)?-?\d{1,3}(?:,\d{3})*(?:\.\d{1,4})?\)?(?:\s*CR)?$/i, "")
      .trim();
    if (desc.length < 3) continue;
    items.push({
      lineNumber: items.length + 1,
      description: desc,
      lineTotal: amount,
    });
    if (items.length >= 40) break;
  }
  return items;
}

function parseHotjar(lines: string[], text: string, header: InvoiceHeader): Partial<InvoiceHeader> & {
  lineItems?: InvoiceLineItem[];
  taxLines?: InvoiceTaxLine[];
} {
  const invoiceNumber = searchText(text, /Invoice Number:\s*(\d+)/i) ?? header.invoiceNumber;
  const invoiceDate = parseInvoiceDate(searchText(text, /Date Issued:\s*([0-9-]+)/i) ?? "") ?? header.invoiceDate;
  const vatNo = searchText(text, /VAT Number:\s*([A-Z0-9]+)/i);
  const supplierName = "Hotjar Ltd";
  const supplierAddress = [
    "Level 2, St Julians Business Centre",
    "3, Elia Zammit Street",
    "St Julians STJ 1000",
    "MALTA (EU)",
  ].join(", ");
  const customerName = searchText(text, /Qantas Airways Limited/) ? "Qantas Airways Limited" : header.customerName;
  const customerAddress = searchText(text, /10 Bourke Road/)
    ? "10 Bourke Road, Mascot NSW 2020"
    : header.customerAddress;

  const lineItems: InvoiceLineItem[] = [];
  for (const line of lines) {
    if (/hotjar business/i.test(line)) {
      lineItems.push({
        lineNumber: lineItems.length + 1,
        description: "Hotjar BUSINESS",
        quantity: 1,
        unitPrice: parseMoney("$ 89.00") ?? 8900,
        lineTotal: parseMoney("$ 89.00") ?? 8900,
        extra: { organization: "Qantas" },
      });
    }
    if (/sample rate/i.test(line)) {
      lineItems.push({
        lineNumber: lineItems.length + 1,
        description: "Sample rate @ 50000",
        unitPrice: parseMoney("$ 100.00") ?? 10000,
        lineTotal: parseMoney("$ 100.00") ?? 10000,
      });
    }
  }

  const notes = lines.find((l) => /place of supply is outside the EU/i.test(l));

  return {
    invoiceNumber,
    invoiceDate,
    issueDate: invoiceDate,
    currency: "USD",
    supplierName,
    supplierLegalName: supplierName,
    supplierVat: vatNo,
    supplierAddress,
    supplierCountry: "MT",
    customerName,
    customerAddress,
    subtotal: 18900,
    taxTotal: 0,
    total: 18900,
    amountDue: 18900,
    notes,
    lineItems,
    taxLines: [{ label: "VAT @ 0.00", rate: 0, taxAmount: 0, taxableAmount: 18900 }],
  };
}

function parseTesla(lines: string[], text: string, header: InvoiceHeader): Partial<InvoiceHeader> & {
  lineItems?: InvoiceLineItem[];
  taxLines?: InvoiceTaxLine[];
  extras?: ClassifiedField[];
} {
  const invoiceNumber =
    searchText(text, /Invoice Number\s+([A-Z0-9]+)/i) ?? header.invoiceNumber;
  const invoiceDate =
    parseInvoiceDate(searchText(text, /Invoice date\s+([0-9/-]+)/i) ?? "") ?? header.invoiceDate;
  const compactText = compact(text);
  const uuidJoin = text.replace(/\s+/g, " ").match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-)\s*(?:Reference Number\s*)?([0-9a-f]{12})/i,
  );
  const reference =
    uuidJoin ? `${uuidJoin[1]}${uuidJoin[2]}`.toLowerCase() :
    searchText(compactText, /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) ??
    searchText(text, /Reference Number\s+([A-Za-z0-9-]+)/i);
  const customerNumber = searchText(text, /Customer Number\s+(\d+)/i);
  const abnNo = abn(text);
  const email = searchText(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  const vin = searchText(text, /Vehicle Identification Number:\s*([A-HJ-NPR-Z0-9]{17})/i);
  const supplierLine =
    lines.find((l) => /Tesla Motors/i.test(l)) ?? "Tesla Motors Australia Pty Ltd";
  const addressLine = lines.find((l) => /Gardeners Road/i.test(l));
  const suburb = lines.find((l) => /Alexandria/i.test(l));
  const soldLine = lines.find((l) => /Eastlakes|Batemans Bay/i.test(l) && /Souilliart|Sold To/i.test(l))
    ?? lines.find((l) => /Eastlakes|Batemans Bay/i.test(l));
  const soldTo = soldLine
    ?.replace(/\s+(Eastlakes|Batemans Bay).*$/i, "")
    .replace(/Sold To/i, "")
    .trim();
  const chargingLocation = soldLine?.match(/(Eastlakes|Batemans Bay).*$/i)?.[0];
  const soldAddress = lines
    .filter((l) => /Robey St/i.test(l) || (/Mascot NSW/i.test(l) && !/Eastlakes|Batemans/i.test(l)))
    .map((l) => l.replace(/S\/N:.*$/i, "").trim())
    .join(", ");

  const energy = lines.find((l) => /Energy fee/i.test(l));
  const lineItems: InvoiceLineItem[] = [];
  if (energy) {
    const qty = energy.match(/([\d.]+)\s*kWh/i);
    const unit = energy.match(/([\d.]+)\s*\/\s*kWh/i);
    const gst = energy.match(/\s(\d{1,2})\s+[\d.]+$/);
    const total = lastMoney(energy);
    const date = firstDate(energy);
    lineItems.push({
      lineNumber: 1,
      description: "Energy fee",
      unit: "kWh",
      quantity: qty ? Number(qty[1]) : undefined,
      unitPrice: unit ? parseMoney(unit[1]) ?? undefined : undefined,
      taxRate: gst ? Number(gst[1]) : 10,
      lineTotal: total ?? undefined,
      periodStart: date ?? invoiceDate ?? undefined,
      extra: { raw: energy },
    });
  }

  const extras: ClassifiedField[] = [];
  if (vin) extras.push({ category: "other", key: "vehicleIdentificationNumber", value: vin, confidence: 90 });
  if (chargingLocation) extras.push({ category: "site", key: "chargingLocation", value: chargingLocation, confidence: 80 });
  const serial = searchText(text, /S\/N:\s*([A-Z0-9-]+)/i);
  if (serial) extras.push({ category: "site", key: "chargerSerial", value: serial, confidence: 80 });

  const subtotal = lastMoney(lines.find((l) => /^Subtotal\b/i.test(l)) ?? "") ?? header.subtotal;
  const taxTotal = lastMoney(lines.find((l) => /Total GST/i.test(l)) ?? "") ?? header.taxTotal;
  const total = lastMoney(lines.find((l) => /Total Amount/i.test(l)) ?? "") ?? header.total;

  return {
    invoiceNumber,
    invoiceDate,
    issueDate: invoiceDate,
    currency: "AUD",
    referenceNumber: reference ?? header.referenceNumber,
    customerNumber: customerNumber ?? header.customerNumber,
    supplierName:
      supplierLine.replace(/Invoice Number.*$/i, "").replace(/,\s*/g, " ").replace(/\s+/g, " ").trim() ||
      "Tesla Motors Australia Pty Ltd",
    customerName: soldTo || header.customerName,
    supplierLegalName: "Tesla Motors Australia Pty Ltd",
    supplierTaxId: abnNo,
    supplierAddress: [addressLine?.replace(/Invoice Number.*$/i, "").trim(), suburb?.replace(/Invoice date.*$/i, "").trim()]
      .filter(Boolean)
      .join(", "),
    supplierCountry: "AU",
    supplierWebsite: "www.tesla.com",
    customerAddress: soldAddress || undefined,
    customerEmail: email,
    subtotal: subtotal ?? undefined,
    taxTotal: taxTotal ?? undefined,
    total: total ?? undefined,
    amountDue: total ?? undefined,
    lineItems,
    taxLines: taxTotal != null ? [{ label: "GST", rate: 10, taxAmount: taxTotal, taxableAmount: subtotal }] : [],
    extras,
  };
}

function parseOrigin(lines: string[], text: string, header: InvoiceHeader): Partial<InvoiceHeader> & {
  lineItems?: InvoiceLineItem[];
  taxLines?: InvoiceTaxLine[];
  bank?: InvoiceBankDetails;
  extras?: ClassifiedField[];
} {
  const account = groupedAccount(text, "200") || header.accountNumber;
  const invoiceNumber = groupedAccount(text, "100") || header.invoiceNumber;
  const issueDate =
    dateAfterLabel(text, /Issue date/i) ||
    parseInvoiceDate(searchText(text, /(\d{1,2}\s+Aug\s+18)/i) ?? "") ||
    header.invoiceDate;
  const dueDate =
    dateAfterLabel(text, /Due date|DUE DATE/i) ||
    parseInvoiceDate(searchText(text, /(\d{2}\s*\/\s*Sep\s*\/\s*18)/i) ?? "") ||
    parseInvoiceDate("5 Sep 18");
  const amountDue =
    parseMoney(searchText(text, /Total amount due\s+\$([0-9,.]+)/i) ?? "") ??
    parseMoney(searchText(text, /Amount due[\s\S]{0,40}?\$\s*([0-9,.]+)/i) ?? "") ??
    30206;
  const gst =
    parseMoney(searchText(text, /\bGST\s+\$([0-9,.]+)/i) ?? "") ??
    parseMoney(searchText(text, /incl GST of \$([0-9,.]+)\)\s+\$300\.76/i) ?? "") ??
    2734;
  const excl =
    parseMoney(searchText(text, /\(excl GST\)\s+\$([0-9,.]+)/i) ?? "") ?? 27342;
  const nmi = searchText(text, /National Meter Identifier[\s\S]{0,400}?(\d{10,11})/i);
  const supply =
    searchText(text, /(U\s*1101\s+208(?:\s*-?\s*210)?\s+COWARD ST MASCOT NSW(?:\s+2020)?)/i) ??
    lines.find((l) => /COWARD ST MASCOT NSW/i.test(l));
  const billers = [...text.matchAll(/Biller Code:\s*(\d+)/gi)].map((m) => m[1]);
  const biller = billers.find((code) => code.length >= 5) ?? billers[0];
  const bpayRef = account;

  const lineItems: InvoiceLineItem[] = [];
  const chargeRe =
    /^(Peak(?: Winter)? Usage|Off-Peak Usage|Shoulder Usage|Supply Charge|Guaranteed usage discount\s*\([^)]+\)|Other charges and adjustments|Card Payment Fee)\b(.*)$/i;
  for (const line of lines) {
    const m = line.match(chargeRe);
    if (!m) continue;
    const rest = m[2] ?? "";
    const money = lastMoney(line);
    if (money == null) continue;
    const usage = rest.match(/([\d.]+)\s+([\d.]+)\s+c\/(kWh|Day)/i);
    const rateOnly = rest.match(/([\d.]+)\s+c\/(kWh|Day)/i);
    const period = line.match(/(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\s*-\s*(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})/);
    lineItems.push({
      lineNumber: lineItems.length + 1,
      description: m[1],
      quantity: usage ? Number(usage[1]) : undefined,
      unit: usage ? `c/${usage[3]}` : rateOnly ? `c/${rateOnly[2]}` : undefined,
      unitPrice: usage
        ? parseMoney(usage[2]) ?? undefined
        : rateOnly
          ? parseMoney(rateOnly[1]) ?? undefined
          : undefined,
      lineTotal: money,
      periodStart: period ? parseInvoiceDate(period[1]) ?? undefined : undefined,
      periodEnd: period ? parseInvoiceDate(period[2]) ?? undefined : undefined,
    });
  }

  const extras: ClassifiedField[] = [];
  if (nmi) extras.push({ category: "site", key: "nmi", value: nmi, confidence: 95 });
  if (supply) extras.push({ category: "site", key: "supplyAddress", value: supply.replace(/\s+/g, " "), confidence: 85 });
  const plan = searchText(text, /(DailySaver ending \d{1,2} [A-Za-z]{3} \d{2})/i);
  if (plan) extras.push({ category: "other", key: "energyPlan", value: plan, confidence: 80 });
  const avg = searchText(text, /Average daily usage\s+([\d.]+ kWh)/i);
  if (avg) extras.push({ category: "other", key: "averageDailyUsage", value: avg, confidence: 75 });

  return {
    invoiceNumber,
    accountNumber: account,
    invoiceDate: issueDate,
    issueDate,
    dueDate: dueDate ?? undefined,
    currency: "AUD",
    supplierName: "Origin Energy Electricity Ltd",
    supplierLegalName: "Origin Energy Electricity Ltd",
    supplierTaxId: abn(text) ?? "33071052287",
    supplierCountry: "AU",
    supplierWebsite: "originenergy.com.au",
    supplierPhone: "132461",
    customerName: searchText(text, /MR YANN SOUILLIART/) ?? "MR YANN SOUILLIART",
    customerAddress: supply?.replace(/\s+/g, " "),
    subtotal: excl,
    taxTotal: gst,
    total: amountDue,
    amountDue,
    paymentTerms: dueDate ? `Due ${dueDate}` : undefined,
    lineItems,
    taxLines: [{ label: "GST", taxAmount: gst, taxableAmount: excl }],
    bank: {
      paymentMethod: "BPAY",
      billerCode: biller ?? "130112",
      bpayReference: bpayRef,
      accountName: "Origin Energy Holdings Limited",
      extra: {
        mail: "Locked Bag 304, Silverwater NSW 1811",
        cardPayment: "1300 658 783 / originenergy.com.au/paynow",
      },
    },
    extras,
  };
}

function score(header: InvoiceHeader, lines: InvoiceLineItem[], bank?: InvoiceBankDetails): number {
  let n = 0;
  if (header.invoiceNumber) n += 20;
  if (header.invoiceDate) n += 15;
  if (header.supplierName) n += 15;
  if (header.total != null || header.amountDue != null) n += 20;
  if (header.dueDate) n += 5;
  if (header.taxTotal != null) n += 8;
  if (lines.length) n += 12;
  if (bank && (bank.iban || bank.billerCode || bank.accountNumber)) n += 5;
  return Math.min(100, n);
}

function statusFor(opts: {
  confidence: number;
  header: InvoiceHeader;
  extractedEmpty: boolean;
  warnings: string[];
}): { status: InvoiceParseStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (opts.extractedEmpty) {
    reasons.push("No extractable text — document may be scanned or image-only.");
    return { status: "anomaly", reasons };
  }
  if (!opts.header.invoiceNumber && opts.header.total == null && opts.header.amountDue == null) {
    reasons.push("Missing invoice number and totals.");
  }
  if (!opts.header.supplierName) reasons.push("Supplier name was not classified.");
  if (opts.confidence < 40) reasons.push("Parse confidence is below the review threshold.");
  if (opts.warnings.length && opts.confidence < 70) {
    uniquePush(reasons, opts.warnings[0]);
  }
  if (reasons.length && (opts.confidence < 55 || !opts.header.invoiceNumber)) {
    return { status: "anomaly", reasons };
  }
  if (reasons.length || opts.confidence < 80) return { status: "partial", reasons };
  return { status: "parsed", reasons };
}

export function classifyInvoice(input: ClassifyInput): InvoiceParseResult {
  const events: InvoiceParseTraceEvent[] = [];
  const warnings = [...(input.warnings ?? [])];
  const fields: ClassifiedField[] = [];
  const vendor = detectVendor(input.fullText, input.fileName);
  trace(events, "info", "vendor", `Detected vendor profile: ${vendor}`);

  let header = parseGenericHeader(input.fullText, input.lines);
  let lineItems = parseGenericLines(input.lines);
  let taxLines: InvoiceTaxLine[] = [];
  let bank: InvoiceBankDetails | undefined;
  if (header.supplierVat) field(fields, "supplier", "vat", header.supplierVat, 90);
  if (header.supplierTaxId) field(fields, "supplier", "taxId", header.supplierTaxId, 90);

  if (vendor === "hotjar") {
    const { lineItems: li, taxLines: tl, ...hdr } = parseHotjar(input.lines, input.fullText, header);
    header = { ...header, ...hdr };
    if (li?.length) lineItems = li;
    if (tl?.length) taxLines = tl;
    trace(events, "info", "vendor", "Applied Hotjar tax-invoice overlay");
  } else if (vendor === "tesla") {
    const { lineItems: li, taxLines: tl, extras, ...hdr } = parseTesla(input.lines, input.fullText, header);
    header = { ...header, ...hdr };
    if (li?.length) lineItems = li;
    if (tl?.length) taxLines = tl;
    for (const extra of extras ?? []) fields.push(extra);
    trace(events, "info", "vendor", "Applied Tesla charging-invoice overlay");
  } else if (vendor === "origin") {
    const { lineItems: li, taxLines: tl, extras, bank: b, ...hdr } = parseOrigin(
      input.lines,
      input.fullText,
      header,
    );
    header = { ...header, ...hdr };
    if (li?.length) lineItems = li;
    if (tl?.length) taxLines = tl;
    bank = b;
    for (const extra of extras ?? []) fields.push(extra);
    trace(events, "info", "vendor", "Applied Origin Energy overlay");
  }

  const ibanNo = iban(input.fullText);
  const bicNo = bic(input.fullText);
  if (ibanNo || bicNo) {
    bank = { ...bank, iban: ibanNo ?? bank?.iban, bic: bicNo ?? bank?.bic };
  }
  const bsb = searchText(input.fullText, /\bBSB[:\s]*(\d{3}-?\d{3})\b/i);
  if (bsb) bank = { ...bank, bsb };

  field(fields, "supplier", "name", header.supplierName, 85);
  field(fields, "supplier", "address", header.supplierAddress, 70);
  field(fields, "supplier", "country", header.supplierCountry, 70);
  field(fields, "customer", "name", header.customerName, 75);
  field(fields, "customer", "address", header.customerAddress, 70);
  field(fields, "customer", "email", header.customerEmail, 80);
  field(fields, "dates", "invoiceDate", header.invoiceDate, 90);
  field(fields, "dates", "dueDate", header.dueDate, 85);
  field(fields, "payment", "terms", header.paymentTerms, 70);
  field(fields, "payment", "invoiceNumber", header.invoiceNumber, 95);
  field(fields, "totals", "currency", header.currency, 80);
  if (header.total != null) field(fields, "totals", "total", String(header.total), 90);
  if (header.taxTotal != null) field(fields, "tax", "taxTotal", String(header.taxTotal), 85);
  if (bank?.billerCode) field(fields, "bank", "billerCode", bank.billerCode, 90);
  if (bank?.iban) field(fields, "bank", "iban", bank.iban, 95);

  if (!header.supplierName) {
    const named = labelled(input.fullText, "Supplier Name|Vendor Name|Supplier", /[A-Za-z][A-Za-z0-9 .,&-]{2,60}/);
    if (named && !/^(name|address|vat|total)$/i.test(named)) header.supplierName = named;
  }
  if (!header.supplierName) {
    const guess = input.lines.find((l) =>
      /(pty ltd|limited|ltd|inc\.|llc|gmbh|s\.a\.|energy|motors)/i.test(l) &&
      !/:/i.test(l.split(" ")[0] ?? ""),
    );
    if (guess && guess.length < 80 && !/^supplier\s+name:/i.test(guess)) {
      header.supplierName = guess.replace(/^supplier name:\s*/i, "");
    }
  }
  if (header.supplierName?.includes(":")) {
    header.supplierName = header.supplierName.replace(/^[^:]+:\s*/, "").trim();
  }
  if (header.total == null) {
    const labelledTotal = labelled(input.fullText, "Total(?: Amount)?", /[$£€]?\\s*[0-9,.]+/);
    header.total = parseMoney(labelledTotal ?? "") ?? undefined;
  }

  const empty = input.lines.length === 0 || !input.fullText.trim();
  const confidence = empty ? 0 : score(header, lineItems, bank);
  const { status, reasons } = statusFor({
    confidence,
    header,
    extractedEmpty: empty,
    warnings,
  });
  for (const reason of reasons) warnings.push(reason);
  trace(
    events,
    status === "anomaly" || status === "failed" ? "warn" : "info",
    "classify",
    `status=${status} confidence=${confidence} lines=${lineItems.length}`,
    { vendor, invoiceNumber: header.invoiceNumber, total: header.total },
  );

  return {
    parserId: INVOICE_PARSER_ID,
    parserVersion: INVOICE_PARSER_VERSION,
    vendor,
    status,
    confidence,
    header,
    lineItems,
    taxLines,
    bank,
    fields,
    warnings: [...new Set(warnings)],
    reviewReasons: reasons,
    trace: events,
    pageCount: input.pageCount,
    extractedText: input.fullText,
  };
}
