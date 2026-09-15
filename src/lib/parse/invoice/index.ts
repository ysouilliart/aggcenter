import { extractInvoiceDocument } from "./extract";
import { classifyExtractedInvoice, type ClassifyStrategyOptions } from "./strategy";
import type { InvoiceParseResult } from "./types";

export {
  INVOICE_PARSER_ID,
  INVOICE_PARSER_VERSION,
  INVOICE_LLM_PARSER_ID,
  INVOICE_LLM_PARSER_VERSION,
  type ClassifiedField,
  type ExtractedDocument,
  type InvoiceBankDetails,
  type InvoiceClassifyMode,
  type InvoiceConfirmAction,
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
export { classifyInvoice, detectVendor, needsHumanConfirm, score, statusFor } from "./classify";
export { classifyExtractedInvoice, getInvoiceClassifyStatus, isStaticFastPathHit } from "./strategy";
export { validateLlmClassify, INVOICE_LLM_OUTPUT_SCHEMA } from "./schema";
export { createOpenAiInvoiceLlmClient, buildLlmMessages, truncateInvoiceText } from "./llm";
export type { InvoiceLlmClient } from "./llm";
export { parseInvoiceDate } from "./dates";
export { detectCurrency, parseMoney } from "./amounts";

/** Extract text from a document buffer and classify invoice fields. */
export async function parseInvoiceDocument(
  buf: Buffer,
  options: { fileName: string } & ClassifyStrategyOptions,
): Promise<InvoiceParseResult> {
  const extracted = await extractInvoiceDocument(buf, options.fileName);
  return classifyExtractedInvoice(extracted, {
    config: options.config,
    llmClient: options.llmClient,
  });
}
