import type { PeopleDocField, PeopleDocFolder, PeopleDocHeader } from "../parse/peopleDocs/types";
import { getPeopleDocRepository, type PeopleDocRepository } from "./repository";
import type {
  PeopleDocDetail,
  PeopleDocRecord,
  PeopleDocSearchExport,
  PeopleDocSearchMatch,
} from "./types";

export const PEOPLE_DOC_SEARCH_TEXT_EXCERPT_MAX = 2_000;

export interface PeopleDocSearchFilter {
  folder?: PeopleDocFolder;
  parseStatus?: string;
  q?: string;
}

function flagSearchTokens(value: boolean | undefined): string {
  if (value == null) return "";
  return value ? "yes true" : "no false";
}

/** Haystack for keyword search: metadata, header fields, and extracted text. */
export function peopleDocSearchHaystack(doc: PeopleDocRecord, fields?: PeopleDocField[]): string {
  const fieldValues = (fields ?? []).flatMap((f) => [f.key, f.label, f.value]);
  return [
    doc.id,
    doc.fileName,
    doc.folder,
    doc.parseStatus,
    doc.source,
    doc.mimeType,
    doc.parserId,
    doc.classifyMode,
    doc.reviewReason,
    doc.agreementId,
    doc.requestor,
    doc.agreementType,
    doc.agreementSubType,
    doc.businessFunction,
    doc.resmedEntity,
    doc.startDate,
    doc.endDate,
    flagSearchTokens(doc.autoRenew),
    flagSearchTokens(doc.perpetual),
    doc.extractedText,
    ...fieldValues,
  ]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join("\n")
    .toLowerCase();
}

export function normalizePeopleDocKeyword(q?: string): string {
  return (q ?? "").trim();
}

export function peopleDocMatchesKeyword(
  doc: PeopleDocRecord,
  q?: string,
  fields?: PeopleDocField[],
): boolean {
  const keyword = normalizePeopleDocKeyword(q).toLowerCase();
  if (!keyword) return true;
  return peopleDocSearchHaystack(doc, fields).includes(keyword);
}

export function filterPeopleDocsByKeyword(
  docs: PeopleDocRecord[],
  q?: string,
  fieldsById?: Record<string, PeopleDocField[]>,
): PeopleDocRecord[] {
  const keyword = normalizePeopleDocKeyword(q);
  if (!keyword) return docs;
  return docs.filter((doc) => peopleDocMatchesKeyword(doc, keyword, fieldsById?.[doc.id]));
}

export function peopleDocSearchFileName(keyword: string, exportedAt: string): string {
  const day = exportedAt.slice(0, 10) || "export";
  const slug = keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `people-docs-${slug}-${day}.json` : `people-docs-search-${day}.json`;
}

function headerFromRecord(doc: PeopleDocRecord): PeopleDocHeader {
  return {
    agreementId: doc.agreementId,
    requestor: doc.requestor,
    agreementType: doc.agreementType,
    agreementSubType: doc.agreementSubType,
    businessFunction: doc.businessFunction,
    resmedEntity: doc.resmedEntity,
    startDate: doc.startDate,
    endDate: doc.endDate,
    autoRenew: doc.autoRenew,
    perpetual: doc.perpetual,
  };
}

function textExcerpt(text: string | undefined, keyword: string): string | undefined {
  if (!text?.trim()) return undefined;
  const trimmed = text.trim();
  const needle = keyword.toLowerCase();
  if (!needle) {
    return trimmed.length > PEOPLE_DOC_SEARCH_TEXT_EXCERPT_MAX
      ? `${trimmed.slice(0, PEOPLE_DOC_SEARCH_TEXT_EXCERPT_MAX)}…`
      : trimmed;
  }
  const idx = trimmed.toLowerCase().indexOf(needle);
  if (idx < 0) {
    return trimmed.length > PEOPLE_DOC_SEARCH_TEXT_EXCERPT_MAX
      ? `${trimmed.slice(0, PEOPLE_DOC_SEARCH_TEXT_EXCERPT_MAX)}…`
      : trimmed;
  }
  const pad = 80;
  const start = Math.max(0, idx - pad);
  const end = Math.min(trimmed.length, idx + keyword.length + 400);
  const snippet = `${start > 0 ? "…" : ""}${trimmed.slice(start, end)}${end < trimmed.length ? "…" : ""}`;
  return snippet.length > PEOPLE_DOC_SEARCH_TEXT_EXCERPT_MAX
    ? `${snippet.slice(0, PEOPLE_DOC_SEARCH_TEXT_EXCERPT_MAX)}…`
    : snippet;
}

export function toPeopleDocSearchMatch(
  detail: PeopleDocDetail,
  keyword = "",
): PeopleDocSearchMatch {
  const { doc, fields } = detail;
  return {
    id: doc.id,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    source: doc.source,
    folder: doc.folder,
    parseStatus: doc.parseStatus,
    parserId: doc.parserId,
    parserVersion: doc.parserVersion,
    confidence: doc.confidence,
    pageCount: doc.pageCount,
    classifyMode: doc.classifyMode,
    needsConfirm: doc.needsConfirm,
    reviewReason: doc.reviewReason,
    uploadedAt: doc.uploadedAt,
    processedAt: doc.processedAt,
    archivedAt: doc.archivedAt,
    header: headerFromRecord(doc),
    fields: fields.map((f) => ({
      key: f.key,
      label: f.label,
      value: f.value,
      confidence: f.confidence,
    })),
    textExcerpt: textExcerpt(doc.extractedText, keyword),
  };
}

export async function searchPeopleDocs(
  filter?: PeopleDocSearchFilter,
  deps?: { repo?: PeopleDocRepository },
): Promise<PeopleDocRecord[]> {
  const repo = deps?.repo ?? getPeopleDocRepository();
  const docs = await repo.list({
    folder: filter?.folder,
    parseStatus: filter?.parseStatus,
  });
  return filterPeopleDocsByKeyword(docs, filter?.q);
}

export async function exportPeopleDocsKeywordSearch(
  filter?: PeopleDocSearchFilter,
  deps?: { repo?: PeopleDocRepository; now?: Date },
): Promise<PeopleDocSearchExport> {
  const repo = deps?.repo ?? getPeopleDocRepository();
  const keyword = normalizePeopleDocKeyword(filter?.q);
  const docs = await searchPeopleDocs(filter, { repo });
  const matches: PeopleDocSearchMatch[] = [];
  for (const doc of docs) {
    const detail = (await repo.get(doc.id)) ?? { doc, fields: [], job: null };
    matches.push(toPeopleDocSearchMatch(detail, keyword));
  }
  return {
    keyword,
    exportedAt: (deps?.now ?? new Date()).toISOString(),
    matchCount: matches.length,
    docs: matches,
  };
}
