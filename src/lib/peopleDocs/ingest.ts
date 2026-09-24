import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { getConfig } from "../config";
import { mimeForFile } from "../parse/invoice/extract";
import { parsePeopleDocument } from "../parse/peopleDocs";
import { selectPeopleDocModelForParse } from "../parse/peopleDocs/models";
import { getStorageProvider, type StorageProvider } from "../storage";
import {
  contentTypeForName,
  DEFAULT_PEOPLE_DOCS_PREFIX,
  isPeopleDocFileName,
  isPeopleDocProcessDay,
  landingKey,
  peopleDocFolderKey,
  withTrailingSlash,
} from "./folders";
import { folderForPeopleDocStatus, recordsFromPeopleDocParse } from "./fromParse";
import { getPeopleDocRepository, type PeopleDocRepository } from "./repository";
import { searchPeopleDocs } from "./search";
import type { PeopleDocFolder } from "../parse/peopleDocs/types";
import {
  PEOPLE_DOC_FOLDERS,
  type PeopleDocLandingFile,
  type PeopleDocLandingList,
  type PeopleDocRecord,
  type PeopleDocSource,
  type PeopleDocSummary,
} from "./types";

export class PeopleDocLandingError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PeopleDocLandingError";
    this.status = status;
  }
}

const SAMPLE_DIR = path.join(process.cwd(), "data/sample/people-docs/landing");

export interface PeopleDocIngestResult {
  provider: string;
  prefix: string;
  usedSampleFallback: boolean;
  ingested: { key: string; docId: string; folder: PeopleDocFolder; status: string }[];
  skipped: { key: string; reason: string }[];
  errors: { key: string; error: string }[];
}

export interface PeopleDocIngestDeps {
  storage?: StorageProvider;
  repo?: PeopleDocRepository;
  prefix?: string;
  sampleDir?: string;
  seedSamples?: boolean;
  /** Chat model for this ingest. Omit to use the UI selection or env default. */
  model?: string;
}

function docIdFor(seed: string): string {
  return `PD-${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`;
}

function hashOf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function fileNameOf(key: string): string {
  return key.split("/").filter(Boolean).pop() ?? key;
}

async function putCopy(
  storage: StorageProvider,
  fromKey: string,
  toKey: string,
  buf: Buffer,
  fileName: string,
): Promise<void> {
  await storage.put(toKey, buf, contentTypeForName(fileName));
  if (fromKey !== toKey) {
    try {
      await storage.delete(fromKey);
    } catch {
      /* landing originals can stay if delete is unsupported */
    }
  }
}

const DAY_FOLDERS: PeopleDocFolder[] = PEOPLE_DOC_FOLDERS.filter((folder) => folder !== "landing");

async function resolvePeopleDocStorageKey(options: {
  repo: PeopleDocRepository;
  prefix: string;
  folder: PeopleDocFolder;
  id: string;
  fileName: string;
  processedOn: string;
}): Promise<string> {
  const primary = peopleDocFolderKey(
    options.prefix,
    options.folder,
    options.fileName,
    options.processedOn,
  );
  if (options.folder === "landing") return primary;
  const docs = await options.repo.list();
  const clash = docs.some((doc) => doc.storageKey === primary && doc.id !== options.id);
  if (!clash) return primary;
  return peopleDocFolderKey(
    options.prefix,
    options.folder,
    options.fileName,
    options.processedOn,
    options.id,
  );
}

async function persistParse(options: {
  repo: PeopleDocRepository;
  storage: StorageProvider;
  prefix: string;
  id: string;
  fileName: string;
  buf: Buffer;
  source: PeopleDocSource;
  originalKey: string;
  currentKey: string;
  model: string;
}): Promise<PeopleDocRecord> {
  const parsed = await parsePeopleDocument(options.buf, {
    fileName: options.fileName,
    model: options.model,
  });
  const destFolder = folderForPeopleDocStatus(parsed.status, { needsConfirm: parsed.needsConfirm });
  const processedAt = new Date().toISOString();
  const destKey = await resolvePeopleDocStorageKey({
    repo: options.repo,
    prefix: options.prefix,
    folder: destFolder,
    id: options.id,
    fileName: options.fileName,
    processedOn: processedAt,
  });
  await options.storage.put(destKey, options.buf, contentTypeForName(options.fileName));
  if (options.currentKey !== destKey) {
    try {
      await options.storage.delete(options.currentKey);
    } catch {
      /* ignore */
    }
  }
  const bundle = recordsFromPeopleDocParse({
    id: options.id,
    fileName: options.fileName,
    mimeType: mimeForFile(options.fileName),
    contentHash: hashOf(options.buf),
    source: options.source,
    folder: destFolder,
    storageKey: destKey,
    originalKey: options.originalKey,
    parsed,
    processedAt,
  });
  await options.repo.saveParsed({
    doc: bundle.doc,
    fields: parsed.fields,
    job: bundle.job,
  });
  return bundle.doc;
}

