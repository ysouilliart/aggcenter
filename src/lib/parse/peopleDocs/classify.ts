/**
 * Deterministic people-document classify: labelled fields plus ResMed entity
 * and agreement-type heuristics. Scripting is the floor for the LLM overlay.
 */

import { firstDate, parseInvoiceDate } from "../invoice/dates";
import { searchText, uniquePush, valueAfterLabel } from "../invoice/text";
import type {
  PeopleDocField,
  PeopleDocHeader,
  PeopleDocParseResult,
  PeopleDocParseStatus,
  PeopleDocParseTraceEvent,
} from "./types";
import {
  PEOPLE_DOC_FIELD_DEFS,
  PEOPLE_DOC_PARSER_ID,
  PEOPLE_DOC_PARSER_VERSION,
  type PeopleDocFieldKey,
} from "./types";

export interface PeopleDocClassifyInput {
  fileName: string;
  lines: string[];
  fullText: string;
  pageCount: number;
  warnings?: string[];
}

const RESMED_ENTITIES = [
  "ResMed Pty Ltd",
  "ResMed Inc",
  "ResMed Ltd",
  "ResMed SAS",
  "ResMed GmbH",
  "ResMed KK",
  "ResMed Malaysia Sdn Bhd",
  "ResMed Singapore Pte Ltd",
];

const AGREEMENT_TYPES = [
  "Employment",
  "Contractor",
  "Consultancy",
  "NDA",
  "Non-Disclosure",
  "Policy",
  "Offer Letter",
  "Secondment",
  "Collective Agreement",
  "Confidentiality",
  "Internship",
  "Assignment",
];

function trace(
  events: PeopleDocParseTraceEvent[],
  level: PeopleDocParseTraceEvent["level"],
  stage: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  events.push({ seq: events.length + 1, level, stage, message, detail });
}

function labelled(text: string, labels: string, valueRe: RegExp): string | undefined {
  const re = new RegExp(`(?:${labels})[:\\s]+(${valueRe.source})`, "i");
  return searchText(text, re);
}

export function parseYesNo(value: string | undefined | null): boolean | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (/^(yes|true|y|1)\b/i.test(raw)) return true;
  if (/^(no|false|n|0)\b/i.test(raw)) return false;
  return undefined;
}

export function looksLikeAgreementId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 4 || compact.length > 40) return undefined;
  if (!/\d/.test(compact)) return undefined;
  if (/^(the|this|that|each|and|for|from|with|under|into)\b/i.test(compact)) return undefined;
  return compact;
}

function formatFlag(value: boolean | undefined): string | undefined {
  if (value == null) return undefined;
  return value ? "Yes" : "No";
}

function detectResmedEntity(text: string): string | undefined {
  const labelledEntity = labelled(
    text,
    "ResMed Entity|Resmed Entity|Contracting Entity|Legal Entity",
    /ResMed[A-Za-z .,&-]{2,60}/,
  );
  if (labelledEntity) {
    const known = RESMED_ENTITIES.find((name) =>
      labelledEntity.toLowerCase().includes(name.toLowerCase().replace(/^resmed\s+/i, "")),
    );
    return known ?? labelledEntity.replace(/\s+/g, " ").trim();
  }
  return RESMED_ENTITIES.find((name) => new RegExp(`\\b${name.replace(/[.]/g, "\\.")}\\b`, "i").test(text));
}

function detectAgreementType(text: string, fileName: string): string | undefined {
  const labelledType = labelled(
    text,
    "Agreement Type|Contract Type|Document Type",
    /[A-Za-z][A-Za-z /-]{2,40}/,
  );
  if (labelledType) {
    const known = AGREEMENT_TYPES.find((t) => labelledType.toLowerCase().includes(t.toLowerCase()));
    return known ?? labelledType.replace(/\s+/g, " ").trim();
  }
  const hay = `${fileName}\n${text}`.toLowerCase();
  const fromList = AGREEMENT_TYPES.find((t) => hay.includes(t.toLowerCase()));
  if (fromList) return fromList;
  if (/letter of offer|offer of employment/i.test(hay)) return "Offer Letter";
  return undefined;
}

