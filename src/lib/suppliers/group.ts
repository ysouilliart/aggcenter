import {
  SUPPLIER_HEADER_FIELDS,
  type SiteOperatingUnit,
  type Supplier,
  type SupplierIssue,
  type SupplierRecord,
  type SupplierSite,
} from "./types";

export interface SupplierGroup {
  id: string;
  supplier: Supplier;
  records: SupplierRecord[];
  siteCount: number;
  issues: SupplierIssue[];
}

const SUPPLIER_ISSUE_FIELDS = new Set<string>([
  ...SUPPLIER_HEADER_FIELDS,
  "name",
  "type",
  "supplierVat",
  "supplierNumber",
  "taxRegistrationNumber",
  "taxpayerId",
  "status",
]);

export function issueKey(issue: SupplierIssue): string {
  return `${issue.recordType}:${issue.field}:${issue.type}:${issue.title}`;
}

export function uniqueIssues(issues: SupplierIssue[]): SupplierIssue[] {
  const seen = new Set<string>();
  const out: SupplierIssue[] = [];
  for (const issue of issues) {
    const key = issueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export function isSupplierIssue(issue: SupplierIssue): boolean {
  return issue.recordType === "supplier" || SUPPLIER_ISSUE_FIELDS.has(issue.field);
}

export function isSiteIssue(issue: SupplierIssue): boolean {
  return !isSupplierIssue(issue);
}

export function supplierIssuesFor(records: SupplierRecord[]): SupplierIssue[] {
  return uniqueIssues(records.flatMap((r) => r.issues).filter(isSupplierIssue));
}

export function siteIssuesFor(record: SupplierRecord): SupplierIssue[] {
  return record.issues.filter(isSiteIssue);
}

export function siteLabel(record: SupplierRecord, siblings: SupplierRecord[] = []): string {
  const code = record.site.siteCode.trim() || record.site.city.trim() || "Site";
  const collisions = siblings.filter(
    (r) => (r.site.siteCode.trim() || r.site.city.trim() || "Site") === code,
  ).length;
  if (collisions <= 1) return code;
  const extra = record.site.paymentTerms.trim() || record.site.payGroup.trim();
  return extra ? `${code} · ${extra}` : code;
}

/** Operating units assigned to a site. Falls back to the primary OU columns. */
export function siteOperatingUnits(site: SupplierSite): SiteOperatingUnit[] {
  if (site.operatingUnits?.length) return site.operatingUnits;
  const name = site.operatingUnit?.trim() ?? "";
  const orgId = site.orgId?.trim() ?? "";
  if (!name && !orgId) return [];
  return [{ name, orgId }];
}

export function siteChipLabel(record: SupplierRecord, siblings: SupplierRecord[] = []): string {
  const base = `${siteLabel(record, siblings)} · ${record.site.id}`;
  const units = siteOperatingUnits(record.site);
  if (units.length === 0) return base;
  if (units.length === 1) {
    const label = units[0].name.replace(/^OU:\s*/i, "").trim() || units[0].orgId;
    return label ? `${base} · ${label}` : base;
  }
  return `${base} · ${units.length} OUs`;
}

export function groupSupplierRecords(records: SupplierRecord[]): SupplierGroup[] {
  const byId = new Map<string, SupplierRecord[]>();
  for (const record of records) {
    const id = record.supplier.id;
    const list = byId.get(id);
    if (list) list.push(record);
    else byId.set(id, [record]);
  }
  return [...byId.values()].map((groupRecords) => {
    const supplier = groupRecords[0].supplier;
    return {
      id: supplier.id,
      supplier,
      records: groupRecords,
      siteCount: groupRecords.length,
      issues: uniqueIssues(groupRecords.flatMap((r) => r.issues)),
    };
  });
}
