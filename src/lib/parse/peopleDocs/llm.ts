/**
 * OpenAI-compatible chat client for people-document classify.
 * Uses the resolved people-docs classify config (PEOPLE_DOCS_LLM_API_KEY first).
 * Do not log extracted document text (HR / PII).
 */

import type { InvoiceClassifyConfig } from "../../config";
import { completeOpenAiJsonObject, truncateLlmText } from "../openaiCompatible";
import { PEOPLE_DOC_LLM_OUTPUT_SCHEMA } from "./schema";

/** HR contracts are longer than invoices — send more extract to the model. */
export const PEOPLE_DOC_LLM_MAX_TEXT_CHARS = 48_000;

export interface PeopleDocLlmRequest {
  fileName: string;
  text: string;
  model: string;
}

export interface PeopleDocLlmClient {
  complete(request: PeopleDocLlmRequest): Promise<unknown>;
}

const SYSTEM_PROMPT = `You classify ResMed HR / people agreements, policies, NDAs, employment, contractor, and offer-letter documents from extracted plain text and the file name.
Return ONE JSON object that matches the provided schema. No markdown, no commentary.

Field rules:
- agreementId: labelled Agreement / Contract / Document ID or Number. It must contain a digit. Never use ordinary words (agency, the, this, agreement). Omit if none.
- requestor: the person who requested or submitted the document (Requestor, Requester, Requested by, Prepared for, Prepared by).
- agreementType: Employment, Contractor, Consultancy, NDA, Policy, Offer Letter, Secondment, Collective Agreement, Confidentiality, Internship, or Assignment. Infer from the title, file name, or opening recitals (e.g. "Non-Disclosure" → NDA, "letter of offer" → Offer Letter).
- agreementSubType: the more specific flavour (Mutual, Unilateral, Individual contractor, Global, Fixed-term).
- businessFunction: labelled Business Function / Business Unit / Function (often People, HR, or Legal).
- resmedEntity: the ResMed legal entity that is a party (ResMed Pty Ltd, ResMed Inc, ResMed Ltd, ResMed SAS, ResMed GmbH, …). Prefer a labelled ResMed Entity.
- startDate / endDate: ISO YYYY-MM-DD. Accept Effective Date, Commencement, Start, Term begins, Expiry. If a term length is given (e.g. "two years from the Effective Date"), compute the end date.
- autoRenew: true if the agreement renews automatically; false if it says it does not.
- perpetual: true if the term is perpetual, indefinite, or continues until terminated with no end date; false if an end/expiry date or fixed term is given.

General:
- Dates are ISO YYYY-MM-DD.
- autoRenew and perpetual are booleans.
- Do not invent values that are not supported by the text or file name. Omit unknown fields.
- If agreement ID, type, entity, or dates are missing or ambiguous, say so in reviewReasons.
- confidence is 0–100 for how complete and reliable the mapping is.
- You fill gaps the static parser misses. Do not contradict clearly labelled values in the text.
- synopsis: always include this. Write 2 to 4 sentences, in your own words, describing what the document is, who it involves, and the term or obligation it sets. It is a reviewer overview, not a quote, field list, or extract. Do not copy sentences or paragraphs from the source.

Schema:
${JSON.stringify(PEOPLE_DOC_LLM_OUTPUT_SCHEMA)}`;

export function truncatePeopleDocText(text: string): string {
  return truncateLlmText(text, PEOPLE_DOC_LLM_MAX_TEXT_CHARS);
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

export function createOpenAiPeopleDocLlmClient(config: InvoiceClassifyConfig): PeopleDocLlmClient {
  return {
    async complete(request) {
      return completeOpenAiJsonObject(config, {
        fileName: request.fileName,
        model: request.model || config.model,
        messages: buildPeopleDocLlmMessages(request.fileName, request.text),
        logLabel: "people-docs-llm",
        missingKeyError: "PEOPLE_DOCS_LLM_API_KEY is not configured",
      });
    },
  };
}
