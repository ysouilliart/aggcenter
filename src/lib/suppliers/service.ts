import { analyseSuppliers } from "./analyse";
import { ingestSuppliers } from "./ingest";
import { getSupplierRepository } from "./repository";
import type {
  SupplierIssueType,
  SupplierRecord,
  SupplierSummary,
  SupplierUpdateInput,
} from "./types";

export interface SupplierListQuery {
  q?: string;
  issue?: SupplierIssueType | "any";
  country?: string;
  paymentTerms?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface SupplierListResult {
  total: number;
  records: SupplierRecord[];
}

export async function getSupplierWorkspace(source?: string): Promise<{
  records: SupplierRecord[];
  summary: SupplierSummary;
}> {
  const repo = getSupplierRepository();
  const [allSuppliers, allSites, meta] = await Promise.all([
    repo.listSuppliers(),
    repo.listSites(),
    repo.meta(),
  ]);
  const sites = source ? allSites.filter((s) => s.source === source) : allSites;
  const supplierIds = new Set(sites.map((s) => s.supplierId));
  const suppliers = allSuppliers.filter((s) => supplierIds.has(s.id));
  const analysed = analyseSuppliers({ suppliers, sites });
  return {
    records: analysed.records,
    summary: {
      ...analysed.summary,
      files: meta.files,
      ingestedAt: meta.ingestedAt,
    },
  };
}

export async function listSupplierRecords(
  query: SupplierListQuery = {},
): Promise<SupplierListResult> {
  const { records } = await getSupplierWorkspace(query.source);
  const q = query.q?.trim().toLowerCase();
  const filtered = records.filter((r) => {
    if (query.issue === "any" && r.issues.length === 0) return false;
    if (query.issue && query.issue !== "any" && !r.issues.some((i) => i.type === query.issue)) {
      return false;
    }
    if (query.country && r.site.country !== query.country) return false;
    if (query.paymentTerms && r.site.paymentTerms !== query.paymentTerms) return false;
    if (query.source && r.site.source !== query.source && r.supplier.source !== query.source) {
      return false;
    }
    if (!q) return true;
    const hay = [
      r.supplier.name,
      r.supplier.supplierNumber,
      r.supplier.supplierVat,
      r.site.siteCode,
      r.site.siteVat,
      r.site.city,
      r.site.paymentTerms,
      r.site.payGroup,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(500, Math.max(1, query.limit ?? 100));
  return { total: filtered.length, records: filtered.slice(offset, offset + limit) };
}

export async function getSupplierRecord(id: string) {
  const repo = getSupplierRepository();
  const site = await repo.getSite(id);
  if (!site) return null;
  const supplier = await repo.getSupplier(site.supplierId);
  if (!supplier) return null;
  const { records } = analyseSuppliers({ suppliers: [supplier], sites: [site] });
  const [versions, audit] = await Promise.all([
    repo.listVersions("site", site.id),
    repo.listAudit(site.id),
  ]);
  const supplierVersions = await repo.listVersions("supplier", supplier.id);
  const supplierAudit = await repo.listAudit(supplier.id);
  return {
    record: records[0],
    versions: [...versions, ...supplierVersions].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    audit: [...audit, ...supplierAudit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function updateSupplierRecord(id: string, input: SupplierUpdateInput) {
  const repo = getSupplierRepository();
  const updated = await repo.updateRecord(id, input);
  const { records } = analyseSuppliers({
    suppliers: [updated.supplier],
    sites: [updated.site],
  });
  return { record: records[0], audit: updated.audit };
}

export { ingestSuppliers };
