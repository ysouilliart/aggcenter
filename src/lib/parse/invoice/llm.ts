/**
 * OpenAI-compatible chat client for schema-constrained invoice classify.
 *
 * Extracted invoice text is sent to the configured model provider. Do not log
 * that text (PII / commercial data). Only metadata (model, file name, length).
 */

import type { InvoiceClassifyConfig } from "../../config";
import { INVOICE_LLM_OUTPUT_SCHEMA } from "./schema";

export interface InvoiceLlmRequest {
  fileName: string;
  text: string;
  model: string;
}

export interface InvoiceLlmClient {
  complete(request: InvoiceLlmRequest): Promise<unknown>;
}

const MAX_TEXT_CHARS = 24_000;

const SYSTEM_PROMPT = `You classify supplier invoices from extracted plain text.
Return ONE JSON object that matches the provided schema. No markdown, no commentary.

Rules:
- Amounts are integer minor units (cents): 189.00 USD → 18900.
- Dates are ISO YYYY-MM-DD.
- currency is an ISO 4217 code (USD, AUD, EUR, GBP, CAD, …).
- vendor is origin, tesla, hotjar, or generic. Use generic unless the supplier is clearly that brand.
- Do not invent values that are not supported by the text. Omit unknown fields.
- If invoice number, totals, or currency are missing or ambiguous, say so in reviewReasons.
- confidence is 0–100 for how complete and reliable the mapping is.
- fields[] are category/key/value/confidence rows for notable classified values.

Schema:
${JSON.stringify(INVOICE_LLM_OUTPUT_SCHEMA)}`;

export function truncateInvoiceText(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} characters]`;
}

export function buildLlmMessages(fileName: string, text: string): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `File name: ${fileName}\n\nExtracted text:\n${truncateInvoiceText(text)}`,
    },
  ];
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  return JSON.parse(unfenced) as unknown;
}

export function createOpenAiInvoiceLlmClient(config: InvoiceClassifyConfig): InvoiceLlmClient {
  return {
    async complete(request) {
      if (!config.apiKey) {
        throw new Error("INVOICE_LLM_API_KEY is not configured");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const res = await fetch(`${config.apiBase}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: request.model || config.model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: buildLlmMessages(request.fileName, request.text),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`LLM HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error("LLM response had no content");
        return parseJsonContent(content);
      } catch (err) {
        const message = err instanceof Error ? err.message : "LLM classify failed";
        // Do not log invoice text — only file name and model.
        console.warn("[invoice-llm] classify failed", {
          fileName: request.fileName,
          model: request.model || config.model,
          error: message,
        });
        throw err instanceof Error ? err : new Error(message);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
