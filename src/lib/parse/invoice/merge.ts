/**
 * Overlay LLM classify onto a static parse. Scripting is the floor:
 * the model may only fill empty fields, or correct a `$`→AUD currency default
 * when the extract labels a different ISO code.
 */

import { detectCurrency, parseMoney } from "./amounts";
import { needsHumanConfirm, score, statusFor } from "./classify";
import { KNOWN_CURRENCIES } from "./schema";
import type {
  ClassifiedField,
  InvoiceBankDetails,
  InvoiceHeader,
  InvoiceLineItem,
  InvoiceParseResult,
  InvoiceTaxLine,
  InvoiceVendor,
} from "./types";
import { INVOICE_LLM_PARSER_ID, INVOICE_LLM_PARSER_VERSION } from "./types";

const VENDOR_OVERLAYS = new Set<InvoiceVendor>(["origin", "tesla", "hotjar"]);
const KNOWN_CURRENCY = new Set<string>(KNOWN_CURRENCIES);

const HEADER_KEYS: (keyof InvoiceHeader)[] = [
  "invoiceNumber",
  "invoiceDate",
  "issueDate",
  "dueDate",
  "paymentTerms",
  "currency",
  "poNumber",
  "accountNumber",
  "referenceNumber",
  "customerNumber",
  "subtotal",
  "taxTotal",
  "total",
  "amountDue",
  "supplierName",
  "supplierLegalName",
  "supplierTaxId",
  "supplierVat",
  "supplierAddress",
  "supplierCountry",
  "supplierEmail",
  "supplierPhone",
  "supplierWebsite",
  "customerName",
  "customerAddress",
  "customerEmail",
  "notes",
];

const MONEY_KEYS = ["subtotal", "taxTotal", "total", "amountDue"] as const;

const STRING_MUST_APPEAR: ReadonlySet<keyof InvoiceHeader> = new Set([
  "invoiceNumber",
  "supplierName",
  "supplierLegalName",
  "customerName",
  "poNumber",
  "accountNumber",
  "referenceNumber",
  "customerNumber",
  "supplierVat",
  "supplierTaxId",
  "supplierEmail",
  "supplierWebsite",
]);

function isBlank(value: unknown): boolean {
  return value == null || value === "";
}

function stringAppearsInExtract(value: string, text: string): boolean {
  const needle = value.trim();
  if (needle.length < 2) return false;
  const hay = text.replace(/\s+/g, " ");
  if (hay.toLowerCase().includes(needle.toLowerCase())) return true;
  const compactHay = hay.replace(/[\s-]/g, "").toLowerCase();
  const compactNeedle = needle.replace(/[\s-]/g, "").toLowerCase();
  return compactNeedle.length >= 4 && compactHay.includes(compactNeedle);
}

/** Money tokens in the extract, as integer cents. */
export function collectExtractCents(text: string): Set<number> {
  const tokens = new Set<number>();
  const re = /\(?(?:[$£€]\s*)?-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,4})?\)?(?:\s*CR)?/gi;
  for (const match of text.matchAll(re)) {
    const parsed = parseMoney(match[0]);
    if (parsed != null) tokens.add(parsed);
  }
  return tokens;
}

/**
 * If the model returned major units as an integer (189 for $189.00) and the
 * extract contains that amount as cents, promote it. Otherwise keep cents.
 */
export function alignAmountToExtract(cents: number, text: string): number {
  const tokens = collectExtractCents(text);
  if (tokens.has(cents)) return cents;
  const asMajor = cents * 100;
  if (Number.isSafeInteger(asMajor) && tokens.has(asMajor)) return asMajor;
  return cents;
}

export function pickCurrency(
  staticCurrency: string | undefined,
  llmCurrency: string | undefined,
  text: string,
): string | undefined {
  const llm = llmCurrency?.toUpperCase();
  const stat = staticCurrency?.toUpperCase();
  const labelled = detectCurrency(text)?.toUpperCase();
  if (llm && KNOWN_CURRENCY.has(llm)) {
    if (!stat) return llm;
    if (labelled && llm === labelled && stat !== labelled) return llm;
    if (
      stat === "AUD" &&
      llm !== "AUD" &&
      new RegExp(`\\b${llm}\\b`, "i").test(text) &&
      !/\bAUD\b/i.test(text)
    ) {
      return llm;
    }
  }
  return stat ?? (llm && KNOWN_CURRENCY.has(llm) ? llm : undefined);
}

export function pickVendor(staticVendor: InvoiceVendor, llmVendor: InvoiceVendor): InvoiceVendor {
  if (VENDOR_OVERLAYS.has(staticVendor)) return staticVendor;
  if (llmVendor && llmVendor !== "generic") return llmVendor;
  return staticVendor;
}

function mergeBank(
  staticBank?: InvoiceBankDetails,
  llmBank?: InvoiceBankDetails,
): InvoiceBankDetails | undefined {
  if (!staticBank && !llmBank) return undefined;
  if (!staticBank) return llmBank;
  if (!llmBank) return staticBank;
  const extra = { ...llmBank.extra, ...staticBank.extra };
  const out: InvoiceBankDetails = {
    ...llmBank,
    ...staticBank,
    extra: Object.keys(extra).length ? extra : undefined,
  };
  return out;
}

