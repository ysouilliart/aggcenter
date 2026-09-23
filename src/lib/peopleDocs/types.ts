import type {
  PeopleDocClassifyMode,
  PeopleDocField,
  PeopleDocFolder,
  PeopleDocHeader,
  PeopleDocParseStatus,
  PeopleDocParseTraceEvent,
} from "../parse/peopleDocs/types";

export type PeopleDocSource = "upload" | "oci" | "sample";

export interface PeopleDocParseJob {
  id: string;
  docId: string;
  storageKey?: string;
  parserId: string;
  parserVersion: string;
  status: PeopleDocParseStatus;
  startedAt: string;
  finishedAt: string;
  warningCount: number;
  pageCount: number;
  confidence: number;
  events: PeopleDocParseTraceEvent[];
}

export interface PeopleDocRecord extends PeopleDocHeader {
  id: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  source: PeopleDocSource;
  folder: PeopleDocFolder;
  storageKey?: string;
  originalKey?: string;
  parseStatus: PeopleDocParseStatus;
  parserId?: string;
  parserVersion?: string;
  confidence: number;
  pageCount?: number;
  reviewReason?: string;
  extractedText?: string;
  /** LLM-authored overview shown under matched parameters. */
  synopsis?: string;
  /** Model that parsed this document when classify ran. */
  llmModel?: string;
  classifyMode?: PeopleDocClassifyMode;
  classifierWarning?: string;
  needsConfirm?: boolean;
  uploadedAt: string;
  processedAt?: string;
  archivedAt?: string;
}

export interface PeopleDocDetail {
  doc: PeopleDocRecord;
  fields: PeopleDocField[];
  job: PeopleDocParseJob | null;
}

export interface PeopleDocSummary {
  total: number;
  byFolder: Record<PeopleDocFolder, number>;
  byStatus: Record<string, number>;
  needsReview: number;
  parsed: number;
}

/** Sanitized keyword-search hit for JSON download (no storage keys, hashes, or binary). */
export interface PeopleDocSearchMatch {
  id: string;
  fileName: string;
  mimeType: string;
  source: PeopleDocSource;
  folder: PeopleDocFolder;
  parseStatus: PeopleDocParseStatus;
  parserId?: string;
  parserVersion?: string;
  confidence: number;
  pageCount?: number;
  classifyMode?: PeopleDocClassifyMode;
  needsConfirm?: boolean;
  reviewReason?: string;
  uploadedAt: string;
  processedAt?: string;
  archivedAt?: string;
  header: PeopleDocHeader;
  fields: PeopleDocField[];
  textExcerpt?: string;
}

export interface PeopleDocSearchExport {
  keyword: string;
  exportedAt: string;
  matchCount: number;
  docs: PeopleDocSearchMatch[];
}

export const PEOPLE_DOC_FOLDERS: PeopleDocFolder[] = [
  "landing",
  "processed",
  "archived",
  "anomaly",
];

/** A file currently sitting in the people-docs landing prefix. */
export interface PeopleDocLandingFile {
  key: string;
  fileName: string;
  size: number;
  lastModified: string;
  /** True when a parsed record already exists and the file has left landing. */
  processed: boolean;
  docId?: string;
  folder?: PeopleDocFolder;
}

export interface PeopleDocLandingList {
  provider: string;
  prefix: string;
  files: PeopleDocLandingFile[];
}
