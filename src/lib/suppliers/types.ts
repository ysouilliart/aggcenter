/**
 * Supplier-master domain for the Suppliers workspace.
 *
 * Working records are site-grained (payment terms, group, VAT and address live
 * on the site) joined to a supplier header. User edits are versioned and
 * audited in separate tables — never overwritten in place without a snapshot.
 */

export type SupplierStatus = "active" | "inactive";

export type SupplierRecordType = "supplier" | "site";

export type SupplierIssueType =
  | "missing_attribute"
  | "invalid_vat"
  | "invalid_address"
  | "rationalise";

export type SupplierIssueSeverity = "high" | "medium" | "low";

export type SupplierAuditAction = "ingest" | "update" | "restore";

export interface Supplier {
  id: string;
  supplierNumber: string;
  name: string;
  /** Tax organisation type (e.g. CORPORATION, FOREIGN CORPORATION). */
  type: string;
  status: SupplierStatus;
  supplierVat: string;
  taxRegistrationNumber: string;
  taxpayerId: string;
  oneTime: boolean;
  inactiveDate?: string;
  source: string;
  version: number;
  updatedAt: string;
}

export interface SupplierSite {
  id: string;
  supplierId: string;
  siteCode: string;
  addressName: string;
  procurementBu: string;
  operatingUnit?: string;
  inactiveDate?: string;
  paymentTerms: string;
  payGroup: string;
  paymentMethod: string;
  invoiceCurrency: string;
  paymentCurrency: string;
  country: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  province?: string;
  county?: string;
  postalCode: string;
  siteVat: string;
  email?: string;
  source: string;
  version: number;
  updatedAt: string;
}

export interface SupplierIssue {
  id: string;
  type: SupplierIssueType;
  severity: SupplierIssueSeverity;
  field: string;
  title: string;
  description: string;
  /** Suggested replacement when the finding is a rationalisation / format fix. */
  suggestion?: string;
  recordType: SupplierRecordType;
  recordId: string;
}

export interface SupplierRecord {
  id: string;
  supplier: Supplier;
  site: SupplierSite;
  issues: SupplierIssue[];
}

export interface DistributionBucket {
  value: string;
  count: number;
}

export interface SupplierSummary {
  supplierCount: number;
  siteCount: number;
  recordsWithIssues: number;
  issueCount: number;
  byType: Record<SupplierIssueType, number>;
  bySeverity: Record<SupplierIssueSeverity, number>;
  distributions: {
    paymentTerms: DistributionBucket[];
    payGroup: DistributionBucket[];
    paymentMethod: DistributionBucket[];
    type: DistributionBucket[];
    country: DistributionBucket[];
  };
  files: { key: string; rows: number }[];
  ingestedAt?: string;
}

export interface SupplierVersion {
  id: string;
  recordType: SupplierRecordType;
  recordId: string;
  version: number;
  snapshot: Supplier | SupplierSite;
  createdAt: string;
  actor: string;
  reason?: string;
}

export interface SupplierAuditEvent {
  id: string;
  recordType: SupplierRecordType;
  recordId: string;
  action: SupplierAuditAction;
  field?: string;
  oldValue?: string;
  newValue?: string;
  actor: string;
  reason?: string;
  createdAt: string;
  version: number;
}

export type SupplierPatchField =
  | "name"
  | "type"
  | "status"
  | "supplierVat"
  | "taxRegistrationNumber"
  | "taxpayerId"
  | "siteCode"
  | "addressName"
  | "procurementBu"
  | "operatingUnit"
  | "paymentTerms"
  | "payGroup"
  | "paymentMethod"
  | "invoiceCurrency"
  | "paymentCurrency"
  | "country"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "state"
  | "province"
  | "postalCode"
  | "siteVat"
  | "email";

export const SUPPLIER_PATCH_FIELDS: readonly SupplierPatchField[] = [
  "name",
  "type",
  "status",
  "supplierVat",
  "taxRegistrationNumber",
  "taxpayerId",
  "siteCode",
  "addressName",
  "procurementBu",
  "operatingUnit",
  "paymentTerms",
  "payGroup",
  "paymentMethod",
  "invoiceCurrency",
  "paymentCurrency",
  "country",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "province",
  "postalCode",
  "siteVat",
  "email",
] as const;

export const SUPPLIER_HEADER_FIELDS: ReadonlySet<SupplierPatchField> = new Set([
  "name",
  "type",
  "status",
  "supplierVat",
  "taxRegistrationNumber",
  "taxpayerId",
]);

export const SITE_FIELDS: ReadonlySet<SupplierPatchField> = new Set([
  "siteCode",
  "addressName",
  "procurementBu",
  "operatingUnit",
  "paymentTerms",
  "payGroup",
  "paymentMethod",
  "invoiceCurrency",
  "paymentCurrency",
  "country",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "province",
  "postalCode",
  "siteVat",
  "email",
]);

export interface SupplierUpdateInput {
  fields: Partial<Record<SupplierPatchField, string>>;
  actor?: string;
  reason?: string;
}
