import type {
  ClassifiedField,
  InvoiceBankDetails,
  InvoiceClassifyMode,
  InvoiceConfirmAction,
  InvoiceFolder,
  InvoiceHeader,
  InvoiceLineItem,
  InvoiceParseStatus,
  InvoiceParseTraceEvent,
  InvoiceTaxLine,
  InvoiceVendor,
} from "../parse/invoice/types";

export type InvoiceSource = "upload" | "oci" | "sample";

export interface InvoiceParseJob {
  id: string;
  invoiceId: string;
  storageKey?: string;
  parserId: string;
  parserVersion: string;
  status: InvoiceParseStatus;
  startedAt: string;
  finishedAt: string;
  lineItemCount: number;
  warningCount: number;
  pageCount: number;
  confidence: number;
  events: InvoiceParseTraceEvent[];
}

export interface InvoiceRecord extends InvoiceHeader {
  id: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  source: InvoiceSource;
  folder: InvoiceFolder;
  storageKey?: string;
  originalKey?: string;
  parseStatus: InvoiceParseStatus;
  parserId?: string;
  parserVersion?: string;
  vendor?: InvoiceVendor;
  confidence: number;
  pageCount?: number;
  reviewReason?: string;
  extractedText?: string;
  classifyMode?: InvoiceClassifyMode;
  classifierWarning?: string;
  needsConfirm?: boolean;
  confirmedAt?: string;
  confirmedBy?: string;
  confirmAction?: InvoiceConfirmAction;
  uploadedAt: string;
  processedAt?: string;
  archivedAt?: string;
  lineItemCount: number;
}

export interface InvoiceConfirmEvent {
  id: string;
  invoiceId: string;
  action: InvoiceConfirmAction;
  field?: string;
  oldValue?: string;
  newValue?: string;
  actor: string;
  reason?: string;
  createdAt: string;
}

export interface InvoiceDetail {
  invoice: InvoiceRecord;
  lineItems: InvoiceLineItem[];
  taxLines: InvoiceTaxLine[];
  bank?: InvoiceBankDetails;
  fields: ClassifiedField[];
  job: InvoiceParseJob | null;
  confirmEvents: InvoiceConfirmEvent[];
}

export interface InvoiceSummary {
  total: number;
  byFolder: Record<InvoiceFolder, number>;
  byStatus: Record<string, number>;
  needsReview: number;
  parsed: number;
}

export const INVOICE_FOLDERS: InvoiceFolder[] = [
  "landing",
  "received",
  "processed",
  "archived",
  "anomaly",
];
