/**
 * Schema-constrained LLM classify output.
 *
 * The model must return this JSON object (no free-form dump). Amounts are
 * integer minor units (cents), matching `InvoiceParseResult`.
 */

import type {
  ClassifiedField,
  InvoiceBankDetails,
  InvoiceFieldCategory,
  InvoiceHeader,
  InvoiceLineItem,
  InvoiceTaxLine,
  InvoiceVendor,
} from "./types";

export const INVOICE_FIELD_CATEGORIES: InvoiceFieldCategory[] = [
  "supplier",
  "customer",
  "dates",
  "totals",
  "tax",
  "bank",
  "payment",
  "site",
  "other",
];

export const INVOICE_VENDORS: InvoiceVendor[] = ["origin", "tesla", "hotjar", "generic"];

export const KNOWN_CURRENCIES = [
  "AUD",
  "USD",
  "EUR",
  "GBP",
  "NZD",
  "CAD",
  "SGD",
  "JPY",
  "CHF",
  "HKD",
] as const;

/** JSON Schema (draft-07-ish) sent to the model as the only allowed shape. */
export const INVOICE_LLM_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor", "confidence", "header", "lineItems", "taxLines", "fields", "warnings", "reviewReasons"],
  properties: {
    vendor: { type: "string", enum: INVOICE_VENDORS },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    header: {
      type: "object",
      additionalProperties: false,
      properties: {
        invoiceNumber: { type: "string" },
        invoiceDate: { type: "string", description: "ISO date YYYY-MM-DD" },
        issueDate: { type: "string" },
        dueDate: { type: "string" },
        paymentTerms: { type: "string" },
        currency: { type: "string", description: "ISO 4217 code, e.g. USD" },
        poNumber: { type: "string" },
        accountNumber: { type: "string" },
        referenceNumber: { type: "string" },
        customerNumber: { type: "string" },
        subtotal: { type: "integer", description: "Minor units (cents)" },
        taxTotal: { type: "integer" },
        total: { type: "integer" },
        amountDue: { type: "integer" },
        supplierName: { type: "string" },
        supplierLegalName: { type: "string" },
        supplierTaxId: { type: "string" },
        supplierVat: { type: "string" },
        supplierAddress: { type: "string" },
        supplierCountry: { type: "string" },
        supplierEmail: { type: "string" },
        supplierPhone: { type: "string" },
        supplierWebsite: { type: "string" },
        customerName: { type: "string" },
        customerAddress: { type: "string" },
        customerEmail: { type: "string" },
        notes: { type: "string" },
      },
    },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lineNumber", "description"],
        properties: {
          lineNumber: { type: "integer", minimum: 1 },
          description: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          unitPrice: { type: "integer" },
          taxRate: { type: "number" },
          taxAmount: { type: "integer" },
          lineTotal: { type: "integer" },
          periodStart: { type: "string" },
          periodEnd: { type: "string" },
          extra: { type: "object", additionalProperties: { type: "string" } },
        },
      },
    },
    taxLines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: {
          label: { type: "string" },
          rate: { type: "number" },
          taxableAmount: { type: "integer" },
          taxAmount: { type: "integer" },
        },
      },
    },
    bank: {
      type: "object",
      additionalProperties: false,
      properties: {
        bankName: { type: "string" },
        accountName: { type: "string" },
        accountNumber: { type: "string" },
        bsb: { type: "string" },
        iban: { type: "string" },
        bic: { type: "string" },
        billerCode: { type: "string" },
        bpayReference: { type: "string" },
        paymentMethod: { type: "string" },
        extra: { type: "object", additionalProperties: { type: "string" } },
      },
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "key", "value", "confidence"],
        properties: {
          category: { type: "string", enum: INVOICE_FIELD_CATEGORIES },
          key: { type: "string" },
          value: { type: "string" },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
    reviewReasons: { type: "array", items: { type: "string" } },
  },
} as const;

export interface InvoiceLlmClassifyPayload {
  vendor: InvoiceVendor;
  confidence: number;
  header: InvoiceHeader;
  lineItems: InvoiceLineItem[];
  taxLines: InvoiceTaxLine[];
  bank?: InvoiceBankDetails;
  fields: ClassifiedField[];
  warnings: string[];
  reviewReasons: string[];
}

