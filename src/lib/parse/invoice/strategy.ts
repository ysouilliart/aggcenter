/**
 * Classify strategy: deterministic extract is unchanged; classification is
 *   1. always run static vendor/regex (scripting is the floor),
 *   2. skip the model for high-confidence Hotjar/Tesla/Origin (optional fast path),
 *   3. schema-constrained LLM overlay that only fills empty fields, else
 *   4. static regex fallback when LLM is off / missing a key / fails.
 */

import type { InvoiceClassifyConfig } from "../../config";
import { getConfig } from "../../config";
import { parseInvoiceDate } from "./dates";
import {
  classifyInvoice,
  needsHumanConfirm,
  score,
  statusFor,
  type ClassifyInput,
} from "./classify";
import { createOpenAiInvoiceLlmClient, type InvoiceLlmClient } from "./llm";
import { mergeStaticAndLlm } from "./merge";
import { validateLlmClassify, type InvoiceLlmClassifyPayload } from "./schema";
import type {
  ClassifiedField,
  ExtractedDocument,
  InvoiceClassifyMode,
  InvoiceParseResult,
} from "./types";
import { INVOICE_LLM_PARSER_ID, INVOICE_LLM_PARSER_VERSION, INVOICE_PARSER_ID } from "./types";

export interface ClassifyStrategyOptions {
  config?: InvoiceClassifyConfig;
  llmClient?: InvoiceLlmClient;
}

const VENDOR_FAST_PATH = new Set(["origin", "tesla", "hotjar"]);

export function isStaticFastPathHit(result: InvoiceParseResult): boolean {
  return (
    VENDOR_FAST_PATH.has(result.vendor) &&
    result.status === "parsed" &&
    result.confidence >= 80
  );
}

function withMode(
  result: InvoiceParseResult,
  classifyMode: InvoiceClassifyMode,
  classifierWarning?: string,
): InvoiceParseResult {
  const needsConfirm = needsHumanConfirm({
    status: result.status,
    confidence: result.confidence,
    classifyMode,
  });
  return {
    ...result,
    classifyMode,
    classifierWarning,
    needsConfirm,
    parserId: classifyMode === "llm" ? INVOICE_LLM_PARSER_ID : result.parserId || INVOICE_PARSER_ID,
    parserVersion:
      classifyMode === "llm" ? INVOICE_LLM_PARSER_VERSION : result.parserVersion,
  };
}

function fieldsFromHeader(payload: InvoiceLlmClassifyPayload): ClassifiedField[] {
  if (payload.fields.length) return payload.fields;
  const fields: ClassifiedField[] = [];
  const add = (category: ClassifiedField["category"], key: string, value: string | undefined, confidence: number) => {
    if (!value) return;
    fields.push({ category, key, value, confidence });
  };
  const h = payload.header;
  add("supplier", "name", h.supplierName, 80);
  add("supplier", "taxId", h.supplierTaxId, 80);
  add("supplier", "vat", h.supplierVat, 80);
  add("customer", "name", h.customerName, 75);
  add("dates", "invoiceDate", h.invoiceDate, 85);
  add("dates", "dueDate", h.dueDate, 80);
  add("payment", "invoiceNumber", h.invoiceNumber, 90);
  add("totals", "currency", h.currency, 80);
  if (h.total != null) add("totals", "total", String(h.total), 85);
  if (payload.bank?.iban) add("bank", "iban", payload.bank.iban, 90);
  return fields;
}

function normalizeHeaderDates(header: InvoiceLlmClassifyPayload["header"]): InvoiceLlmClassifyPayload["header"] {
  const iso = (value?: string) => {
    if (!value) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return parseInvoiceDate(value) ?? value;
  };
  return {
    ...header,
    invoiceDate: iso(header.invoiceDate),
    issueDate: iso(header.issueDate) ?? iso(header.invoiceDate),
    dueDate: iso(header.dueDate),
  };
}

