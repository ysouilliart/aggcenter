/**
 * OpenAI-compatible chat client for people-document classify.
 * Uses the same INVOICE_LLM_* key, host, and request path as invoices.
 * Do not log extracted document text (HR / PII).
 */

import type { InvoiceClassifyConfig } from "../../config";
import { completeOpenAiJsonObject, truncateLlmText } from "../openaiCompatible";
import { PEOPLE_DOC_LLM_OUTPUT_SCHEMA } from "./schema";

export interface PeopleDocLlmRequest {
  fileName: string;
  text: string;
  model: string;
}

export interface PeopleDocLlmClient {
  complete(request: PeopleDocLlmRequest): Promise<unknown>;
}

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

export const truncatePeopleDocText = truncateLlmText;

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

export function createOpenAiPeopleDocLlmClient(config: InvoiceClassifyConfig): PeopleDocLlmClient {
  return {
    async complete(request) {
      return completeOpenAiJsonObject(config, {
        fileName: request.fileName,
        model: request.model || config.model,
        messages: buildPeopleDocLlmMessages(request.fileName, request.text),
        logLabel: "people-docs-llm",
      });
    },
  };
}