export type InvoiceSchemaResult =
  | { ok: true; value: InvoiceLlmClassifyPayload }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asInteger(value: unknown, field: string, errors: string[]): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${field} must be a number`);
    return undefined;
  }
  if (!Number.isInteger(value)) {
    errors.push(`${field} must be an integer (minor units / cents)`);
    return undefined;
  }
  return value;
}

function asNumber(value: unknown, field: string, errors: string[]): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${field} must be a number`);
    return undefined;
  }
  return value;
}

function asStringMap(value: unknown, field: string, errors: string[]): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    errors.push(`${field} must be an object of strings`);
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") {
      errors.push(`${field}.${k} must be a string`);
      continue;
    }
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function asStringList(value: unknown, field: string, errors: string[]): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of strings`);
    return [];
  }
  return value
    .map((item, i) => {
      if (typeof item !== "string") {
        errors.push(`${field}[${i}] must be a string`);
        return "";
      }
      return item.trim();
    })
    .filter(Boolean);
}

function parseHeader(raw: unknown, errors: string[]): InvoiceHeader {
  if (!isRecord(raw)) {
    errors.push("header must be an object");
    return {};
  }
  return {
    invoiceNumber: asString(raw.invoiceNumber),
    invoiceDate: asString(raw.invoiceDate),
    issueDate: asString(raw.issueDate),
    dueDate: asString(raw.dueDate),
    paymentTerms: asString(raw.paymentTerms),
    currency: asString(raw.currency)?.toUpperCase(),
    poNumber: asString(raw.poNumber),
    accountNumber: asString(raw.accountNumber),
    referenceNumber: asString(raw.referenceNumber),
    customerNumber: asString(raw.customerNumber),
    subtotal: asInteger(raw.subtotal, "header.subtotal", errors),
    taxTotal: asInteger(raw.taxTotal, "header.taxTotal", errors),
    total: asInteger(raw.total, "header.total", errors),
    amountDue: asInteger(raw.amountDue, "header.amountDue", errors),
    supplierName: asString(raw.supplierName),
    supplierLegalName: asString(raw.supplierLegalName),
    supplierTaxId: asString(raw.supplierTaxId),
    supplierVat: asString(raw.supplierVat),
    supplierAddress: asString(raw.supplierAddress),
    supplierCountry: asString(raw.supplierCountry),
    supplierEmail: asString(raw.supplierEmail),
    supplierPhone: asString(raw.supplierPhone),
    supplierWebsite: asString(raw.supplierWebsite),
    customerName: asString(raw.customerName),
    customerAddress: asString(raw.customerAddress),
    customerEmail: asString(raw.customerEmail),
    notes: asString(raw.notes),
  };
}

function parseLineItems(raw: unknown, errors: string[]): InvoiceLineItem[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    errors.push("lineItems must be an array");
    return [];
  }
  return raw.flatMap((item, i) => {
    if (!isRecord(item)) {
      errors.push(`lineItems[${i}] must be an object`);
      return [];
    }
    const description = asString(item.description);
    if (!description) {
      errors.push(`lineItems[${i}].description is required`);
      return [];
    }
    const lineNumber = asInteger(item.lineNumber, `lineItems[${i}].lineNumber`, errors) ?? i + 1;
    return [
      {
        lineNumber,
        description,
        quantity: asNumber(item.quantity, `lineItems[${i}].quantity`, errors),
        unit: asString(item.unit),
        unitPrice: asInteger(item.unitPrice, `lineItems[${i}].unitPrice`, errors),
        taxRate: asNumber(item.taxRate, `lineItems[${i}].taxRate`, errors),
        taxAmount: asInteger(item.taxAmount, `lineItems[${i}].taxAmount`, errors),
        lineTotal: asInteger(item.lineTotal, `lineItems[${i}].lineTotal`, errors),
        periodStart: asString(item.periodStart),
        periodEnd: asString(item.periodEnd),
        extra: asStringMap(item.extra, `lineItems[${i}].extra`, errors),
      },
    ];
  });
}

function parseTaxLines(raw: unknown, errors: string[]): InvoiceTaxLine[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    errors.push("taxLines must be an array");
    return [];
  }
  return raw.flatMap((item, i) => {
    if (!isRecord(item)) {
      errors.push(`taxLines[${i}] must be an object`);
      return [];
    }
    const label = asString(item.label);
    if (!label) {
      errors.push(`taxLines[${i}].label is required`);
      return [];
    }
    return [
      {
        label,
        rate: asNumber(item.rate, `taxLines[${i}].rate`, errors),
        taxableAmount: asInteger(item.taxableAmount, `taxLines[${i}].taxableAmount`, errors),
        taxAmount: asInteger(item.taxAmount, `taxLines[${i}].taxAmount`, errors),
      },
    ];
  });
}

function parseBank(raw: unknown, errors: string[]): InvoiceBankDetails | undefined {
  if (raw == null) return undefined;
  if (!isRecord(raw)) {
    errors.push("bank must be an object");
    return undefined;
  }
  const bank: InvoiceBankDetails = {
    bankName: asString(raw.bankName),
    accountName: asString(raw.accountName),
    accountNumber: asString(raw.accountNumber),
    bsb: asString(raw.bsb),
    iban: asString(raw.iban),
    bic: asString(raw.bic),
    billerCode: asString(raw.billerCode),
    bpayReference: asString(raw.bpayReference),
    paymentMethod: asString(raw.paymentMethod),
    extra: asStringMap(raw.extra, "bank.extra", errors),
  };
  return Object.values(bank).some((v) => v != null && v !== "") ? bank : undefined;
}

function parseFields(raw: unknown, errors: string[]): ClassifiedField[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    errors.push("fields must be an array");
    return [];
  }
  return raw.flatMap((item, i) => {
    if (!isRecord(item)) {
      errors.push(`fields[${i}] must be an object`);
      return [];
    }
    const category = asString(item.category);
    const key = asString(item.key);
    const value = asString(item.value);
    if (!category || !INVOICE_FIELD_CATEGORIES.includes(category as InvoiceFieldCategory)) {
      errors.push(`fields[${i}].category is invalid`);
      return [];
    }
    if (!key || !value) {
      errors.push(`fields[${i}] needs key and value`);
      return [];
    }
    const confidence = asInteger(item.confidence, `fields[${i}].confidence`, errors) ?? 0;
    return [{ category: category as InvoiceFieldCategory, key, value, confidence }];
  });
}

/**
 * Validate and coerce unknown model output into the invoice classify payload.
 * Unknown keys are ignored; type errors fail the payload (caller falls back).
 */
export function validateLlmClassify(input: unknown): InvoiceSchemaResult {
  if (!isRecord(input)) {
    return { ok: false, error: "LLM output is not a JSON object" };
  }
  const errors: string[] = [];
  const vendorRaw = asString(input.vendor) ?? "generic";
  const vendor = INVOICE_VENDORS.includes(vendorRaw as InvoiceVendor)
    ? (vendorRaw as InvoiceVendor)
    : "generic";
  let confidence = asInteger(input.confidence, "confidence", errors);
  if (confidence == null) {
    errors.push("confidence is required");
    confidence = 0;
  } else {
    confidence = Math.max(0, Math.min(100, confidence));
  }

  const header = parseHeader(input.header, errors);
  const lineItems = parseLineItems(input.lineItems, errors);
  const taxLines = parseTaxLines(input.taxLines, errors);
  const bank = parseBank(input.bank, errors);
  const fields = parseFields(input.fields, errors);
  const warnings = asStringList(input.warnings, "warnings", errors);
  const reviewReasons = asStringList(input.reviewReasons, "reviewReasons", errors);

  if (errors.length) {
    return { ok: false, error: errors.slice(0, 6).join("; ") };
  }
  return {
    ok: true,
    value: {
      vendor,
      confidence,
      header,
      lineItems,
      taxLines,
      bank,
      fields,
      warnings,
      reviewReasons,
    },
  };
}