export function resultFromLlmPayload(
  input: ClassifyInput,
  payload: InvoiceLlmClassifyPayload,
): InvoiceParseResult {
  const header = normalizeHeaderDates(payload.header);
  const lineItems = payload.lineItems;
  const bank = payload.bank;
  const warnings = [...(input.warnings ?? []), ...payload.warnings];
  const confidence = Math.max(0, Math.min(100, payload.confidence || score(header, lineItems, bank)));
  const { status, reasons } = statusFor({
    confidence,
    header,
    extractedEmpty: false,
    warnings,
  });
  for (const extra of payload.reviewReasons) {
    if (!reasons.includes(extra)) reasons.push(extra);
  }
  for (const reason of reasons) warnings.push(reason);

  return {
    parserId: INVOICE_LLM_PARSER_ID,
    parserVersion: INVOICE_LLM_PARSER_VERSION,
    vendor: payload.vendor,
    status,
    confidence,
    header,
    lineItems,
    taxLines: payload.taxLines,
    bank,
    fields: fieldsFromHeader({ ...payload, header }),
    warnings: [...new Set(warnings)],
    reviewReasons: reasons,
    trace: [
      {
        seq: 1,
        level: "info",
        stage: "llm",
        message: `LLM classify status=${status} confidence=${confidence}`,
        detail: {
          vendor: payload.vendor,
          invoiceNumber: header.invoiceNumber,
          total: header.total,
          textChars: input.fullText.length,
        },
      },
    ],
    pageCount: input.pageCount,
    extractedText: input.fullText,
    classifyMode: "llm",
    needsConfirm: needsHumanConfirm({ status, confidence, classifyMode: "llm" }),
  };
}

function classifyInputFromExtracted(extracted: ExtractedDocument): ClassifyInput {
  return {
    fileName: extracted.fileName,
    lines: extracted.lines,
    fullText: extracted.fullText,
    pageCount: extracted.pageCount,
    warnings: extracted.warnings,
  };
}

function resolveConfig(options?: ClassifyStrategyOptions): InvoiceClassifyConfig {
  return options?.config ?? getConfig().invoiceClassify;
}

function resolveClient(config: InvoiceClassifyConfig, options?: ClassifyStrategyOptions): InvoiceLlmClient {
  return options?.llmClient ?? createOpenAiInvoiceLlmClient(config);
}

/** Classify extracted invoice text using the configured strategy. */
export async function classifyExtractedInvoice(
  extracted: ExtractedDocument,
  options?: ClassifyStrategyOptions,
): Promise<InvoiceParseResult> {
  const input = classifyInputFromExtracted(extracted);
  const config = resolveConfig(options);
  const empty = extracted.lines.length === 0 || !extracted.fullText.trim();

  const staticResult = classifyInvoice(input);

  if (empty) {
    return withMode(staticResult, "static");
  }

  if (!config.llmReady) {
    return withMode(staticResult, "static", config.warning);
  }

  if (config.staticFastPath && isStaticFastPathHit(staticResult)) {
    return withMode(staticResult, "static");
  }

  try {
    const raw = await resolveClient(config, options).complete({
      fileName: extracted.fileName,
      text: extracted.fullText,
      model: config.model,
    });
    const validated = validateLlmClassify(raw);
    if (!validated.ok) {
      return withMode(
        staticResult,
        "static-fallback",
        `LLM output failed schema validation (${validated.error}). Using static parser.`,
      );
    }
    const llmResult = resultFromLlmPayload(input, validated.value);
    return mergeStaticAndLlm(staticResult, llmResult, extracted.fullText);
  } catch (err) {
    const message = err instanceof Error ? err.message : "LLM classify failed";
    return withMode(
      staticResult,
      "static-fallback",
      `LLM classify failed (${message}). Using static parser.`,
    );
  }
}

export function getInvoiceClassifyStatus(config = getConfig().invoiceClassify) {
  return {
    mode: config.llmReady ? ("llm" as const) : ("static" as const),
    llmEnabled: config.llmEnabled,
    llmReady: config.llmReady,
    model: config.model,
    provider: config.provider,
    staticFastPath: config.staticFastPath,
    warning: config.warning,
    /** Extracted text is sent to this host only when llmReady and classify runs. */
    apiBase: config.llmReady ? config.apiBase : undefined,
  };
}