async function seedLandingFromSamples(
  storage: StorageProvider,
  prefix: string,
  sampleDir: string,
): Promise<number> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(sampleDir);
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of entries) {
    if (!isPeopleDocFileName(name)) continue;
    const key = landingKey(prefix, name);
    const existing = await storage.list(key);
    if (existing.some((o) => o.key === key)) continue;
    const buf = await fs.readFile(path.join(sampleDir, name));
    await storage.put(key, buf, contentTypeForName(name));
    n += 1;
  }
  return n;
}

export async function ingestPeopleDocs(deps?: PeopleDocIngestDeps): Promise<PeopleDocIngestResult> {
  const model = selectPeopleDocModelForParse(deps?.model);
  const storage = deps?.storage ?? getStorageProvider();
  const repo = deps?.repo ?? getPeopleDocRepository();
  const prefix = withTrailingSlash(deps?.prefix ?? getConfig().peopleDocsPrefix ?? DEFAULT_PEOPLE_DOCS_PREFIX);
  const sampleDir = deps?.sampleDir ?? SAMPLE_DIR;
  const landingPrefix = `${prefix}landing/`;

  let objects = (await storage.list(landingPrefix)).filter((o) => isPeopleDocFileName(o.key));
  let usedSampleFallback = false;
  const seedSamples = deps?.seedSamples ?? getConfig().peopleDocsSeedSamples;
  if (objects.length === 0 && seedSamples) {
    const seeded = await seedLandingFromSamples(storage, prefix, sampleDir);
    usedSampleFallback = seeded > 0;
    objects = (await storage.list(landingPrefix)).filter((o) => isPeopleDocFileName(o.key));
  }

  const ingested: PeopleDocIngestResult["ingested"] = [];
  const skipped: PeopleDocIngestResult["skipped"] = [];
  const errors: PeopleDocIngestResult["errors"] = [];

  for (const object of objects) {
    try {
      const existing = await repo.findByOriginalKey(object.key);
      if (existing) {
        skipped.push({ key: object.key, reason: "already ingested" });
        continue;
      }
      const buf = await storage.get(object.key);
      const hash = hashOf(buf);
      const hashed = await repo.findByHash(hash);
      if (hashed) {
        const doc = await fileDuplicateLandingObject({
          storage,
          repo,
          prefix,
          key: object.key,
          buf,
          existing: hashed,
        });
        ingested.push({
          key: object.key,
          docId: doc.id,
          folder: doc.folder,
          status: doc.parseStatus,
        });
        continue;
      }
      const fileName = fileNameOf(object.key);
      const id = docIdFor(object.key);
      const doc = await persistParse({
        repo,
        storage,
        prefix,
        id,
        fileName,
        buf,
        source: usedSampleFallback ? "sample" : storage.name === "oci" ? "oci" : "upload",
        originalKey: object.key,
        currentKey: object.key,
        model,
      });
      ingested.push({
        key: object.key,
        docId: doc.id,
        folder: doc.folder,
        status: doc.parseStatus,
      });
    } catch (err) {
      errors.push({
        key: object.key,
        error: err instanceof Error ? err.message : "Ingest failed",
      });
    }
  }

  return {
    provider: storage.name,
    prefix,
    usedSampleFallback,
    ingested,
    skipped,
    errors,
  };
}

function landingPrefixFor(prefix: string): string {
  return `${withTrailingSlash(prefix)}landing/`;
}

function assertLandingObjectKey(prefix: string, key: string): string {
  const landingPrefix = landingPrefixFor(prefix);
  const normalized = key.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || !normalized.startsWith(landingPrefix)) {
    throw new PeopleDocLandingError("Choose a file from the people-docs landing folder.");
  }
  if (!isPeopleDocFileName(normalized)) {
    throw new PeopleDocLandingError("That file type cannot be parsed as a people document.");
  }
  return normalized;
}

async function removeStaleLandingCopy(
  storage: StorageProvider,
  key: string,
  storageKey?: string,
): Promise<void> {
  if (!storageKey || storageKey === key) return;
  try {
    await storage.delete(key);
  } catch {
    /* landing originals can stay if delete is unsupported */
  }
}

