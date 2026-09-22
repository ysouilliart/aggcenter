import type { PeopleDocParseResult } from "../parse/peopleDocs";
import type { PeopleDocFolder } from "../parse/peopleDocs/types";
import type { PeopleDocParseJob, PeopleDocRecord, PeopleDocSource } from "./types";

export function recordsFromPeopleDocParse(options: {
  id: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  source: PeopleDocSource;
  folder: PeopleDocFolder;
  storageKey?: string;
  originalKey?: string;
  parsed: PeopleDocParseResult;
  uploadedAt?: string;
  startedAt?: string;
}): { doc: PeopleDocRecord; parsed: PeopleDocParseResult; job: PeopleDocParseJob } {
  const finishedAt = new Date().toISOString();
  const uploadedAt = options.uploadedAt ?? finishedAt;
  const header = options.parsed.header;
  const doc: PeopleDocRecord = {
    ...header,
    id: options.id,
    fileName: options.fileName,
    mimeType: options.mimeType,
    contentHash: options.contentHash,
    source: options.source,
    folder: options.folder,
    storageKey: options.storageKey,
    originalKey: options.originalKey,
    parseStatus: options.parsed.status,
    parserId: options.parsed.parserId,
    parserVersion: options.parsed.parserVersion,
    confidence: options.parsed.confidence,
    pageCount: options.parsed.pageCount,
    reviewReason: options.parsed.reviewReasons[0],
    extractedText: options.parsed.extractedText,
    synopsis: options.parsed.synopsis,
    llmModel: options.parsed.llmModel,
    classifyMode: options.parsed.classifyMode,
    classifierWarning: options.parsed.classifierWarning,
    needsConfirm: options.parsed.needsConfirm,
    uploadedAt,
    processedAt: finishedAt,
  };
  const job: PeopleDocParseJob = {
    id: `${options.id}-JOB`,
    docId: options.id,
    storageKey: options.storageKey,
    parserId: options.parsed.parserId,
    parserVersion: options.parsed.parserVersion,
    status: options.parsed.status,
    startedAt: options.startedAt ?? finishedAt,
    finishedAt,
    warningCount: options.parsed.warnings.length,
    pageCount: options.parsed.pageCount,
    confidence: options.parsed.confidence,
    events: options.parsed.trace,
  };
  return { doc, parsed: options.parsed, job };
}

export function folderForPeopleDocStatus(
  status: PeopleDocParseResult["status"],
  options?: { needsConfirm?: boolean },
): PeopleDocFolder {
  if (status === "anomaly" || status === "failed" || status === "partial") return "anomaly";
  if (options?.needsConfirm) return "anomaly";
  return "processed";
}
