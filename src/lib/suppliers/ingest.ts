import { getConfig } from "../config";
import { getStorageProvider, type StorageProvider } from "../storage";
import { loadSupplierExtractFiles } from "./extractFiles";
import { mapSupplierExtracts } from "./fromExtracts";
import { getSupplierRepository, type SupplierRepository } from "./repository";

export { DEFAULT_SUPPLIER_PREFIX, loadSupplierExtractFiles } from "./extractFiles";

export interface SupplierIngestResult {
  provider: string;
  prefix: string;
  files: { key: string; rows: number }[];
  suppliers: number;
  sites: number;
  errors: { key: string; error: string }[];
  usedSampleFallback: boolean;
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
  const loaded = await loadSupplierExtractFiles({ storage, prefix });
  const mapped = mapSupplierExtracts({
    profiles: loaded.profiles,
    sites: loaded.sites,
    addresses: loaded.addresses,
    vat: loaded.vat,
  });
  await repo.replaceWorkingCopy({
    suppliers: mapped.suppliers,
    sites: mapped.sites,
    files: loaded.files,
  });
  return {
    provider: loaded.provider,
    prefix: loaded.prefix,
    files: loaded.files,
    suppliers: mapped.suppliers.length,
    sites: mapped.sites.length,
    errors: loaded.errors,
    usedSampleFallback: loaded.usedSampleFallback,
  };
}
