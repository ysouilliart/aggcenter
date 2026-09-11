import { assessAddress } from "./address";
import { assessRationalisation } from "./rationalise";
import type {
  DistributionBucket,
  Supplier,
  SupplierIssue,
  SupplierIssueSeverity,
  SupplierIssueType,
  SupplierRecord,
  SupplierSite,
  SupplierSummary,
} from "./types";
import { assessVat, normalizeVat } from "./vat";

const VAT_SEVERITY: Record<string, SupplierIssueSeverity> = {
  missing: "high",
  invalid_format: "high",
  checksum_failed: "high",
  country_mismatch: "medium",
  missing_prefix: "medium",
};

function issueId(parts: string[]): string {
  return parts.join(":");
}

function countBy(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const value of values) {
    const key = value.trim();
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function buckets(map: Map<string, number>): DistributionBucket[] {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function analyseSuppliers(input: {
  suppliers: Supplier[];
  sites: SupplierSite[];
}): { records: SupplierRecord[]; summary: Omit<SupplierSummary, "files" | "ingestedAt"> } {
  const suppliersById = new Map(input.suppliers.map((s) => [s.id, s]));
  const termCounts = countBy(input.sites.map((s) => s.paymentTerms));
  const groupCounts = countBy(input.sites.map((s) => s.payGroup));

  const records: SupplierRecord[] = [];
  for (const site of input.sites) {
    const supplier = suppliersById.get(site.supplierId);
    if (!supplier) continue;
    records.push({
      id: site.id,
      supplier,
      site,
      issues: issuesFor(supplier, site, termCounts, groupCounts),
    });
  }

  const byType: Record<SupplierIssueType, number> = {
    missing_attribute: 0,
    invalid_vat: 0,
    invalid_address: 0,
    rationalise: 0,
  };
  const bySeverity: Record<SupplierIssueSeverity, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };
  let recordsWithIssues = 0;
  let issueCount = 0;
  for (const record of records) {
    if (record.issues.length) recordsWithIssues += 1;
    for (const issue of record.issues) {
      byType[issue.type] += 1;
      bySeverity[issue.severity] += 1;
      issueCount += 1;
    }
  }

  return {
    records,
    summary: {
      supplierCount: input.suppliers.length,
      siteCount: input.sites.length,
      recordsWithIssues,
      issueCount,
      byType,
      bySeverity,
      distributions: {
        paymentTerms: buckets(termCounts),
        payGroup: buckets(groupCounts),
        paymentMethod: buckets(countBy(input.sites.map((s) => s.paymentMethod))),
        type: buckets(countBy(input.suppliers.map((s) => s.type))),
        country: buckets(countBy(input.sites.map((s) => s.country))),
      },
    },
  };
}

export function issuesFor(
  supplier: Supplier,
  site: SupplierSite,
  termCounts?: Map<string, number>,
  groupCounts?: Map<string, number>,
): SupplierIssue[] {
  const issues: SupplierIssue[] = [];

  pushMissing(issues, supplier, site, "name", supplier.name, "Supplier name");
  pushMissing(issues, supplier, site, "supplierNumber", supplier.supplierNumber, "Supplier number", "supplier");
  pushMissing(issues, supplier, site, "type", supplier.type, "Supplier type", "supplier");
  pushMissing(issues, supplier, site, "paymentTerms", site.paymentTerms, "Payment terms");
  pushMissing(issues, supplier, site, "payGroup", site.payGroup, "Pay group");
  pushMissing(issues, supplier, site, "paymentMethod", site.paymentMethod, "Payment method");
  pushMissing(issues, supplier, site, "country", site.country, "Country");

  const supplierVat = assessVat(supplier.supplierVat || supplier.taxpayerId, site.country);
  if (supplierVat.status !== "ok") {
    issues.push({
      id: issueId(["vat", "supplier", site.id, supplierVat.status]),
      type: supplierVat.status === "missing" ? "missing_attribute" : "invalid_vat",
      severity: VAT_SEVERITY[supplierVat.status] ?? "medium",
      field: "supplierVat",
      title: supplierVat.status === "missing" ? "Missing supplier VAT" : "Incorrect supplier VAT",
      description: supplierVat.message,
      suggestion: supplierVat.suggestion,
      recordType: "supplier",
      recordId: supplier.id,
    });
  } else if (supplierVat.suggestion) {
    issues.push({
      id: issueId(["vat", "supplier", site.id, "spacing"]),
      type: "rationalise",
      severity: "low",
      field: "supplierVat",
      title: "VAT ID spacing",
      description: supplierVat.message,
      suggestion: supplierVat.suggestion,
      recordType: "supplier",
      recordId: supplier.id,
    });
  }

  const siteVat = assessVat(site.siteVat, site.country);
  if (site.siteVat && siteVat.status !== "ok") {
    issues.push({
      id: issueId(["vat", "site", site.id, siteVat.status]),
      type: "invalid_vat",
      severity: VAT_SEVERITY[siteVat.status] ?? "medium",
      field: "siteVat",
      title: "Incorrect site VAT",
      description: siteVat.message,
      suggestion: siteVat.suggestion,
      recordType: "site",
      recordId: site.id,
    });
  } else if (siteVat.suggestion) {
    issues.push({
      id: issueId(["vat", "site", site.id, "spacing"]),
      type: "rationalise",
      severity: "low",
      field: "siteVat",
      title: "Site VAT spacing",
      description: siteVat.message,
      suggestion: siteVat.suggestion,
      recordType: "site",
      recordId: site.id,
    });
  } else if (!site.siteVat) {
    issues.push({
      id: issueId(["vat", "site", site.id, "missing"]),
      type: "missing_attribute",
      severity: "medium",
      field: "siteVat",
      title: "Missing site VAT",
      description: "Site VAT ID is missing.",
      recordType: "site",
      recordId: site.id,
    });
  }

  const supplierNorm = normalizeVat(supplier.supplierVat || supplier.taxpayerId);
  const siteNorm = normalizeVat(site.siteVat);
  if (supplierNorm && siteNorm && supplierNorm !== siteNorm) {
    issues.push({
      id: issueId(["vat", "mismatch", site.id]),
      type: "invalid_vat",
      severity: "medium",
      field: "siteVat",
      title: "Supplier and site VAT differ",
      description: `Supplier VAT ${supplier.supplierVat || supplier.taxpayerId} does not match site VAT ${site.siteVat}.`,
      suggestion: supplierNorm,
      recordType: "site",
      recordId: site.id,
    });
  }

  for (const addr of assessAddress(site)) {
    const missing = addr.kind.startsWith("missing");
    issues.push({
      id: issueId(["addr", site.id, addr.kind, addr.field]),
      type: missing ? "missing_attribute" : "invalid_address",
      severity: missing ? "medium" : "high",
      field: addr.field,
      title: missing ? `Missing ${addr.field}` : "Incorrect address",
      description: addr.message,
      suggestion: addr.suggestion,
      recordType: "site",
      recordId: site.id,
    });
  }

  for (const hit of assessRationalisation({
    paymentTerms: site.paymentTerms,
    payGroup: site.payGroup,
    paymentMethod: site.paymentMethod,
    type: supplier.type,
    termCounts,
    groupCounts,
  })) {
    issues.push({
      id: issueId(["rat", site.id, hit.field, hit.value]),
      type: "rationalise",
      severity: "low",
      field: hit.field,
      title: "Rationalise attribute",
      description: hit.reason,
      suggestion: hit.suggestion,
      recordType: hit.field === "type" ? "supplier" : "site",
      recordId: hit.field === "type" ? supplier.id : site.id,
    });
  }

  return issues;
}

function pushMissing(
  issues: SupplierIssue[],
  supplier: Supplier,
  site: SupplierSite,
  field: string,
  value: string,
  label: string,
  recordType: "supplier" | "site" = "site",
) {
  if (value.trim()) return;
  issues.push({
    id: issueId(["miss", site.id, field]),
    type: "missing_attribute",
    severity: field === "name" || field === "supplierNumber" ? "high" : "medium",
    field,
    title: `Missing ${label.toLowerCase()}`,
    description: `${label} is missing.`,
    recordType,
    recordId: recordType === "supplier" ? supplier.id : site.id,
  });
}