function mergeHeader(staticH: InvoiceHeader, llmH: InvoiceHeader, text: string): InvoiceHeader {
  const out: InvoiceHeader = { ...staticH };
  for (const key of HEADER_KEYS) {
    if (key === "currency" || MONEY_KEYS.includes(key as (typeof MONEY_KEYS)[number])) continue;
    if (isBlank(out[key]) && !isBlank(llmH[key])) {
      if (
        typeof llmH[key] === "string" &&
        STRING_MUST_APPEAR.has(key) &&
        !stringAppearsInExtract(String(llmH[key]), text)
      ) {
        continue;
      }
      (out as Record<string, unknown>)[key] = llmH[key];
    }
  }
  for (const key of MONEY_KEYS) {
    if (staticH[key] != null) {
      out[key] = staticH[key];
    } else if (llmH[key] != null) {
      out[key] = alignAmountToExtract(llmH[key] as number, text);
    }
  }
  out.currency = pickCurrency(staticH.currency, llmH.currency, text);
  return out;
}

function mergeLineItems(
  staticItems: InvoiceLineItem[],
  llmItems: InvoiceLineItem[],
  text: string,
): InvoiceLineItem[] {
  if (staticItems.length) return staticItems;
  return llmItems.map((item) => ({
    ...item,
    unitPrice: item.unitPrice != null ? alignAmountToExtract(item.unitPrice, text) : undefined,
    taxAmount: item.taxAmount != null ? alignAmountToExtract(item.taxAmount, text) : undefined,
    lineTotal: item.lineTotal != null ? alignAmountToExtract(item.lineTotal, text) : undefined,
  }));
}

function mergeTaxLines(staticLines: InvoiceTaxLine[], llmLines: InvoiceTaxLine[]): InvoiceTaxLine[] {
  return staticLines.length ? staticLines : llmLines;
}

function mergeFields(staticFields: ClassifiedField[], llmFields: ClassifiedField[]): ClassifiedField[] {
  const out = [...staticFields];
  for (const field of llmFields) {
    if (!out.some((row) => row.category === field.category && row.key === field.key)) {
      out.push(field);
    }
  }
  return out;
}

function isResolvedWarning(warning: string, header: InvoiceHeader): boolean {
  if (/invoice number/i.test(warning) && header.invoiceNumber) return true;
  if (/totals? were not classified/i.test(warning) && (header.total != null || header.amountDue != null)) {
    return true;
  }
  if (
    /missing invoice number and totals/i.test(warning) &&
    header.invoiceNumber &&
    (header.total != null || header.amountDue != null)
  ) {
    return true;
  }
  if (/supplier name/i.test(warning) && header.supplierName) return true;
  if (/currency was not classified/i.test(warning) && header.currency) return true;
  return false;
}

/** Merge a validated LLM result onto the static parse without replacing good scripted fields. */
export function mergeStaticAndLlm(
  staticResult: InvoiceParseResult,
  llmResult: InvoiceParseResult,
  fullText: string,
): InvoiceParseResult {
  const header = mergeHeader(staticResult.header, llmResult.header, fullText);
  const lineItems = mergeLineItems(staticResult.lineItems, llmResult.lineItems, fullText);
  const taxLines = mergeTaxLines(staticResult.taxLines, llmResult.taxLines);
  const bank = mergeBank(staticResult.bank, llmResult.bank);
  const fields = mergeFields(staticResult.fields, llmResult.fields);
  const vendor = pickVendor(staticResult.vendor, llmResult.vendor);
  const confidence = Math.min(
    100,
    Math.max(staticResult.confidence, llmResult.confidence, score(header, lineItems, bank)),
  );
  const warnings = [
    ...staticResult.warnings.filter((w) => !isResolvedWarning(w, header)),
    ...llmResult.warnings.filter((w) => !isResolvedWarning(w, header)),
  ];
  const { status, reasons } = statusFor({
    confidence,
    header,
    extractedEmpty: false,
    warnings: [],
  });
  for (const extra of llmResult.reviewReasons) {
    if (!reasons.includes(extra) && !isResolvedWarning(extra, header)) reasons.push(extra);
  }
  for (const reason of reasons) {
    if (!warnings.includes(reason)) warnings.push(reason);
  }

  const classifyMode = "llm" as const;
  return {
    parserId: INVOICE_LLM_PARSER_ID,
    parserVersion: INVOICE_LLM_PARSER_VERSION,
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
    trace: [
      ...staticResult.trace,
      {
        seq: staticResult.trace.length + 1,
        level: "info",
        stage: "llm",
        message: `LLM overlay on static floor; status=${status} confidence=${confidence}`,
        detail: {
          vendor,
          invoiceNumber: header.invoiceNumber,
          total: header.total,
          currency: header.currency,
          staticVendor: staticResult.vendor,
          staticTotal: staticResult.header.total,
        },
      },
    ],
    pageCount: staticResult.pageCount,
    extractedText: staticResult.extractedText,
    classifyMode,
    needsConfirm: needsHumanConfirm({ status, confidence, classifyMode }),
  };
}