export async function listPeopleDocLanding(deps?: {
  storage?: StorageProvider;
  repo?: PeopleDocRepository;
  prefix?: string;
}): Promise<PeopleDocLandingList> {
  const storage = deps?.storage ?? getStorageProvider();
  const repo = deps?.repo ?? getPeopleDocRepository();
  const prefix = withTrailingSlash(deps?.prefix ?? getConfig().peopleDocsPrefix ?? DEFAULT_PEOPLE_DOCS_PREFIX);
  const objects = (await storage.list(landingPrefixFor(prefix))).filter((object) =>
    isPeopleDocFileName(object.key),
  );
  const docs = await repo.list();
  const byOriginalKey = new Map(
    docs.flatMap((doc) => (doc.originalKey ? [[doc.originalKey, doc] as const] : [])),
  );

  const files: PeopleDocLandingFile[] = objects.map((object) => {
    const doc = byOriginalKey.get(object.key);
    const processed = Boolean(doc && doc.folder !== "landing");
    return {
      key: object.key,
      fileName: fileNameOf(object.key),
      size: object.size,
      lastModified: object.lastModified,
      processed,
      docId: doc?.id,
      folder: doc?.folder,
    };
  });
  files.sort(
    (a, b) => b.lastModified.localeCompare(a.lastModified) || a.fileName.localeCompare(b.fileName),
  );

  return { provider: storage.name, prefix, files };
}

/**
 * Same bytes as a document already parsed. Keep this landing name: copy the
 * file into that document's folder for today and add a list row. The previous
 * code deleted the landing object and returned the old row, so the new name
 * vanished from the bucket and from the list.
 */
async function fileDuplicateLandingObject(options: {
  storage: StorageProvider;
  repo: PeopleDocRepository;
  prefix: string;
  key: string;
  buf: Buffer;
  existing: PeopleDocRecord;
}): Promise<PeopleDocRecord> {
  const detail = await options.repo.get(options.existing.id);
  const fileName = fileNameOf(options.key);
  const processedAt = new Date().toISOString();
  const folder = DAY_FOLDERS.includes(options.existing.folder) ? options.existing.folder : "processed";
  const id = docIdFor(options.key);
  const destKey = await resolvePeopleDocStorageKey({
    repo: options.repo,
    prefix: options.prefix,
    folder,
    id,
    fileName,
    processedOn: processedAt,
  });
  await options.storage.put(destKey, options.buf, contentTypeForName(fileName));
  const existingJob = detail?.job;
  const doc: PeopleDocRecord = {
    ...options.existing,
    id,
    fileName,
    mimeType: options.existing.mimeType || contentTypeForName(fileName),
    contentHash: hashOf(options.buf),
    source: options.storage.name === "oci" ? "oci" : options.existing.source,
    folder,
    storageKey: destKey,
    originalKey: options.key,
    uploadedAt: processedAt,
    processedAt,
    archivedAt: folder === "archived" ? processedAt : undefined,
  };
  await options.repo.saveParsed({
    doc,
    fields: detail?.fields ?? [],
    job: {
      id: `${id}-JOB`,
      docId: id,
      storageKey: destKey,
      parserId: existingJob?.parserId ?? options.existing.parserId ?? "people-docs",
      parserVersion: existingJob?.parserVersion ?? options.existing.parserVersion ?? "1",
      status: options.existing.parseStatus,
      startedAt: processedAt,
      finishedAt: processedAt,
      warningCount: existingJob?.warningCount ?? 0,
      pageCount: existingJob?.pageCount ?? options.existing.pageCount ?? 1,
      confidence: options.existing.confidence,
      events: existingJob?.events ?? [],
    },
  });
  if (options.key !== destKey) {
    try {
      await options.storage.delete(options.key);
    } catch {
      /* landing copy can stay if delete is unsupported */
    }
  }
  return doc;
}

