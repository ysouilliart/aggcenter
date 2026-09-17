/**
 * Shared types for HR / people-document classify (agreements and policies).
 */

export const PEOPLE_DOC_PARSER_ID = "people-docs";
export const PEOPLE_DOC_PARSER_VERSION = "1.0.0";
export const PEOPLE_DOC_LLM_PARSER_ID = "people-docs-llm";
export const PEOPLE_DOC_LLM_PARSER_VERSION = "1.0.0";

export type PeopleDocParseStatus = "parsed" | "partial" | "anomaly" | "failed";
export type PeopleDocFolder = "landing" | "processed" | "archived" | "anomaly";
export type PeopleDocClassifyMode = "static" | "llm" | "static-fallback";

export interface PeopleDocHeader {
  agreementId?: string;
  requestor?: string;
  agreementType?: string;
  agreementSubType?: string;
  businessFunction?: string;
  resmedEntity?: string;
  startDate?: string;
  endDate?: string;
  autoRenew?: boolean;
  perpetual?: boolean;
}

export const PEOPLE_DOC_FIELD_DEFS = [
  { key: "agreementId", label: "Agreement ID/number" },
  { key: "requestor", label: "Requestor" },
  { key: "agreementType", label: "Agreement type" },
  { key: "agreementSubType", label: "Agreement Sub type" },
  { key: "businessFunction", label: "Business Function" },
  { key: "resmedEntity", label: "Resmed Entity" },
  { key: "startDate", label: "Agreement start date" },
  { key: "endDate", label: "Agreement end date" },
  { key: "autoRenew", label: "Auto renew" },
  { key: "perpetual", label: "Perpetual" },
] as const;

export type PeopleDocFieldKey = (typeof PEOPLE_DOC_FIELD_DEFS)[number]["key"];

export interface PeopleDocField {
  key: PeopleDocFieldKey;
  label: string;
  value?: string;
  confidence: number;
}

export interface PeopleDocParseTraceEvent {
  seq: number;
  level: "info" | "warn" | "error";
  stage: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface PeopleDocParseResult {
  parserId: string;
  parserVersion: string;
  status: PeopleDocParseStatus;
  confidence: number;
  header: PeopleDocHeader;
  fields: PeopleDocField[];
  warnings: string[];
  reviewReasons: string[];
  trace: PeopleDocParseTraceEvent[];
  pageCount: number;
  extractedText: string;
  classifyMode: PeopleDocClassifyMode;
  classifierWarning?: string;
  needsConfirm: boolean;
}
