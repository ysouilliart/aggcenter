import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { getConfig } from "../config";
import { parseInvoiceDocument, mimeForFile } from "../parse/invoice";
import { getStorageProvider, type StorageProvider } from "../storage";
import {
  contentTypeForName,
  DEFAULT_INVOICE_PREFIX,
  invoiceFolderKey,
  isInvoiceFileName,
  landingKey,
  withTrailingSlash,
} from "./folders";
import { folderForStatus, recordsFromInvoiceParse } from "./fromParse";
import { getInvoiceRepository, type InvoiceRepository } from "./repository";
import type { InvoiceFolder } from "../parse/invoice/types";
import type { InvoiceDetail, InvoiceRecord, InvoiceSource, InvoiceSummary } from "./types";

const SAMPLE_DIR = path.join(process.cwd(), "data/sample/invoices/landing");

export interface InvoiceIngestResult {
  provider: string;
  prefix: string;
  usedSampleFallback: boolean;
  ingested: { key: string; invoiceId: string; folder: InvoiceFolder; status: string }[];
  skipped: { key: string; reason: string }[];
  errors: { key: string; error: string }[];
}

export interface InvoiceIngestDeps {
  storage: StorageProvider;
  repo: InvoiceRepository;
  prefix?: string;
  sampleDir?: string;
}

function invoiceIdFor(seed: string): string {
  return `INV-${createHash("sha1").update(seed).digest("hex").slice(0, 12)}`;
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
      // landing originals can stay if delete is unsupported
    }
  }
}

async function persistParse(options: {
  repo: InvoiceRepository;
  storage: StorageProvider;
  prefix: string;
  id: string;
  fileName: string;
  buf: Buffer;
  source: InvoiceSource;
  originalKey: string;
  receivedKey: string;
}): Promise<InvoiceRecord> {
  const parsed = await parseInvoiceDocument(options.buf, { fileName: options.fileName });
  const destFolder = folderForStatus(parsed.status);
  const destKey = invoiceFolderKey(options.prefix, destFolder, options.id, options.fileName);
  await options.storage.put(destKey, options.buf, contentTypeForName(options.fileName));
  if (options.receivedKey !== destKey) {
    try {
      await options.storage.delete(options.receivedKey);
    } catch {
      /* ignore */
    }
  }
  const bundle = recordsFromInvoiceParse({
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
    invoice: bundle.invoice,
    lineItems: parsed.lineItems,
    taxLines: parsed.taxLines,
    bank: parsed.bank,
    fields: parsed.fields,
    job: bundle.job,
  });
  return bundle.invoice;
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
    if (!isInvoiceFileName(name)) continue;
    const key = landingKey(prefix, name);
    const existing = await storage.list(key);
    if (existing.some((o) => o.key === key)) continue;
    const buf = await fs.readFile(path.join(sampleDir, name));
    await storage.put(key, buf, contentTypeForName(name));
    n += 1;
  }
  return n;
}

export async function ingestInvoices(deps?: InvoiceIngestDeps): Promise<InvoiceIngestResult> {
  const storage = deps?.storage ?? getStorageProvider();
  const repo = deps?.repo ?? getInvoiceRepository();
  const prefix = withTrailingSlash(deps?.prefix ?? getConfig().invoicePrefix ?? DEFAULT_INVOICE_PREFIX);
  const sampleDir = deps?.sampleDir ?? SAMPLE_DIR;
  const landingPrefix = `${prefix}landing/`;

  let objects = (await storage.list(landingPrefix)).filter((o) => isInvoiceFileName(o.key));
  let usedSampleFallback = false;
  if (objects.length === 0) {
    const seeded = await seedLandingFromSamples(storage, prefix, sampleDir);
    usedSampleFallback = seeded > 0;
    objects = (await storage.list(landingPrefix)).filter((o) => isInvoiceFileName(o.key));
  }

  const ingested: InvoiceIngestResult["ingested"] = [];
  const skipped: InvoiceIngestResult["skipped"] = [];
  const errors: InvoiceIngestResult["errors"] = [];

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
      const id = invoiceIdFor(object.key);
      const receivedKey = invoiceFolderKey(prefix, "received", id, fileName);
      await storage.put(receivedKey, buf, contentTypeForName(fileName));
      const invoice = await persistParse({
        repo,
        storage,
        prefix,
        id,
        fileName,
        buf,
        source: usedSampleFallback ? "sample" : storage.name === "oci" ? "oci" : "upload",
        originalKey: object.key,
        receivedKey,
      });
      ingested.push({
        key: object.key,
        invoiceId: invoice.id,
        folder: invoice.folder,
        status: invoice.parseStatus,
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

export async function uploadInvoice(input: {
  fileName: string;
  content: Buffer;
  storage?: StorageProvider;
  repo?: InvoiceRepository;
}): Promise<InvoiceRecord> {
  const storage = input.storage ?? getStorageProvider();
  const repo = input.repo ?? getInvoiceRepository();
  const prefix = withTrailingSlash(getConfig().invoicePrefix ?? DEFAULT_INVOICE_PREFIX);
  const hash = hashOf(input.content);
  const existing = await repo.findByHash(hash);
  if (existing) return existing;
  const originalKey = landingKey(prefix, input.fileName);
  await storage.put(originalKey, input.content, contentTypeForName(input.fileName));
  const id = invoiceIdFor(originalKey + hash);
  const receivedKey = invoiceFolderKey(prefix, "received", id, input.fileName);
  await storage.put(receivedKey, input.content, contentTypeForName(input.fileName));
  return persistParse({
    repo,
    storage,
    prefix,
    id,
    fileName: input.fileName,
    buf: input.content,
    source: "upload",
    originalKey,
    receivedKey,
  });
}

export async function listInvoices(filter?: {
  folder?: InvoiceFolder;
  parseStatus?: string;
}): Promise<InvoiceRecord[]> {
  return getInvoiceRepository().list(filter);
}

export async function getInvoiceSummary(): Promise<InvoiceSummary> {
  return getInvoiceRepository().summary();
}

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | undefined> {
  return getInvoiceRepository().get(id);
}

export async function archiveInvoice(id: string): Promise<InvoiceRecord | undefined> {
  const repo = getInvoiceRepository();
  const storage = getStorageProvider();
  const prefix = withTrailingSlash(getConfig().invoicePrefix ?? DEFAULT_INVOICE_PREFIX);
  const detail = await repo.get(id);
  if (!detail) return undefined;
  const dest = invoiceFolderKey(prefix, "archived", id, detail.invoice.fileName);
  if (detail.invoice.storageKey && detail.invoice.storageKey !== dest) {
    const buf = await storage.get(detail.invoice.storageKey);
    await putCopy(storage, detail.invoice.storageKey, dest, buf, detail.invoice.fileName);
  }
  return repo.updateFolder(id, "archived", {
    storageKey: dest,
    archivedAt: new Date().toISOString(),
  });
}

export async function getInvoiceFile(id: string): Promise<{
  fileName: string;
  contentType: string;
  bytes: Buffer;
} | undefined> {
  const detail = await getInvoiceRepository().get(id);
  if (!detail?.invoice.storageKey) return undefined;
  const bytes = await getStorageProvider().get(detail.invoice.storageKey);
  return {
    fileName: detail.invoice.fileName,
    contentType: detail.invoice.mimeType || contentTypeForName(detail.invoice.fileName),
    bytes,
  };
}