export async function ingestPeopleDocLandingFile(input: {
  key: string;
  model?: string;
  storage?: StorageProvider;
  repo?: PeopleDocRepository;
  prefix?: string;
}): Promise<{ doc: PeopleDocRecord; skipped?: string; duplicateOf?: string }> {
  const model = selectPeopleDocModelForParse(input.model);
  const storage = input.storage ?? getStorageProvider();
  const repo = input.repo ?? getPeopleDocRepository();
  const prefix = withTrailingSlash(input.prefix ?? getConfig().peopleDocsPrefix ?? DEFAULT_PEOPLE_DOCS_PREFIX);
  const key = assertLandingObjectKey(prefix, input.key);

  const existing = await repo.findByOriginalKey(key);
  if (existing) {
    await removeStaleLandingCopy(storage, key, existing.storageKey);
    return { doc: existing, skipped: "already ingested" };
  }

  let buf: Buffer;
  try {
    buf = await storage.get(key);
  } catch {
    throw new PeopleDocLandingError(
      "That landing file is no longer in the bucket. Refresh and try again.",
      404,
    );
  }

  const hashed = await repo.findByHash(hashOf(buf));
  if (hashed) {
    const doc = await fileDuplicateLandingObject({
      storage,
      repo,
      prefix,
      key,
      buf,
      existing: hashed,
    });
    return { doc, duplicateOf: hashed.id };
  }

  const fileName = fileNameOf(key);
  const doc = await persistParse({
    repo,
    storage,
    prefix,
    id: docIdFor(key),
    fileName,
    buf,
    source: storage.name === "oci" ? "oci" : "upload",
    originalKey: key,
    currentKey: key,
    model,
  });
  return { doc };
}

export async function uploadPeopleDoc(input: {
  fileName: string;
  content: Buffer;
  storage?: StorageProvider;
  repo?: PeopleDocRepository;
  model?: string;
}): Promise<PeopleDocRecord> {
  const model = selectPeopleDocModelForParse(input.model);
  const storage = input.storage ?? getStorageProvider();
  const repo = input.repo ?? getPeopleDocRepository();
  const prefix = withTrailingSlash(getConfig().peopleDocsPrefix ?? DEFAULT_PEOPLE_DOCS_PREFIX);
  const hash = hashOf(input.content);
  const existing = await repo.findByHash(hash);
  if (existing) return existing;
  const originalKey = landingKey(prefix, input.fileName);
  await storage.put(originalKey, input.content, contentTypeForName(input.fileName));
  const id = docIdFor(originalKey + hash);
  return persistParse({
    repo,
    storage,
    prefix,
    id,
    fileName: input.fileName,
    buf: input.content,
    source: "upload",
    originalKey,
    currentKey: originalKey,
    model,
  });
}

export async function listPeopleDocs(filter?: {
  folder?: PeopleDocFolder;
  parseStatus?: string;
  q?: string;
}): Promise<PeopleDocRecord[]> {
  return searchPeopleDocs(filter);
}

export async function getPeopleDocSummary(): Promise<PeopleDocSummary> {
  return getPeopleDocRepository().summary();
}

export async function getPeopleDocDetail(id: string) {
  return getPeopleDocRepository().get(id);
}

export async function archivePeopleDoc(id: string): Promise<PeopleDocRecord | undefined> {
  const repo = getPeopleDocRepository();
  const storage = getStorageProvider();
  const prefix = withTrailingSlash(getConfig().peopleDocsPrefix ?? DEFAULT_PEOPLE_DOCS_PREFIX);
  const detail = await repo.get(id);
  if (!detail) return undefined;
  const processedOn = detail.doc.processedAt ?? new Date().toISOString();
  const dest = await resolvePeopleDocStorageKey({
    repo,
    prefix,
    folder: "archived",
    id,
    fileName: detail.doc.fileName,
    processedOn,
  });
  if (detail.doc.storageKey && detail.doc.storageKey !== dest) {
    const buf = await storage.get(detail.doc.storageKey);
    await putCopy(storage, detail.doc.storageKey, dest, buf, detail.doc.fileName);
  }
  return repo.updateFolder(id, "archived", {
    storageKey: dest,
    archivedAt: new Date().toISOString(),
  });
}

export interface PeopleDocRegroupResult {
  moved: { from: string; to: string }[];
  skipped: { key: string; reason: string }[];
  errors: { key: string; error: string }[];
}

function folderOfRelative(parts: string[]): PeopleDocFolder | undefined {
  const folder = parts[0];
  return DAY_FOLDERS.find((candidate) => candidate === folder);
}

/**
 * Move processed, anomaly, and archived objects out of per-file subfolders
 * into `dd-mm-yyyy` folders. Landing is left as a flat drop zone.
 */
