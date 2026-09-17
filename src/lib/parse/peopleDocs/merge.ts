/**
 * Overlay LLM classify onto a static people-doc parse. Scripting is the floor.
 */

import { parseInvoiceDate } from "../invoice/dates";
import {
  fieldsFromHeader,
  looksLikeAgreementId,
  needsPeopleDocConfirm,
  scorePeopleDoc,
  statusForPeopleDoc,
} from "./classify";
import type { PeopleDocHeader, PeopleDocParseResult } from "./types";
import { PEOPLE_DOC_LLM_PARSER_ID, PEOPLE_DOC_LLM_PARSER_VERSION } from "./types";

type PeopleDocStringKey = Exclude<
  keyof PeopleDocHeader,
  "autoRenew" | "perpetual" | "startDate" | "endDate"
>;

const STRING_KEYS: PeopleDocStringKey[] = [
  "agreementId",
  "requestor",
  "agreementType",
  "agreementSubType",
  "businessFunction",
  "resmedEntity",
];

function isBlank(value: unknown): boolean {
  return value == null || value === "";
}

function stringAppearsInExtract(value: string, text: string): boolean {
  const needle = value.trim();
  if (needle.length < 2) return false;
  const hay = text.replace(/\s+/g, " ");
  if (hay.toLowerCase().includes(needle.toLowerCase())) return true;
  const compactHay = hay.replace(/[\s-]/g, "").toLowerCase();
  const compactNeedle = needle.replace(/[\s-]/g, "").toLowerCase();
  return compactNeedle.length >= 4 && compactHay.includes(compactNeedle);
}

function booleanSupported(flag: boolean, key: "autoRenew" | "perpetual", text: string): boolean {
  if (key === "autoRenew") {
    if (flag) return /auto[\s-]?renew|renews automatically|automatic renewal/i.test(text);
    return /auto[\s-]?renew|does not renew|no automatic renewal/i.test(text);
  }
  if (flag) return /perpetual|no end date|indefinite/i.test(text);
  return /perpetual:\s*no|not perpetual/i.test(text) || /end date|expiry/i.test(text);
}

export function mergeStaticAndLlmPeopleDoc(
  staticResult: PeopleDocParseResult,
  llmHeader: PeopleDocHeader,
  llmConfidence: number,
  llmWarnings: string[],
  llmReasons: string[],
  fullText: string,
): PeopleDocParseResult {
  const header: PeopleDocHeader = { ...staticResult.header };
  for (const key of STRING_KEYS) {
    if (isBlank(header[key]) && !isBlank(llmHeader[key])) {
      const value = String(llmHeader[key]);
      if (!stringAppearsInExtract(value, fullText)) continue;
      if (key === "agreementId") {
        const id = looksLikeAgreementId(value);
        if (id) header.agreementId = id;
        continue;
      }
      header[key] = value;
    }
  }
  if (!header.startDate && llmHeader.startDate) {
    header.startDate = parseInvoiceDate(llmHeader.startDate) ?? llmHeader.startDate;
  }
  if (!header.endDate && llmHeader.endDate) {
    header.endDate = parseInvoiceDate(llmHeader.endDate) ?? llmHeader.endDate;
  }
  if (header.autoRenew == null && llmHeader.autoRenew != null && booleanSupported(llmHeader.autoRenew, "autoRenew", fullText)) {
    header.autoRenew = llmHeader.autoRenew;
  }
  if (header.perpetual == null && llmHeader.perpetual != null && booleanSupported(llmHeader.perpetual, "perpetual", fullText)) {
    header.perpetual = llmHeader.perpetual;
  }

  const confidence = Math.min(100, Math.max(staticResult.confidence, llmConfidence, scorePeopleDoc(header)));
  const { status, reasons } = statusForPeopleDoc({
    confidence,
    header,
    extractedEmpty: false,
    warnings: [],
  });
  for (const extra of llmReasons) {
    if (!reasons.includes(extra)) reasons.push(extra);
  }
  const warnings = [...new Set([...staticResult.warnings, ...llmWarnings, ...reasons])];
  const classifyMode = "llm" as const;
  return {
    parserId: PEOPLE_DOC_LLM_PARSER_ID,
    parserVersion: PEOPLE_DOC_LLM_PARSER_VERSION,
    status,
    confidence,
    header,
    fields: fieldsFromHeader(header),
    warnings,
    reviewReasons: reasons,
    trace: [
      ...staticResult.trace,
      {
        seq: staticResult.trace.length + 1,
        level: "info",
        stage: "llm",
        message: `LLM overlay on static floor; status=${status} confidence=${confidence}`,
        detail: { agreementId: header.agreementId, agreementType: header.agreementType },
      },
    ],
    pageCount: staticResult.pageCount,
    extractedText: staticResult.extractedText,
    classifyMode,
    needsConfirm: needsPeopleDocConfirm({ status, confidence, classifyMode }),
  };
}
