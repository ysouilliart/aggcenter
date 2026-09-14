import type { InvoiceParseResult } from "../parse/invoice";
import type { InvoiceParseJob, InvoiceRecord, InvoiceSource } from "./types";
import type { InvoiceFolder } from "../parse/invoice/types";

export interface InvoicePersistBundle {
  invoice: InvoiceRecord;
  parsed: InvoiceParseResult;
  job: InvoiceParseJob;
}

export function recordsFromInvoiceParse(options: {
  id: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  source: InvoiceSource;
  folder: InvoiceFolder;
  storageKey?: string;
  originalKey?: string;
  parsed: InvoiceParseResult;
  uploadedAt?: string;
  startedAt?: string;
}): InvoicePersistBundle {
  const finishedAt = new Date().toISOString();
  const uploadedAt = options.uploadedAt ?? finishedAt;
  const header = options.parsed.header;
  const invoice: InvoiceRecord = {
    ...header,
    id: options.id,
    fileName: options.fileName,
    mimeType: options.mimeType,
    contentHash: options.contentHash,
    source: options.source,
    folder: options.folder,
    storageKey: options.storageKey,
    originalKey: options.originalKey,
    parseStatus: options.parsed.status,
    parserId: options.parsed.parserId,
    parserVersion: options.parsed.parserVersion,
    vendor: options.parsed.vendor,
    confidence: options.parsed.confidence,
    pageCount: options.parsed.pageCount,
    reviewReason: options.parsed.reviewReasons[0],
    extractedText: options.parsed.extractedText,
    uploadedAt,
    processedAt: finishedAt,
    lineItemCount: options.parsed.lineItems.length,
  };

  const job: InvoiceParseJob = {
    id: `${options.id}-JOB`,
    invoiceId: options.id,
    storageKey: options.storageKey,
    parserId: options.parsed.parserId,
    parserVersion: options.parsed.parserVersion,
    status: options.parsed.status,
    startedAt: options.startedAt ?? finishedAt,
    finishedAt,
    lineItemCount: options.parsed.lineItems.length,
    warningCount: options.parsed.warnings.length,
    pageCount: options.parsed.pageCount,
    confidence: options.parsed.confidence,
    events: options.parsed.trace,
  };

  return { invoice, parsed: options.parsed, job };
}

export function folderForStatus(status: InvoiceParseResult["status"]): InvoiceFolder {
  if (status === "anomaly" || status === "failed") return "anomaly";
  return "processed";
}