export async function regroupPeopleDocsByProcessDay(deps?: {
  storage?: StorageProvider;
  repo?: PeopleDocRepository;
  prefix?: string;
}): Promise<PeopleDocRegroupResult> {
  const storage = deps?.storage ?? getStorageProvider();
  const repo = deps?.repo ?? getPeopleDocRepository();
  const prefix = withTrailingSlash(deps?.prefix ?? getConfig().peopleDocsPrefix ?? DEFAULT_PEOPLE_DOCS_PREFIX);
  const docs = await repo.list();
  const byStorage = new Map(
    docs.flatMap((doc) => (doc.storageKey ? [[doc.storageKey, doc] as const] : [])),
  );
  const reserved = new Set<string>();
  const moved: PeopleDocRegroupResult["moved"] = [];
  const skipped: PeopleDocRegroupResult["skipped"] = [];
  const errors: PeopleDocRegroupResult["errors"] = [];
  const pending: { key: string; folder: PeopleDocFolder; lastModified: string }[] = [];

  for (const folder of DAY_FOLDERS) {
    const objects = await storage.list(`${prefix}${folder}/`);
    for (const object of objects) {
      const relative = object.key.startsWith(prefix) ? object.key.slice(prefix.length) : object.key;
      const parts = relative.split("/").filter(Boolean);
      const objectFolder = folderOfRelative(parts);
      if (!objectFolder) {
        skipped.push({ key: object.key, reason: "outside a people-doc folder" });
        continue;
      }
      const flatFile = parts.length === 2 && (object.size > 0 || isPeopleDocFileName(parts[1] ?? ""));
      const nestedFile = parts.length >= 3;
      if (!flatFile && !nestedFile) {
        skipped.push({ key: object.key, reason: "folder marker" });
        continue;
      }
      if (nestedFile && isPeopleDocProcessDay(parts[1] ?? "") && parts.length === 3) {
        reserved.add(object.key);
        skipped.push({ key: object.key, reason: "already grouped by process day" });
        continue;
      }
      pending.push({ key: object.key, folder: objectFolder, lastModified: object.lastModified });
    }
  }

  for (const object of pending) {
    const doc = byStorage.get(object.key);
    const relative = object.key.startsWith(prefix) ? object.key.slice(prefix.length) : object.key;
    const parts = relative.split("/").filter(Boolean);
    const fileName = doc?.fileName ?? parts[parts.length - 1] ?? "document";
    const processedOn = doc?.processedAt ?? object.lastModified;
    const folder = doc && DAY_FOLDERS.includes(doc.folder) ? doc.folder : object.folder;
    let dest = peopleDocFolderKey(prefix, folder, fileName, processedOn);
    if (reserved.has(dest) && dest !== object.key) {
      dest = peopleDocFolderKey(prefix, folder, fileName, processedOn, doc?.id ?? fileNameOf(object.key));
    }
    if (dest === object.key) {
      reserved.add(dest);
      skipped.push({ key: object.key, reason: "already in place" });
      continue;
    }
    try {
      const buf = await storage.get(object.key);
      await storage.put(dest, buf, contentTypeForName(fileName));
      if (doc) {
        await repo.updateFolder(doc.id, doc.folder, { storageKey: dest });
      }
      try {
        await storage.delete(object.key);
      } catch {
        /* new copy is already stored */
      }
      reserved.add(dest);
      byStorage.delete(object.key);
      moved.push({ from: object.key, to: dest });
    } catch (err) {
      errors.push({
        key: object.key,
        error: err instanceof Error ? err.message : "Could not move the file",
      });
    }
  }

  return { moved, skipped, errors };
}

export async function reprocessPeopleDoc(
  id: string,
  deps?: { storage?: StorageProvider; repo?: PeopleDocRepository; model?: string },
): Promise<PeopleDocRecord | undefined> {
  const model = selectPeopleDocModelForParse(deps?.model);
  const repo = deps?.repo ?? getPeopleDocRepository();
  const storage = deps?.storage ?? getStorageProvider();
  const prefix = withTrailingSlash(getConfig().peopleDocsPrefix ?? DEFAULT_PEOPLE_DOCS_PREFIX);
  const detail = await repo.get(id);
  if (!detail?.doc.storageKey) return undefined;
  const buf = await storage.get(detail.doc.storageKey);
  return persistParse({
    repo,
    storage,
    prefix,
    id,
    fileName: detail.doc.fileName,
    buf,
    source: detail.doc.source,
    originalKey: detail.doc.originalKey ?? detail.doc.storageKey,
    currentKey: detail.doc.storageKey,
    model,
  });
}

export async function getPeopleDocFile(id: string): Promise<{
  fileName: string;
  contentType: string;
  bytes: Buffer;
} | undefined> {
  const detail = await getPeopleDocRepository().get(id);
  if (!detail?.doc.storageKey) return undefined;
  const bytes = await getStorageProvider().get(detail.doc.storageKey);
  return {
    fileName: detail.doc.fileName,
    contentType: detail.doc.mimeType || contentTypeForName(detail.doc.fileName),
    bytes,
  };
}
