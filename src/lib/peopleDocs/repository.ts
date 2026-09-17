import { promises as fs } from "fs";
import path from "path";

import { eq } from "drizzle-orm";

import { isDatabaseConfigured } from "../db/client";
import type { PeopleDocField } from "../parse/peopleDocs/types";
import type { PeopleDocFolder } from "../parse/peopleDocs/types";
import type { PeopleDocDetail, PeopleDocParseJob, PeopleDocRecord, PeopleDocSummary } from "./types";
import { PEOPLE_DOC_FOLDERS } from "./types";

export interface PeopleDocSnapshot {
  docs: PeopleDocRecord[];
  fields: Record<string, PeopleDocField[]>;
  jobs: Record<string, PeopleDocParseJob>;
}

export interface PeopleDocRepository {
  readonly name: string;
  saveParsed(input: {
    doc: PeopleDocRecord;
    fields: PeopleDocField[];
    job: PeopleDocParseJob;
  }): Promise<void>;
  list(filter?: { folder?: PeopleDocFolder; parseStatus?: string }): Promise<PeopleDocRecord[]>;
  get(id: string): Promise<PeopleDocDetail | undefined>;
  findByHash(hash: string): Promise<PeopleDocRecord | undefined>;
  findByOriginalKey(key: string): Promise<PeopleDocRecord | undefined>;
  updateFolder(
    id: string,
    folder: PeopleDocFolder,
    patch?: Partial<Pick<PeopleDocRecord, "storageKey" | "archivedAt" | "parseStatus">>,
  ): Promise<PeopleDocRecord | undefined>;
  summary(): Promise<PeopleDocSummary>;
}

function empty(): PeopleDocSnapshot {
  return { docs: [], fields: {}, jobs: {} };
}

function toSummary(rows: PeopleDocRecord[]): PeopleDocSummary {
  const byFolder = Object.fromEntries(PEOPLE_DOC_FOLDERS.map((f) => [f, 0])) as Record<
    PeopleDocFolder,
    number
  >;
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    byFolder[row.folder] = (byFolder[row.folder] ?? 0) + 1;
    byStatus[row.parseStatus] = (byStatus[row.parseStatus] ?? 0) + 1;
  }
  return {
    total: rows.length,
    byFolder,
    byStatus,
    needsReview: byFolder.anomaly,
    parsed: (byStatus.parsed ?? 0) + (byStatus.partial ?? 0),
  };
}

export class LocalJsonPeopleDocRepository implements PeopleDocRepository {
  readonly name = "local-json";
  constructor(private readonly file = path.join(process.cwd(), ".data", "people-docs.json")) {}

  private async read(): Promise<PeopleDocSnapshot> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<PeopleDocSnapshot>;
      return { ...empty(), ...parsed };
    } catch {
      return empty();
    }
  }

  private async write(snap: PeopleDocSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(snap, null, 2), "utf8");
  }

  async saveParsed(input: {
    doc: PeopleDocRecord;
    fields: PeopleDocField[];
    job: PeopleDocParseJob;
  }): Promise<void> {
    const snap = await this.read();
    snap.docs = snap.docs.filter((r) => r.id !== input.doc.id);
    snap.docs.unshift(input.doc);
    snap.fields[input.doc.id] = input.fields;
    snap.jobs[input.doc.id] = input.job;
    await this.write(snap);
  }

  async list(filter?: { folder?: PeopleDocFolder; parseStatus?: string }) {
    let rows = (await this.read()).docs;
    if (filter?.folder) rows = rows.filter((r) => r.folder === filter.folder);
    if (filter?.parseStatus) rows = rows.filter((r) => r.parseStatus === filter.parseStatus);
    return rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async get(id: string) {
    const snap = await this.read();
    const doc = snap.docs.find((r) => r.id === id);
    if (!doc) return undefined;
    return { doc, fields: snap.fields[id] ?? [], job: snap.jobs[id] ?? null };
  }

  async findByHash(hash: string) {
    return (await this.read()).docs.find((r) => r.contentHash === hash);
  }

  async findByOriginalKey(key: string) {
    return (await this.read()).docs.find((r) => r.originalKey === key);
  }

  async updateFolder(
    id: string,
    folder: PeopleDocFolder,
    patch?: Partial<Pick<PeopleDocRecord, "storageKey" | "archivedAt" | "parseStatus">>,
  ) {
    const snap = await this.read();
    const doc = snap.docs.find((r) => r.id === id);
    if (!doc) return undefined;
    doc.folder = folder;
    if (patch?.storageKey) doc.storageKey = patch.storageKey;
    if (patch?.archivedAt) doc.archivedAt = patch.archivedAt;
    if (patch?.parseStatus) doc.parseStatus = patch.parseStatus;
    await this.write(snap);
    return doc;
  }

  async summary() {
    return toSummary((await this.read()).docs);
  }
}

