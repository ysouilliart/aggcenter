/**
 * Shared OpenAI-compatible chat/completions client for classify.
 * Callers pass a resolved InvoiceClassifyConfig (invoice and people docs
 * resolve keys independently). Do not log extracted document text.
 */

import type { InvoiceClassifyConfig } from "../config";

export const LLM_MAX_TEXT_CHARS = 24_000;

export function truncateLlmText(text: string, max = LLM_MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} characters]`;
}

export function parseLlmJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  return JSON.parse(unfenced) as unknown;
}

export async function completeOpenAiJsonObject(
  config: InvoiceClassifyConfig,
  input: {
    fileName: string;
    model: string;
    messages: { role: "system" | "user"; content: string }[];
    logLabel: string;
    missingKeyError?: string;
  },
): Promise<unknown> {
  if (!config.apiKey) {
    throw new Error(input.missingKeyError ?? "INVOICE_LLM_API_KEY is not configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const model = input.model || config.model;
  try {
    const res = await fetch(`${config.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: input.messages,
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
    return parseLlmJsonContent(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : "LLM classify failed";
    console.warn(`[${input.logLabel}] classify failed`, {
      fileName: input.fileName,
      model,
      error: message,
    });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    clearTimeout(timer);
  }
}
