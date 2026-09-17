/**
 * OpenAI-compatible chat client for people-document classify.
 * Do not log extracted document text (HR / PII).
 */

import type { InvoiceClassifyConfig } from "../../config";
import { PEOPLE_DOC_LLM_OUTPUT_SCHEMA } from "./schema";

export interface PeopleDocLlmRequest {
  fileName: string;
  text: string;
  model: string;
}

export interface PeopleDocLlmClient {
  complete(request: PeopleDocLlmRequest): Promise<unknown>;
}

const MAX_TEXT_CHARS = 24_000;

const SYSTEM_PROMPT = `You classify ResMed HR / people agreements and policies from extracted plain text.
Return ONE JSON object that matches the provided schema. No markdown, no commentary.

Rules:
- Dates are ISO YYYY-MM-DD.
- autoRenew and perpetual are booleans.
- Do not invent values that are not supported by the text. Omit unknown fields.
- agreementId is the labelled agreement / contract / document ID.
- requestor is the person who requested the agreement.
- resmedEntity is the ResMed legal entity named in the document.
- If agreement ID, type, entity, or dates are missing or ambiguous, say so in reviewReasons.
- confidence is 0–100 for how complete and reliable the mapping is.
- You fill gaps the static parser misses. Do not contradict labelled values in the text.

Schema:
${JSON.stringify(PEOPLE_DOC_LLM_OUTPUT_SCHEMA)}`;

export function truncatePeopleDocText(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} characters]`;
}

export function buildPeopleDocLlmMessages(
  fileName: string,
  text: string,
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `File name: ${fileName}\n\nExtracted text:\n${truncatePeopleDocText(text)}`,
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

export function createOpenAiPeopleDocLlmClient(config: InvoiceClassifyConfig): PeopleDocLlmClient {
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
            messages: buildPeopleDocLlmMessages(request.fileName, request.text),
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
        console.warn("[people-docs-llm] classify failed", {
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
