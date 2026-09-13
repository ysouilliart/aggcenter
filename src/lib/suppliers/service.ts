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
  type FbdiBuildOptions,
  type FbdiScope,
  type FbdiImportAction,
} from "./fbdi";
