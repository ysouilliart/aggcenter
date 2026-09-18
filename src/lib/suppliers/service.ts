import { randomUUID } from "crypto";

import { analyseSuppliers } from "./analyse";
import { ingestSuppliers } from "./ingest";
import { getSupplierRepository } from "./repository";
import { buildReviewItems } from "./review";
import type {
  SupplierIssueType,
  SupplierRecord,
  SupplierReviewItem,
  SupplierSummary,
  SupplierUpdateInput,
  SupplierVatCheck,
  VatScope,
} from "./types";
import { checkVatWithVies, vatRequestForRecord, type ViesClientOptions } from "./vies";

export interface SupplierListQuery {
  q?: string;
  issue?: SupplierIssueType | "any";
  country?: string;
  paymentTerms?: string;
  source?: string;
  supplierId?: string;
  limit?: number;
  offset?: number;
}

export interface SupplierListResult {
  total: number;
  records: SupplierRecord[];
}

function siteListFilter(query: SupplierListQuery) {
  return {
    source: query.source,
    supplierId: query.supplierId,
    country: query.country,
    paymentTerms: query.paymentTerms,
    q: query.q,
  };
}

export function matchesSupplierListQuery(record: SupplierRecord, query: SupplierListQuery): boolean {
  if (query.issue === "any" && record.issues.length === 0) return false;
  if (query.issue && query.issue !== "any" && !record.issues.some((i) => i.type === query.issue)) {
    return false;
  }
  if (query.country && record.site.country !== query.country) return false;
  if (query.paymentTerms && record.site.paymentTerms !== query.paymentTerms) return false;
  if (query.source && record.site.source !== query.source && record.supplier.source !== query.source) {
    return false;
  }
  if (query.supplierId && record.supplier.id !== query.supplierId) return false;
  const q = query.q?.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    record.supplier.name,
    record.supplier.supplierNumber,
    record.supplier.supplierVat,
    record.site.siteCode,
    record.site.siteVat,
    record.site.city,
    record.site.paymentTerms,
    record.site.payGroup,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export async function getSupplierWorkspace(source?: string): Promise<{
  records: SupplierRecord[];
  summary: SupplierSummary;
}> {
  const repo = getSupplierRepository();
  const sites = await repo.listSites(source ? { source } : undefined);
  const supplierIds = [...new Set(sites.map((s) => s.supplierId))];
  const [suppliers, meta] = await Promise.all([
    repo.listSuppliers({ ids: supplierIds }),
    repo.meta(),
  ]);
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
  const repo = getSupplierRepository();
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(500, Math.max(1, query.limit ?? 100));
  const filter = siteListFilter(query);

  // Issue flags are computed in memory, so they cannot be pushed into SQL.
  // When the caller only wants a page of raw records, limit/offset run in the DB.
  const pageInDb = !query.issue;
  const sites = await repo.listSites(pageInDb ? { ...filter, limit, offset } : filter);
  const supplierIds = [...new Set(sites.map((s) => s.supplierId))];
  const suppliers = await repo.listSuppliers({ ids: supplierIds });
  const analysed = analyseSuppliers({ suppliers, sites });
  const filtered = analysed.records.filter((r) => matchesSupplierListQuery(r, query));

  if (pageInDb) {
    const total = await repo.countSites(filter);
    return { total, records: filtered };
  }
  return { total: filtered.length, records: filtered.slice(offset, offset + limit) };
}

export async function getSupplierRecord(id: string) {
  const repo = getSupplierRepository();
  const site = await repo.getSite(id);
  if (!site) return null;
  const supplier = await repo.getSupplier(site.supplierId);
  if (!supplier) return null;
  const { records } = analyseSuppliers({ suppliers: [supplier], sites: [site] });
  const [versions, audit, vatChecks] = await Promise.all([
    repo.listVersions("site", site.id),
    repo.listAudit(site.id),
    repo.listVatChecks(site.id),
  ]);
  const supplierVersions = await repo.listVersions("supplier", supplier.id);
  const supplierAudit = await repo.listAudit(supplier.id);
  return {
    record: records[0],
    versions: [...versions, ...supplierVersions].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    audit: [...audit, ...supplierAudit].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    vatCheck: vatChecks[0],
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

export async function listSupplierReview(): Promise<{ items: SupplierReviewItem[] }> {
  const repo = getSupplierRepository();
  const [suppliers, sites, audit, vatChecks] = await Promise.all([
    repo.listSuppliers(),
    repo.listSites(),
    repo.listAudit(),
    repo.listVatChecks(),
  ]);
  return { items: buildReviewItems({ suppliers, sites, audit, vatChecks }) };
}

export async function checkSupplierVat(
  siteId: string,
  actor = "operator",
  viesOptions?: ViesClientOptions,
  scope: VatScope = "site",
): Promise<SupplierVatCheck> {
  const repo = getSupplierRepository();
  const site = await repo.getSite(siteId);
  if (!site) throw new Error(`Site ${siteId} not found.`);
  const supplier = await repo.getSupplier(site.supplierId);
  if (!supplier) throw new Error(`Supplier ${site.supplierId} not found.`);

  const request = vatRequestForRecord(supplier, site, scope);
  const createdAt = new Date().toISOString();
  const label = scope === "site" ? "Site" : "Supplier";
  if ("error" in request) {
    const check: SupplierVatCheck = {
      id: `VATCHK-${randomUUID()}`,
      siteId: site.id,
      supplierId: supplier.id,
      vatScope: scope,
      vatNumber: scope === "site" ? site.siteVat : supplier.supplierVat,
      countryCode: site.country || "",
      validity: "unsupported",
      nameMatch: "unknown",
      addressMatch: "unknown",
      message: request.error,
      actor: actor.trim() || "operator",
      createdAt,
    };
    await repo.saveVatCheck(check);
    return check;
  }

  const result = await checkVatWithVies(request, viesOptions);
  const check: SupplierVatCheck = {
    id: `VATCHK-${randomUUID()}`,
    siteId: site.id,
    supplierId: supplier.id,
    vatScope: scope,
    vatNumber: `${result.countryCode}${result.vatNumber}`,
    countryCode: result.countryCode,
    validity: result.status,
    registeredName: result.registeredName,
    registeredAddress: result.registeredAddress,
    requestDate: result.requestDate,
    nameMatch: result.nameMatch,
    addressMatch: result.addressMatch,
    message: `${label} VAT: ${result.message}`,
    actor: actor.trim() || "operator",
    createdAt,
  };
  await repo.saveVatCheck(check);
  return check;
}

export async function checkSupplierVats(
  siteIds: string[],
  actor = "operator",
  viesOptions?: ViesClientOptions,
  scope: VatScope = "site",
): Promise<{ checks: SupplierVatCheck[]; errors: { id: string; error: string }[] }> {
  const checks: SupplierVatCheck[] = [];
  const errors: { id: string; error: string }[] = [];
  for (const id of siteIds) {
    try {
      checks.push(await checkSupplierVat(id, actor, viesOptions, scope));
    } catch (err) {
      errors.push({ id, error: err instanceof Error ? err.message : "VAT check failed" });
    }
  }
  return { checks, errors };
}

export { ingestSuppliers };

export {
  buildSupplierFbdi,
  saveSupplierFbdi,
  listSupplierFbdiPackages,
  publicFbdiBuild,
  isFbdiDownloadKey,
  defaultImportAction,
  type FbdiBuildOptions,
  type FbdiScope,
  type FbdiImportAction,
} from "./fbdi";
