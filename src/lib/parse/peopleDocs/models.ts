/**
 * Selectable chat models for people-document parse / match / synopsis.
 * The env model stays the default; a process-local override is what the UI sets.
 */

import type { InvoiceClassifyConfig } from "../../config";
import { getConfig } from "../../config";

export interface PeopleDocModelChoice {
  id: string;
  label: string;
}

const OPENAI_MODELS: PeopleDocModelChoice[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
];

const XAI_MODELS: PeopleDocModelChoice[] = [
  { id: "grok-4-fast-non-reasoning", label: "Grok 4 Fast" },
  { id: "grok-4-fast-reasoning", label: "Grok 4 Fast reasoning" },
  { id: "grok-4", label: "Grok 4" },
  { id: "grok-3", label: "Grok 3" },
];

export class PeopleDocModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeopleDocModelError";
  }
}

let selectedModel: string | undefined;

export function resetPeopleDocModelSelection(): void {
  selectedModel = undefined;
}

export function getPeopleDocModelSelection(): string | undefined {
  return selectedModel;
}

export function peopleDocModelChoices(
  provider: InvoiceClassifyConfig["provider"],
  configuredModel: string,
): PeopleDocModelChoice[] {
  const base = provider === "xai" ? XAI_MODELS : OPENAI_MODELS;
  const configured = configuredModel.trim();
  if (!configured || base.some((choice) => choice.id === configured)) return base;
  return [{ id: configured, label: configured }, ...base];
}

export function isPeopleDocModelAllowed(
  model: string,
  provider: InvoiceClassifyConfig["provider"],
  configuredModel: string,
): boolean {
  return peopleDocModelChoices(provider, configuredModel).some((choice) => choice.id === model);
}

export function setPeopleDocModelSelection(
  model: string,
  provider: InvoiceClassifyConfig["provider"],
  configuredModel: string,
): { ok: true; model: string } | { ok: false; error: string } {
  const trimmed = model.trim();
  if (!trimmed || !isPeopleDocModelAllowed(trimmed, provider, configuredModel)) {
    return {
      ok: false,
      error: `Unsupported model "${trimmed || model}" for the ${provider} provider.`,
    };
  }
  selectedModel = trimmed;
  return { ok: true, model: trimmed };
}

/**
 * Model id for a parse. An explicit choice must be in the provider catalog
 * (or the configured env model). Otherwise the UI selection, then the env model.
 */
export function resolvePeopleDocParseModel(
  config: InvoiceClassifyConfig,
  explicit?: string,
): string {
  const requested = explicit?.trim();
  if (requested) {
    if (!isPeopleDocModelAllowed(requested, config.provider, config.model)) {
      throw new PeopleDocModelError(
        `Unsupported model "${requested}" for the ${config.provider} provider.`,
      );
    }
    return requested;
  }
  if (
    selectedModel &&
    isPeopleDocModelAllowed(selectedModel, config.provider, config.model)
  ) {
    return selectedModel;
  }
  return config.model;
}

/** Validate an optional request model, remember it, and return the id to parse with. */
export function selectPeopleDocModelForParse(explicit?: string): string {
  const config = getConfig().peopleDocsClassify;
  const requested = explicit?.trim();
  if (requested) {
    const set = setPeopleDocModelSelection(requested, config.provider, config.model);
    if (!set.ok) throw new PeopleDocModelError(set.error);
    return set.model;
  }
  return resolvePeopleDocParseModel(config);
}