export function fieldsFromHeader(header: PeopleDocHeader, conf: Partial<Record<PeopleDocFieldKey, number>> = {}): PeopleDocField[] {
  const valueOf = (key: PeopleDocFieldKey): string | undefined => {
    if (key === "autoRenew") return formatFlag(header.autoRenew);
    if (key === "perpetual") return formatFlag(header.perpetual);
    const raw = header[key];
    return typeof raw === "string" ? raw : undefined;
  };
  return PEOPLE_DOC_FIELD_DEFS.map((def) => {
    const value = valueOf(def.key);
    return {
      key: def.key,
      label: def.label,
      value,
      confidence: value ? (conf[def.key] ?? 80) : 0,
    };
  });
}

export function scorePeopleDoc(header: PeopleDocHeader): number {
  let n = 0;
  if (header.agreementId) n += 20;
  if (header.requestor) n += 10;
  if (header.agreementType) n += 15;
  if (header.agreementSubType) n += 8;
  if (header.businessFunction) n += 8;
  if (header.resmedEntity) n += 12;
  if (header.startDate) n += 10;
  if (header.endDate || header.perpetual) n += 10;
  if (header.autoRenew != null) n += 7;
  return Math.min(100, n);
}

export function statusForPeopleDoc(opts: {
  confidence: number;
  header: PeopleDocHeader;
  extractedEmpty: boolean;
  warnings: string[];
}): { status: PeopleDocParseStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (opts.extractedEmpty) {
    reasons.push("No extractable text — document may be scanned or image-only.");
    return { status: "anomaly", reasons };
  }
  if (!opts.header.agreementId) reasons.push("Agreement ID was not classified.");
  if (!opts.header.agreementType) reasons.push("Agreement type was not classified.");
  if (!opts.header.resmedEntity) reasons.push("ResMed entity was not classified.");
  if (!opts.header.startDate) reasons.push("Agreement start date was not classified.");
  if (opts.header.endDate == null && opts.header.perpetual !== true) {
    reasons.push("Agreement end date was not classified.");
  }
  if (opts.confidence < 40) reasons.push("Parse confidence is below the review threshold.");
  if (opts.warnings.length && opts.confidence < 70) uniquePush(reasons, opts.warnings[0]);
  if (reasons.length && (opts.confidence < 55 || !opts.header.agreementId)) {
    return { status: "anomaly", reasons };
  }
  if (reasons.length || opts.confidence < 80) return { status: "partial", reasons };
  return { status: "parsed", reasons };
}

export function needsPeopleDocConfirm(opts: {
  status: PeopleDocParseStatus;
  confidence: number;
  classifyMode: PeopleDocParseResult["classifyMode"];
}): boolean {
  if (opts.status === "anomaly" || opts.status === "failed" || opts.status === "partial") return true;
  return opts.classifyMode === "llm" && opts.confidence < 80;
}

