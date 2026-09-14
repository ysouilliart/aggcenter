import { classifyInvoice } from "./classify";
import { extractInvoiceDocument } from "./extract";
import type { InvoiceParseResult } from "./types";

export {
  INVOICE_PARSER_ID,
  INVOICE_PARSER_VERSION,
  type ClassifiedField,
  type ExtractedDocument,
  type InvoiceBankDetails,
  type InvoiceFieldCategory,
  type InvoiceFolder,
  type InvoiceHeader,
  type InvoiceLineItem,
  type InvoiceParseResult,
  type InvoiceParseStatus,
  type InvoiceParseTraceEvent,
  type InvoiceTaxLine,
  type InvoiceVendor,
} from "./types";
export { extractInvoiceDocument, mimeForFile, extensionOf } from "./extract";
export { classifyInvoice } from "./classify";
export { parseInvoiceDate } from "./dates";
export { detectCurrency, parseMoney } from "./amounts";

/** Extract text from a document buffer and classify invoice fields. */
export async function parseInvoiceDocument(
  buf: Buffer,
  options: { fileName: string },
): Promise<InvoiceParseResult> {
  const extracted = await extractInvoiceDocument(buf, options.fileName);
  return classifyInvoice({
    fileName: options.fileName,
    lines: extracted.lines,
    fullText: extracted.fullText,
    pageCount: extracted.pageCount,
    warnings: extracted.warnings,
  });
}
