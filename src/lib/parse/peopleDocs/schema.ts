/**
 * Schema-constrained LLM output for people-document classify.
 */

import type { PeopleDocHeader } from "./types";

export const PEOPLE_DOC_LLM_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["confidence", "header", "warnings", "reviewReasons"],
  properties: {
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    header: {
      type: "object",
      additionalProperties: false,
      properties: {
        agreementId: { type: "string" },
        requestor: { type: "string" },
        agreementType: { type: "string" },
        agreementSubType: { type: "string" },
        businessFunction: { type: "string" },
        resmedEntity: { type: "string" },
        startDate: { type: "string", description: "ISO date YYYY-MM-DD" },
        endDate: { type: "string", description: "ISO date YYYY-MM-DD" },
        autoRenew: { type: "boolean" },
        perpetual: { type: "boolean" },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
    reviewReasons: { type: "array", items: { type: "string" } },
  },
} as const;

export interface PeopleDocLlmPayload {
  confidence: number;
  header: PeopleDocHeader;
  warnings: string[];
  reviewReasons: string[];
}

export type PeopleDocSchemaResult =
  | { ok: true; value: PeopleDocLlmPayload }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asInteger(value: unknown, field: string, errors: string[]): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${field} must be a number`);
    return undefined;
  }
  if (!Number.isInteger(value)) {
    errors.push(`${field} must be an integer`);
    return undefined;
  }
  return value;
}

function asBoolean(value: unknown, field: string, errors: string[]): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(yes|true|y|1)$/i.test(value.trim())) return true;
    if (/^(no|false|n|0)$/i.test(value.trim())) return false;
  }
  errors.push(`${field} must be a boolean`);
  return undefined;
}

function asStringList(value: unknown, field: string, errors: string[]): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of strings`);
    return [];
  }
  return value
    .map((item, i) => {
      if (typeof item !== "string") {
        errors.push(`${field}[${i}] must be a string`);
        return "";
      }
      return item.trim();
    })
    .filter(Boolean);
}

export function validatePeopleDocLlm(input: unknown): PeopleDocSchemaResult {
  if (!isRecord(input)) {
    return { ok: false, error: "LLM output is not a JSON object" };
  }
  const errors: string[] = [];
  let confidence = asInteger(input.confidence, "confidence", errors);
  if (confidence == null) {
    errors.push("confidence is required");
    confidence = 0;
  } else {
    confidence = Math.max(0, Math.min(100, confidence));
  }
  const rawHeader = isRecord(input.header) ? input.header : undefined;
  if (!rawHeader) errors.push("header must be an object");
  const header: PeopleDocHeader = rawHeader
    ? {
        agreementId: asString(rawHeader.agreementId),
        requestor: asString(rawHeader.requestor),
        agreementType: asString(rawHeader.agreementType),
        agreementSubType: asString(rawHeader.agreementSubType),
        businessFunction: asString(rawHeader.businessFunction),
        resmedEntity: asString(rawHeader.resmedEntity),
        startDate: asString(rawHeader.startDate),
        endDate: asString(rawHeader.endDate),
        autoRenew: asBoolean(rawHeader.autoRenew, "header.autoRenew", errors),
        perpetual: asBoolean(rawHeader.perpetual, "header.perpetual", errors),
      }
    : {};
  const warnings = asStringList(input.warnings, "warnings", errors);
  const reviewReasons = asStringList(input.reviewReasons, "reviewReasons", errors);
  if (errors.length) {
    return { ok: false, error: errors.slice(0, 6).join("; ") };
  }
  return { ok: true, value: { confidence, header, warnings, reviewReasons } };
}