export function classifyPeopleDoc(input: PeopleDocClassifyInput): PeopleDocParseResult {
  const events: PeopleDocParseTraceEvent[] = [];
  const warnings = [...(input.warnings ?? [])];
  const text = input.fullText;
  const lines = input.lines;

  const agreementId =
    labelled(text, "Agreement ID|Agreement Number|Agreement No\\.?|Contract Number|Document ID", /[A-Z0-9][A-Z0-9/._-]{3,30}/) ||
    valueAfterLabel(lines, /agreement\s+(id|number|no\.?)/i, /[A-Z0-9][A-Z0-9/._-]{3,30}/);

  const requestor =
    labelled(text, "Requestor|Requester|Requested by|Requested By", /[A-Za-z][A-Za-z .,'-]{2,60}/) ||
    valueAfterLabel(lines, /requestor|requester|requested by/i, /[A-Za-z][A-Za-z .,'-]{2,60}/);

  const agreementType = detectAgreementType(text, input.fileName);
  const agreementSubType =
    labelled(text, "Agreement Sub[- ]?type|Sub[- ]?type|Subtype", /[A-Za-z][A-Za-z0-9 /-]{2,60}/) ||
    valueAfterLabel(lines, /sub[- ]?type/i, /[A-Za-z][A-Za-z0-9 /-]{2,60}/);

  const businessFunction =
    labelled(text, "Business Function|Business Unit|Function", /[A-Za-z][A-Za-z0-9 &/-]{2,60}/) ||
    valueAfterLabel(lines, /business function|business unit/i, /[A-Za-z][A-Za-z0-9 &/-]{2,60}/);

  const resmedEntity = detectResmedEntity(text);

  const startRaw =
    labelled(text, "Agreement start date|Start date|Effective date|Commencement date", /[0-9A-Za-z/, -]{6,24}/) ||
    valueAfterLabel(lines, /start date|effective date|commencement/i, /[0-9A-Za-z/, -]{6,24}/);
  const endRaw =
    labelled(text, "Agreement end date|End date|Expiry date|Expiration date|Termination date", /[0-9A-Za-z/, -]{6,24}/) ||
    valueAfterLabel(lines, /end date|expiry date|expiration/i, /[0-9A-Za-z/, -]{6,24}/);

  const autoRenewRaw =
    labelled(text, "Auto[- ]?renew|Automatic renewal|Renews automatically", /Yes|No|True|False|Y|N/i) ||
    valueAfterLabel(lines, /auto[- ]?renew|automatic renewal/i, /Yes|No|True|False|Y|N/i);
  const perpetualRaw =
    labelled(text, "Perpetual(?: term)?", /Yes|No|True|False|Y|N/i) ||
    valueAfterLabel(lines, /perpetual/i, /Yes|No|True|False|Y|N/i);

  const header: PeopleDocHeader = {
    agreementId: looksLikeAgreementId(agreementId),
    requestor: requestor?.replace(/\s+/g, " ").trim(),
    agreementType: agreementType?.replace(/\s+/g, " ").trim(),
    agreementSubType: agreementSubType?.replace(/\s+/g, " ").trim(),
    businessFunction: businessFunction?.replace(/\s+/g, " ").trim(),
    resmedEntity: resmedEntity?.replace(/\s+/g, " ").trim(),
    startDate: parseInvoiceDate(startRaw) ?? firstDate(startRaw ?? "") ?? undefined,
    endDate: parseInvoiceDate(endRaw) ?? firstDate(endRaw ?? "") ?? undefined,
    autoRenew: parseYesNo(autoRenewRaw),
    perpetual: parseYesNo(perpetualRaw),
  };

  if (header.perpetual === true && !header.endDate) {
    // perpetual agreements do not need an end date
  } else if (
    !header.endDate &&
    header.perpetual == null &&
    /\bperpetual\b/i.test(text) &&
    !/\bnot\s+perpetual\b|\bnon-perpetual\b|perpetual:\s*no/i.test(text)
  ) {
    header.perpetual = true;
  }

  const empty = input.lines.length === 0 || !input.fullText.trim();
  const confidence = empty ? 0 : scorePeopleDoc(header);
  const { status, reasons } = statusForPeopleDoc({
    confidence,
    header,
    extractedEmpty: empty,
    warnings,
  });
  for (const reason of reasons) warnings.push(reason);
  trace(
    events,
    status === "anomaly" || status === "failed" ? "warn" : "info",
    "classify",
    `status=${status} confidence=${confidence}`,
    { agreementId: header.agreementId, agreementType: header.agreementType },
  );

  const classifyMode = "static" as const;
  return {
    parserId: PEOPLE_DOC_PARSER_ID,
    parserVersion: PEOPLE_DOC_PARSER_VERSION,
    status,
    confidence,
    header,
    fields: fieldsFromHeader(header, {
      agreementId: 92,
      requestor: 85,
      agreementType: 80,
      agreementSubType: 78,
      businessFunction: 78,
      resmedEntity: 88,
      startDate: 90,
      endDate: 88,
      autoRenew: 86,
      perpetual: 86,
    }),
    warnings: [...new Set(warnings)],
    reviewReasons: reasons,
    trace: events,
    pageCount: input.pageCount,
    extractedText: input.fullText,
    classifyMode,
    needsConfirm: needsPeopleDocConfirm({ status, confidence, classifyMode }),
  };
}
