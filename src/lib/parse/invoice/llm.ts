/**
 * OpenAI-compatible chat client for schema-constrained invoice classify.
 *
 * Extracted invoice text is sent to the configured model provider. Do not log
 * that text (PII / commercial data). Only metadata (model, file name, length).
 */

import type { InvoiceClassifyConfig } from "../../config";
import { completeOpenAiJsonObject, truncateLlmText } from "../openaiCompatible";
import { INVOICE_LLM_OUTPUT_SCHEMA } from "./schema";

export interface InvoiceLlmRequest {
  fileName: string;
  text: string;
  model: string;
}

export interface InvoiceLlmClient {
  complete(request: InvoiceLlmRequest): Promise<unknown>;
}

const SYSTEM_PROMPT = `You classify supplier invoices from extracted plain text.
Return ONE JSON object that matches the provided schema. No markdown, no commentary.

Rules:
- Amounts: prefer integer minor units (cents): 189.00 USD → 18900. Decimal major units (189.00) are also accepted.
- Dates are ISO YYYY-MM-DD.
- currency is an ISO 4217 code that appears in the text (USD, AUD, EUR, GBP, CAD, …). Do not default $ to AUD unless AUD is labelled.
- vendor is origin, tesla, hotjar, or generic. Use generic unless the supplier is clearly that brand.
- Do not invent values that are not supported by the text. Omit unknown fields.
- If invoice number, totals, or currency are missing or ambiguous, say so in reviewReasons.
- confidence is 0–100 for how complete and reliable the mapping is.
- fields[] are category/key/value/confidence rows for notable classified values.
- You fill gaps the static parser misses. Do not contradict labelled invoice numbers, totals, or currencies in the text.

Schema:
${JSON.stringify(INVOICE_LLM_OUTPUT_SCHEMA)}`;

export const truncateInvoiceText = truncateLlmText;

export function buildLlmMessages(fileName: string, text: string): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `File name: ${fileName}\n\nExtracted text:\n${truncateInvoiceText(text)}`,
    },
  ];
}

export function createOpenAiInvoiceLlmClient(config: InvoiceClassifyConfig): InvoiceLlmClient {
  return {
    async complete(request) {
      return completeOpenAiJsonObject(config, {
        fileName: request.fileName,
        model: request.model || config.model,
        messages: buildLlmMessages(request.fileName, request.text),
        logLabel: "invoice-llm",
      });
    },
  };
}
