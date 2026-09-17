/**
 * Shared types for the invoice parser (PDF / DOCX / XLSX / CSV).
 *
 * Monetary amounts are integer minor units (cents), matching the rest of aggcenter.
 */

export const INVOICE_PARSER_ID = "invoice-generic";
export const INVOICE_PARSER_VERSION = "1.0.0";
export const INVOICE_LLM_PARSER_ID = "invoice-llm";
export const INVOICE_LLM_PARSER_VERSION = "1.1.0";

export type InvoiceParseStatus = "parsed" | "partial" | "anomaly" | "failed";
export type InvoiceFolder = "landing" | "received" | "processed" | "archived" | "anomaly";
export type InvoiceClassifyMode = "static" | "llm" | "static-fallback";
export type InvoiceConfirmAction = "accept" | "reject" | "edit";
export type InvoiceFieldCategory =
  | "supplier"
  | "customer"
  | "dates"
  | "totals"
  | "tax"
  | "bank"
  | "payment"
  | "site"
  | "other";

export type InvoiceVendor = "origin" | "tesla" | "hotjar" | "generic";

export interface InvoiceLineItem {
  lineNumber: number;
  description: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  taxRate?: number;
  taxAmount?: number;
  lineTotal?: number;
  periodStart?: string;
  periodEnd?: string;
  extra?: Record<string, string>;
}

export interface InvoiceTaxLine {
  label: string;
  rate?: number;
  taxableAmount?: number;
  taxAmount?: number;
}

export interface InvoiceBankDetails {
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  bsb?: string;
  iban?: string;
  bic?: string;
  billerCode?: string;
  bpayReference?: string;
  paymentMethod?: string;
  extra?: Record<string, string>;
}

export interface ClassifiedField {
  category: InvoiceFieldCategory;
  key: string;
  value: string;
  confidence: number;
}

export interface InvoiceParseTraceEvent {
  seq: number;
  level: "info" | "warn" | "error";
  stage: string;
  message: string;
  page?: number;
  detail?: Record<string, unknown>;
}

export interface InvoiceHeader {
  invoiceNumber?: string;
  invoiceDate?: string;
  issueDate?: string;
  dueDate?: string;
  paymentTerms?: string;
  currency?: string;
  poNumber?: string;
  accountNumber?: string;
  referenceNumber?: string;
  customerNumber?: string;
  subtotal?: number;
  taxTotal?: number;
  total?: number;
  amountDue?: number;
  supplierName?: string;
  supplierLegalName?: string;
  supplierTaxId?: string;
  supplierVat?: string;
  supplierAddress?: string;
  supplierCountry?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  supplierWebsite?: string;
  customerName?: string;
  customerAddress?: string;
  customerEmail?: string;
  notes?: string;
}

export interface InvoiceParseResult {
  parserId: string;
  parserVersion: string;
  vendor: InvoiceVendor;
  status: InvoiceParseStatus;
  confidence: number;
  header: InvoiceHeader;
  lineItems: InvoiceLineItem[];
  taxLines: InvoiceTaxLine[];
  bank?: InvoiceBankDetails;
  fields: ClassifiedField[];
  warnings: string[];
  reviewReasons: string[];
  trace: InvoiceParseTraceEvent[];
  pageCount: number;
  extractedText: string;
  /** How fields were classified (static overlays vs schema-constrained LLM). */
  classifyMode: InvoiceClassifyMode;
  /** Operator-facing note when LLM is off, missing a key, or fell back. */
  classifierWarning?: string;
  /** Uncertain / partial / low-confidence results must be confirmed before processed. */
  needsConfirm: boolean;
}

export interface ExtractedDocument {
  kind: "pdf" | "docx" | "xlsx" | "csv" | "text" | "unsupported";
  fileName: string;
  mimeType: string;
  pageCount: number;
  lines: string[];
  fullText: string;
  warnings: string[];
}
