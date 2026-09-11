import { promises as fs } from "fs";
import path from "path";

import { getConfig } from "../config";
import { parseCsv } from "../parse/csv";
import { getStorageProvider, type StorageProvider } from "../storage";
import { mapSupplierExtracts } from "./fromExtracts";
import { getSupplierRepository, type SupplierRepository } from "./repository";

export const DEFAULT_SUPPLIER_PREFIX = "supplier/";
const SAMPLE_DIR = path.join(process.cwd(), "data", "sample", "suppliers");

export interface SupplierIngestResult {
  provider: string;
  prefix: string;
  files: { key: string; rows: number }[];
  suppliers: number;
  sites: number;
  errors: { key: string; error: string }[];
  usedSampleFallback: boolean;
}

function fileName(key: string): string {
  return key.split("/").pop()?.toLowerCase() ?? "";
}

function pick(keys: string[], match: (name: string) => boolean): string | undefined {
  return keys.filter((k) => match(fileName(k))).at(-1);
}

async function loadCsv(storage: StorageProvider, key: string): Promise<Record<string, string>[]> {
  const buf = await storage.get(key);
  return parseCsv(buf.toString("utf8"));
}

async function listSampleKeys(): Promise<string[]> {
  try {
    const entries = await fs.readdir(SAMPLE_DIR);
    return entries.filter((n) => n.toLowerCase().endsWith(".csv")).map((n) => `sample/${n}`);
  } catch {
    return [];
  }
}

async function loadSampleCsv(key: string): Promise<Record<string, string>[]> {
  const name = key.replace(/^sample\//, "");
  const text = await fs.readFile(path.join(SAMPLE_DIR, name), "utf8");
  return parseCsv(text);
}

export async function ingestSuppliers(deps?: {
  storage?: StorageProvider;
  repo?: SupplierRepository;
  prefix?: string;
}): Promise<SupplierIngestResult> {
  const config = getConfig();
  const storage = deps?.storage ?? getStorageProvider();
  const repo = deps?.repo ?? getSupplierRepository();
  const prefix = deps?.prefix ?? config.supplierPrefix;
  const result: SupplierIngestResult = {
    provider: storage.name,
    prefix,
    files: [],
    suppliers: 0,
    sites: 0,
    errors: [],
    usedSampleFallback: false,
  };

  const objects = await storage.list(prefix);
  let keys = objects.filter((o) => o.key.toLowerCase().endsWith(".csv")).map((o) => o.key);
  let fromSample = false;
  if (keys.length === 0) {
    keys = await listSampleKeys();
    fromSample = keys.length > 0;
    result.usedSampleFallback = fromSample;
  }

  const profileKey = pick(keys, (n) => n.includes("supplier_profile"));
  const siteKey = pick(
    keys,
    (n) => n.includes("supplier_site") && !n.includes("assignment") && !n.includes("vat"),
  );
  const addressKey = pick(keys, (n) => n.includes("supplier_address") && !n.includes("contact"));
  const vatKey = pick(keys, (n) => n.includes("vatid") || n.includes("supplier_site_vat") || n.includes("suppliersitevat"));

  async function take(
    key: string | undefined,
  ): Promise<Record<string, string>[]> {
    if (!key) return [];
    try {
      const rows = fromSample ? await loadSampleCsv(key) : await loadCsv(storage, key);
      result.files.push({ key, rows: rows.length });
      return rows;
    } catch (err) {
      result.errors.push({
        key,
        error: err instanceof Error ? err.message : "failed to read",
      });
      return [];
    }
  }

  const [profiles, sites, addresses, vat] = await Promise.all([
    take(profileKey),
    take(siteKey),
    take(addressKey),
    take(vatKey),
  ]);

  const mapped = mapSupplierExtracts({ profiles, sites, addresses, vat });
  await repo.replaceWorkingCopy({
    suppliers: mapped.suppliers,
    sites: mapped.sites,
    files: result.files,
  });
  result.suppliers = mapped.suppliers.length;
  result.sites = mapped.sites.length;
  return result;
}