function rowToRecord(row: {
  id: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  source: string;
  folder: string;
  storageKey: string | null;
  originalKey: string | null;
  parseStatus: string;
  parserId: string | null;
  parserVersion: string | null;
  confidence: number;
  pageCount: number | null;
  reviewReason: string | null;
  extractedText: string | null;
  classifyMode: string | null;
  classifierWarning: string | null;
  needsConfirm: boolean;
  uploadedAt: string;
  processedAt: string | null;
  archivedAt: string | null;
  agreementId: string | null;
  requestor: string | null;
  agreementType: string | null;
  agreementSubType: string | null;
  businessFunction: string | null;
  resmedEntity: string | null;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean | null;
  perpetual: boolean | null;
}): PeopleDocRecord {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    contentHash: row.contentHash,
    source: row.source as PeopleDocRecord["source"],
    folder: row.folder as PeopleDocFolder,
    storageKey: row.storageKey ?? undefined,
    originalKey: row.originalKey ?? undefined,
    parseStatus: row.parseStatus as PeopleDocRecord["parseStatus"],
    parserId: row.parserId ?? undefined,
    parserVersion: row.parserVersion ?? undefined,
    confidence: row.confidence,
    pageCount: row.pageCount ?? undefined,
    reviewReason: row.reviewReason ?? undefined,
    extractedText: row.extractedText ?? undefined,
    classifyMode: (row.classifyMode as PeopleDocRecord["classifyMode"]) ?? undefined,
    classifierWarning: row.classifierWarning ?? undefined,
    needsConfirm: row.needsConfirm,
    uploadedAt: row.uploadedAt,
    processedAt: row.processedAt ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    agreementId: row.agreementId ?? undefined,
    requestor: row.requestor ?? undefined,
    agreementType: row.agreementType ?? undefined,
    agreementSubType: row.agreementSubType ?? undefined,
    businessFunction: row.businessFunction ?? undefined,
    resmedEntity: row.resmedEntity ?? undefined,
    startDate: row.startDate ?? undefined,
    endDate: row.endDate ?? undefined,
    autoRenew: row.autoRenew ?? undefined,
    perpetual: row.perpetual ?? undefined,
  };
}

export class PostgresPeopleDocRepository implements PeopleDocRepository {
  readonly name = "postgres";

  async saveParsed(input: {
    doc: PeopleDocRecord;
    fields: PeopleDocField[];
    job: PeopleDocParseJob;
  }): Promise<void> {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const doc = input.doc;
    await db.transaction(async (tx) => {
      await tx.delete(schema.peopleDocs).where(eq(schema.peopleDocs.id, doc.id));
      await tx.insert(schema.peopleDocs).values({
        id: doc.id,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        contentHash: doc.contentHash,
        source: doc.source,
        folder: doc.folder,
        storageKey: doc.storageKey ?? null,
        originalKey: doc.originalKey ?? null,
        parseStatus: doc.parseStatus,
        parserId: doc.parserId ?? null,
        parserVersion: doc.parserVersion ?? null,
        confidence: doc.confidence,
        pageCount: doc.pageCount ?? null,
        reviewReason: doc.reviewReason ?? null,
        extractedText: doc.extractedText ?? null,
        classifyMode: doc.classifyMode ?? null,
        classifierWarning: doc.classifierWarning ?? null,
        needsConfirm: Boolean(doc.needsConfirm),
        uploadedAt: doc.uploadedAt,
        processedAt: doc.processedAt ?? null,
        archivedAt: doc.archivedAt ?? null,
        agreementId: doc.agreementId ?? null,
        requestor: doc.requestor ?? null,
        agreementType: doc.agreementType ?? null,
        agreementSubType: doc.agreementSubType ?? null,
        businessFunction: doc.businessFunction ?? null,
        resmedEntity: doc.resmedEntity ?? null,
        startDate: doc.startDate ?? null,
        endDate: doc.endDate ?? null,
        autoRenew: doc.autoRenew ?? null,
        perpetual: doc.perpetual ?? null,
        fieldsJson: JSON.stringify(input.fields),
        jobJson: JSON.stringify(input.job),
      });
    });
  }

  async list(filter?: { folder?: PeopleDocFolder; parseStatus?: string }) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const rows = await db.select().from(schema.peopleDocs);
    let docs = rows.map(rowToRecord);
    if (filter?.folder) docs = docs.filter((r) => r.folder === filter.folder);
    if (filter?.parseStatus) docs = docs.filter((r) => r.parseStatus === filter.parseStatus);
    return docs.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async get(id: string) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const rows = await db.select().from(schema.peopleDocs).where(eq(schema.peopleDocs.id, id));
    const row = rows[0];
    if (!row) return undefined;
    let fields: PeopleDocField[] = [];
    let job: PeopleDocParseJob | null = null;
    try {
      fields = row.fieldsJson ? (JSON.parse(row.fieldsJson) as PeopleDocField[]) : [];
    } catch {
      fields = [];
    }
    try {
      job = row.jobJson ? (JSON.parse(row.jobJson) as PeopleDocParseJob) : null;
    } catch {
      job = null;
    }
    return { doc: rowToRecord(row), fields, job };
  }

  async findByHash(hash: string) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const rows = await db.select().from(schema.peopleDocs).where(eq(schema.peopleDocs.contentHash, hash));
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }

  async findByOriginalKey(key: string) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const rows = await db.select().from(schema.peopleDocs).where(eq(schema.peopleDocs.originalKey, key));
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }

  async updateFolder(
    id: string,
    folder: PeopleDocFolder,
    patch?: Partial<Pick<PeopleDocRecord, "storageKey" | "archivedAt" | "parseStatus">>,
  ) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    await db
      .update(schema.peopleDocs)
      .set({
        folder,
        ...(patch?.storageKey != null ? { storageKey: patch.storageKey } : {}),
        ...(patch?.archivedAt != null ? { archivedAt: patch.archivedAt } : {}),
        ...(patch?.parseStatus != null ? { parseStatus: patch.parseStatus } : {}),
      })
      .where(eq(schema.peopleDocs.id, id));
    const detail = await this.get(id);
    return detail?.doc;
  }

  async summary() {
    return toSummary(await this.list());
  }
}

let cached: PeopleDocRepository | null = null;

export function resetPeopleDocRepositoryCache(): void {
  cached = null;
}

export function getPeopleDocRepository(): PeopleDocRepository {
  if (cached) return cached;
  cached = isDatabaseConfigured()
    ? new PostgresPeopleDocRepository()
    : new LocalJsonPeopleDocRepository();
  return cached;
}
