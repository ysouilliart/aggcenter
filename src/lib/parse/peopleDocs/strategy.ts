/**
 * People-doc classify strategy: static labelled fields first, then LLM overlay
 * that only fills gaps, else static fallback.
 */

import type { InvoiceClassifyConfig } from "../../config";
import { getConfig } from "../../config";
import type { ExtractedDocument } from "../invoice/types";
import { classifyPeopleDoc, needsPeopleDocConfirm } from "./classify";
import { createOpenAiPeopleDocLlmClient, type PeopleDocLlmClient } from "./llm";
import { mergeStaticAndLlmPeopleDoc } from "./merge";
import { peopleDocModelChoices, resolvePeopleDocParseModel } from "./models";
import { coerceSynopsis, validatePeopleDocLlm } from "./schema";
import type { PeopleDocClassifyMode, PeopleDocParseResult } from "./types";
import { PEOPLE_DOC_PARSER_ID } from "./types";

export interface PeopleDocClassifyOptions {
  config?: InvoiceClassifyConfig;
  llmClient?: PeopleDocLlmClient;
  /** Chat model for this classify call. Falls back to the UI selection, then env. */
  model?: string;
}

function withMode(
  result: PeopleDocParseResult,
  classifyMode: PeopleDocClassifyMode,
  classifierWarning?: string,
): PeopleDocParseResult {
  return {
    ...result,
    classifyMode,
    classifierWarning,
    parserId: result.parserId || PEOPLE_DOC_PARSER_ID,
    needsConfirm: needsPeopleDocConfirm({
      status: result.status,
      confidence: result.confidence,
      classifyMode,
    }),
  };
}

function resolveConfig(options?: PeopleDocClassifyOptions): InvoiceClassifyConfig {
  return options?.config ?? getConfig().peopleDocsClassify;
}

function resolveClient(config: InvoiceClassifyConfig, options?: PeopleDocClassifyOptions): PeopleDocLlmClient {
  return options?.llmClient ?? createOpenAiPeopleDocLlmClient(config);
}

/**
 * Tests that pass an explicit config keep that config's model unless they
 * also pass `model`. Production calls (no config override) honor the UI selection.
 */
function modelForCall(config: InvoiceClassifyConfig, options?: PeopleDocClassifyOptions): string {
  if (options?.model?.trim() || !options?.config) {
    return resolvePeopleDocParseModel(config, options?.model);
  }
  return config.model;
}

export async function classifyExtractedPeopleDoc(
  extracted: ExtractedDocument,
  options?: PeopleDocClassifyOptions,
): Promise<PeopleDocParseResult> {
  const config = resolveConfig(options);
  const empty = extracted.lines.length === 0 || !extracted.fullText.trim();
  const staticResult = classifyPeopleDoc({
    fileName: extracted.fileName,
    lines: extracted.lines,
    fullText: extracted.fullText,
    pageCount: extracted.pageCount,
    warnings: extracted.warnings,
  });

  if (empty) return withMode(staticResult, "static");
  if (!config.llmReady) return withMode(staticResult, "static", config.warning);

  const model = modelForCall(config, options);
  try {
    const raw = await resolveClient(config, options).complete({
      fileName: extracted.fileName,
      text: extracted.fullText,
      model,
    });
    const validated = validatePeopleDocLlm(raw);
    if (!validated.ok) {
      return withMode(
        staticResult,
        "static-fallback",
        `LLM output failed schema validation (${validated.error}). Using static parser.`,
      );
    }
    const source = `${extracted.fileName}\n${extracted.fullText}`;
    return mergeStaticAndLlmPeopleDoc(
      staticResult,
      validated.value.header,
      validated.value.confidence,
      validated.value.warnings,
      validated.value.reviewReasons,
      source,
      {
        synopsis: coerceSynopsis(validated.value.synopsis, source),
        llmModel: model,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "LLM classify failed";
    return withMode(
      staticResult,
      "static-fallback",
      `LLM classify failed (${message}). Using static parser.`,
    );
  }
}

export function getPeopleDocClassifyStatus(config = getConfig().peopleDocsClassify) {
  const model = resolvePeopleDocParseModel(config);
  return {
    mode: config.llmReady ? ("llm" as const) : ("static" as const),
    llmEnabled: config.llmEnabled,
    llmReady: config.llmReady,
    model,
    configuredModel: config.model,
    provider: config.provider,
    models: peopleDocModelChoices(config.provider, config.model),
    warning: config.warning,
    apiBase: config.llmReady ? config.apiBase : undefined,
  };
}
