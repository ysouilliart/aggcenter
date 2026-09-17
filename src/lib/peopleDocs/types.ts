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

export const PEOPLE_DOC_FOLDERS: PeopleDocFolder[] = [
  "landing",
  "processed",
  "archived",
  "anomaly",
];
