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

/** One operating-unit assignment for a supplier site (OU is a function of the site). */
export interface SiteOperatingUnit {
  name: string;
  orgId: string;
}

export interface SupplierSite {
  id: string;
  supplierId: string;
  siteCode: string;
  addressName: string;
  procurementBu: string;
  /** Primary operating unit name, the first assignment when a site has several. */
  operatingUnit?: string;
  /** Primary Oracle ORG_ID for the operating unit. */
  orgId?: string;
  /** Every OU assignment from the VAT extract. A site can belong to more than one OU. */
  operatingUnits?: SiteOperatingUnit[];
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
  | "email"
  | "inactiveDate";

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
  "inactiveDate",
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
  "inactiveDate",
]);

export interface SupplierUpdateInput {
  fields: Partial<Record<SupplierPatchField, string>>;
  actor?: string;
  reason?: string;
}

/** Outcome of an EU VIES (or equivalent) VAT registry lookup. */
export type VatCheckValidity = "valid" | "invalid" | "inconclusive" | "unsupported";

export type VatDetailMatch = "match" | "mismatch" | "unknown";

export type VatScope = "supplier" | "site";

export interface SupplierVatCheck {
  id: string;
  siteId: string;
  supplierId: string;
  vatScope: VatScope;
  vatNumber: string;
  countryCode: string;
  validity: VatCheckValidity;
  registeredName?: string;
  registeredAddress?: string;
  requestDate?: string;
  nameMatch: VatDetailMatch;
  addressMatch: VatDetailMatch;
  message: string;
  actor: string;
  createdAt: string;
}

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

/** Site-level edits nested under one supplier in final review. */
export interface SupplierReviewSite {
  site: SupplierSite;
  changes: FieldChange[];
  lastActor: string;
  lastReason?: string;
  lastUpdatedAt: string;
  updateCount: number;
  vatCheck?: SupplierVatCheck;
}

/**
 * One unique supplier that was edited. Header changes sit on `changes`;
 * each updated site is listed separately so the same supplier is not repeated.
 */
export interface SupplierReviewItem {
  id: string;
  supplier: Supplier;
  /** Supplier-header field changes (name, VAT, status, …). */
  changes: FieldChange[];
  /** Audit events on the supplier header. Zero when only sites were edited. */
  headerUpdateCount: number;
  headerActor?: string;
  headerReason?: string;
  sites: SupplierReviewSite[];
  lastActor: string;
  lastReason?: string;
  lastUpdatedAt: string;
  updateCount: number;
}
