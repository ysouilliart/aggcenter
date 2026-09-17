import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { getConfig } from "../config";
import { mimeForFile } from "../parse/invoice/extract";
import { parsePeopleDocument } from "../parse/peopleDocs";
import { getStorageProvider, type StorageProvider } from "../storage";
import {
  contentTypeForName,
  DEFAULT_PEOPLE_DOCS_PREFIX,
  isPeopleDocFileName,
  landingKey,
  peopleDocFolderKey,
  withTrailingSlash,
} from "./folders";
import { folderForPeopleDocStatus, recordsFromPeopleDocParse } from "./fromParse";
import { getPeopleDocRepository, type PeopleDocRepository } from "./repository";
import type { PeopleDocFolder } from "../parse/peopleDocs/types";
import type { PeopleDocRecord, PeopleDocSource, PeopleDocSummary } from "./types";

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
  storage: StorageProvider;
  repo: PeopleDocRepository;
  prefix?: string;
  sampleDir?: string;
  seedSamples?: boolean;
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
}): Promise<PeopleDocRecord> {
  const parsed = await parsePeopleDocument(options.buf, { fileName: options.fileName });
  const destFolder = folderForPeopleDocStatus(parsed.status, { needsConfirm: parsed.needsConfirm });
  const destKey = peopleDocFolderKey(options.prefix, destFolder, options.id, options.fileName);
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
        skipped.push({ key: object.key, reason: "duplicate content" });
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

export async function uploadPeopleDoc(input: {
  fileName: string;
  content: Buffer;
  storage?: StorageProvider;
  repo?: PeopleDocRepository;
}): Promise<PeopleDocRecord> {
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
  });
}

export async function listPeopleDocs(filter?: {
  folder?: PeopleDocFolder;
  parseStatus?: string;
}): Promise<PeopleDocRecord[]> {
  return getPeopleDocRepository().list(filter);
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
  const dest = peopleDocFolderKey(prefix, "archived", id, detail.doc.fileName);
  if (detail.doc.storageKey && detail.doc.storageKey !== dest) {
    const buf = await storage.get(detail.doc.storageKey);
    await putCopy(storage, detail.doc.storageKey, dest, buf, detail.doc.fileName);
  }
  return repo.updateFolder(id, "archived", {
    storageKey: dest,
    archivedAt: new Date().toISOString(),
  });
}

export async function reprocessPeopleDoc(
  id: string,
  deps?: { storage?: StorageProvider; repo?: PeopleDocRepository },
): Promise<PeopleDocRecord | undefined> {
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
