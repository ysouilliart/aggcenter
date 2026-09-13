/**
 * Oracle Fusion Supplier FBDI (File-Based Data Import) builder.
 *
 * Loads the original EBS conversion extracts, overlays the rationalised working
 * copy (and any records that exist only in aggcenter), and emits the Import
 * Suppliers worksheets Fusion expects:
 *   POZ_SUPPLIERS_INT, POZ_SUP_ADDRESSES_INT, POZ_SUPPLIER_SITES_INT,
 *   POZ_SITE_ASSIGNMENTS_INT
 * packaged as PozSupplierImport.zip for Load Interface File for Import.
 */

import { getConfig } from "../config";
import { parseCsv, serializeCsv } from "../parse/csv";
import { getStorageProvider, type StorageProvider, type StoredObject } from "../storage";
import { createZipStore } from "../zip";
import { loadSupplierExtractFiles } from "./extractFiles";
import { mapSupplierExtracts } from "./fromExtracts";
import { getSupplierRepository, type SupplierRepository } from "./repository";
import type {
  Supplier,
  SupplierAuditEvent,
  SupplierSite,
} from "./types";
import { splitVatNumber } from "./vat";

export const DEFAULT_SUPPLIER_FBDI_PREFIX = "aggcenter/FBDI/supplier/";
export const FBDI_ZIP_NAME = "PozSupplierImport.zip";

export type FbdiScope = "all" | "changed" | "new";
export type FbdiImportAction = "CREATE" | "UPDATE";

export interface FbdiBuildOptions {
  scope?: FbdiScope;
  importAction?: FbdiImportAction;
  businessRelationship?: string;
  actor?: string;
  batchId?: string;
  now?: Date;
  storage?: StorageProvider;
  repo?: SupplierRepository;
  sourcePrefix?: string;
  outputPrefix?: string;
}

export interface FbdiOverlay {
  sheet: "suppliers" | "sites" | "addresses";
  key: string;
  field: string;
  from: string;
  to: string;
}

export interface FbdiFile {
  name: string;
  csv: string;
  rows: number;
}

export interface FbdiBuildResult {
  batchId: string;
  createdAt: string;
  actor: string;
  scope: FbdiScope;
  importAction: FbdiImportAction;
  businessRelationship: string;
  prefix: string;
  provider: string;
  usedSampleFallback: boolean;
  sourceFiles: { key: string; rows: number }[];
  sourceErrors: { key: string; error: string }[];
  counts: {
    suppliers: number;
    addresses: number;
    sites: number;
    assignments: number;
    overlayed: number;
    synthesized: number;
  };
  overlays: FbdiOverlay[];
  files: FbdiFile[];
  zip: Buffer;
  preview: {
    suppliers: Record<string, string>[];
    sites: Record<string, string>[];
    addresses: Record<string, string>[];
  };
}

export interface FbdiSavedFile {
  name: string;
  key: string;
  size: number;
  rows?: number;
}

export interface FbdiSavedPackage {
  batchId: string;
  createdAt: string;
  actor?: string;
  scope?: FbdiScope;
  importAction?: FbdiImportAction;
  prefix: string;
  files: FbdiSavedFile[];
  counts?: FbdiBuildResult["counts"];
}

export interface FbdiSaveResult extends FbdiBuildResult {
  saved: FbdiSavedFile[];
}

const SUPPLIER_HEADERS = [
  "Import Action",
  "Batch ID",
  "Supplier Name",
  "Supplier Number",
  "Alternate Name",
  "Inactive Date",
  "Supplier Type",
  "One Time Supplier Flag",
  "Customer Number",
  "Alias",
  "DUNS Number",
  "SIC",
  "National Insurance Number",
  "Corporate Website",
  "Chief Executive Title",
  "Chief Executive Name",
  "Tax Organization Type",
  "Taxpayer ID",
  "Federal Reportable",
  "Federal Income Tax Type",
  "Tax Reporting Name",
  "Name Control",
  "Tax Verification Date",
  "Withholding Tax Group",
  "VAT Code",
  "Tax Registration Number",
  "Business Relationship",
  "Taxpayer Country",
  "Parent Supplier Name",
  "Delivery Channel",
  "Bank Instruction 1",
  "Bank Instruction 2",
  "Bank Instruction",
  "Settlement Priority",
  "Payment Text Message 1",
  "Payment Text Message 2",
  "Payment Text Message 3",
  "Bank Charge Bearer",
  "Payment Reason",
  "Payment Reason Comments",
  "Payment Format",
  "Pay Each Document Alone",
  "Remittance Advice Fax",
] as const;

const ADDRESS_HEADERS = [
  "Import Action",
  "Batch ID",
  "Supplier Name",
  "Supplier Number",
  "Address Name",
  "Country",
  "Address Line 1",
  "Address Line 2",
  "Address Line 3",
  "Address Line 4",
  "City",
  "State",
  "Province",
  "County",
  "Postal Code",
  "Addressee",
  "Phone Country Code",
  "Phone Area Code",
  "Phone",
  "Phone Extension",
  "Fax Country Code",
  "Fax Area Code",
  "Fax",
  "RFQ or Bidding",
  "Ordering",
  "Pay",
  "Email Address",
  "Inactive Date",
  "Language",
  "Global Location Number",
] as const;

const SITE_HEADERS = [
  "Import Action",
  "Batch ID",
  "Supplier Name",
  "Supplier Number",
  "Procurement BU",
  "Address Name",
  "Supplier Site",
  "Alternate Site Name",
  "Inactive Date",
  "Purchasing",
  "Procurement Card",
  "Pay",
  "Primary Pay",
  "Sourcing Only",
  "Email",
  "Country of Origin",
  "Invoice Currency",
  "Invoice Amount Limit",
  "Invoice Match Option",
  "Payment Currency",
  "Payment Priority",
  "Pay Group",
  "Payment Terms",
  "Terms Date Basis",
  "Pay Date Basis",
  "Always Take Discount",
  "Exclude Freight From Discount",
  "Create Interest Invoices",
  "Payment Method",
  "Hold Flag",
  "Hold Reason",
  "Freight Terms",
  "Pay On Receipt",
  "FOB",
  "Communication Method",
  "Customer Number",
  "Invoice Summary Level",
  "Gapless Invoice Numbering",
  "Selling Company Identifier",
  "Delivery Channel",
  "Bank Instruction 1",
  "Bank Instruction 2",
  "Bank Instruction",
  "Settlement Priority",
  "Payment Text Message 1",
  "Payment Text Message 2",
  "Payment Text Message 3",
  "Bank Charge Bearer",
  "Payment Reason",
  "Payment Reason Comments",
  "Delivery Method",
  "Remittance Email",
  "Remittance Fax",
  "Pay Each Document Alone",
  "Tax Registration Number",
] as const;

const ASSIGNMENT_HEADERS = [
  "Import Action",
  "Batch ID",
  "Supplier Name",
  "Supplier Number",
  "Supplier Site",
  "Procurement BU",
  "Client BU",
  "Bill-to BU",
  "Ship to Exception Action",
  "Bill to Exception Action",
  "Inactive Date",
] as const;

const OVERLAY_HEADERS = ["Sheet", "Key", "Field", "From", "To"] as const;

function blank(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function yn(value: string | boolean | undefined, fallback = ""): string {
  if (typeof value === "boolean") return value ? "Y" : "N";
  const v = blank(value);
  if (!v) return fallback;
  if (/^(y|yes|true|1)$/i.test(v)) return "Y";
  if (/^(n|no|false|0)$/i.test(v)) return "N";
  return v.toUpperCase();
}

function fusionDate(value: string | undefined): string {
  const t = blank(value);
  if (!t) return "";
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;
  return t;
}

function upper(value: string | undefined): string {
  return blank(value).toUpperCase();
}

function siteKey(supplierNumber: string, siteCode: string): string {
  return `${blank(supplierNumber)}|${upper(siteCode)}`;
}

function clone(row: Record<string, string> | undefined): Record<string, string> {
  return { ...(row ?? {}) };
}

function overlayField(
  row: Record<string, string>,
  field: string,
  next: string | undefined,
  overlays: FbdiOverlay[],
  sheet: FbdiOverlay["sheet"],
  key: string,
  track = true,
): void {
  if (next === undefined) return;
  const from = row[field] ?? "";
  const to = next;
  if (from === to) return;
  row[field] = to;
  if (track) overlays.push({ sheet, key, field, from, to });
}

function taxpayerCountry(vat: string | undefined, addressCountry: string | undefined): string {
  const split = splitVatNumber(vat ?? "", addressCountry ?? "");
  if (split?.countryCode) return split.countryCode === "EL" ? "GR" : split.countryCode;
  return upper(addressCountry).slice(0, 2);
}

function batchIdFrom(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `AGGC-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(
    now.getUTCHours(),
  )}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

function hasUpdate(
  audit: SupplierAuditEvent[],
  supplierId: string,
  siteId: string,
): boolean {
  return audit.some(
    (e) =>
      e.action === "update" &&
      e.recordId !== "*" &&
      (e.recordId === siteId || e.recordId === supplierId),
  );
}

interface IndexedExtracts {
  profileByVid: Map<string, Record<string, string>>;
  profileByNumber: Map<string, Record<string, string>>;
  siteBySid: Map<string, Record<string, string>>;
  siteByKey: Map<string, Record<string, string>>;
  addressByVidName: Map<string, Record<string, string>>;
  addressByVid: Map<string, Record<string, string>[]>;
}

function indexExtracts(extracts: {
  profiles: Record<string, string>[];
  sites: Record<string, string>[];
  addresses: Record<string, string>[];
}): IndexedExtracts {
  const profileByVid = new Map<string, Record<string, string>>();
  const profileByNumber = new Map<string, Record<string, string>>();
  for (const row of extracts.profiles) {
    if (blank(row.vid)) profileByVid.set(blank(row.vid), row);
    if (blank(row.supplier_number)) profileByNumber.set(blank(row.supplier_number), row);
  }
  const siteBySid = new Map<string, Record<string, string>>();
  const siteByKey = new Map<string, Record<string, string>>();
  for (const row of extracts.sites) {
    if (blank(row.sid)) siteBySid.set(blank(row.sid), row);
    const profile = profileByVid.get(blank(row.vid));
    const number = blank(profile?.supplier_number);
    if (number && blank(row.supplier_site)) {
      siteByKey.set(siteKey(number, row.supplier_site), row);
    }
  }
  const addressByVidName = new Map<string, Record<string, string>>();
  const addressByVid = new Map<string, Record<string, string>[]>();
  for (const row of extracts.addresses) {
    const vid = blank(row.vid);
    const name = upper(row.address_name);
    if (vid && name) addressByVidName.set(`${vid}|${name}`, row);
    if (vid) {
      const list = addressByVid.get(vid) ?? [];
      list.push(row);
      addressByVid.set(vid, list);
    }
  }
  return { profileByVid, profileByNumber, siteBySid, siteByKey, addressByVidName, addressByVid };
}

function findProfile(
  index: IndexedExtracts,
  supplier: Supplier,
): Record<string, string> | undefined {
  return index.profileByVid.get(supplier.id) ?? index.profileByNumber.get(supplier.supplierNumber);
}

function findSite(
  index: IndexedExtracts,
  supplier: Supplier,
  site: SupplierSite,
): Record<string, string> | undefined {
  return (
    index.siteBySid.get(site.id) ??
    index.siteByKey.get(siteKey(supplier.supplierNumber, site.siteCode))
  );
}

function findAddress(
  index: IndexedExtracts,
  supplier: Supplier,
  site: SupplierSite,
): Record<string, string> | undefined {
  const name = upper(site.addressName || site.siteCode);
  return (
    index.addressByVidName.get(`${supplier.id}|${name}`) ??
    index.addressByVid.get(supplier.id)?.[0]
  );
}

function overlaySupplier(
  source: Record<string, string> | undefined,
  supplier: Supplier,
  overlays: FbdiOverlay[],
): { row: Record<string, string>; synthesized: boolean } {
  const synthesized = !source;
  const row = clone(source);
  const key = supplier.supplierNumber || supplier.id;
  const track = !synthesized;
  if (!row.vid) row.vid = supplier.id;
  overlayField(row, "supplier_name", supplier.name, overlays, "suppliers", key, track);
  overlayField(row, "supplier_number", supplier.supplierNumber, overlays, "suppliers", key, track);
  overlayField(row, "tax_organization_type", supplier.type, overlays, "suppliers", key, track);
  overlayField(row, "inactive_date", supplier.inactiveDate ?? "", overlays, "suppliers", key, track);
  overlayField(row, "one_time_supplier", yn(supplier.oneTime, "N"), overlays, "suppliers", key, track);
  const vat = blank(supplier.supplierVat);
  overlayField(
    row,
    "tax_registration_number",
    vat || supplier.taxRegistrationNumber,
    overlays,
    "suppliers",
    key,
    track,
  );
  const taxpayer =
    blank(supplier.taxpayerId) ||
    (blank(row.taxpayer_id) === blank(source?.tax_registration_number) ? vat : blank(row.taxpayer_id));
  overlayField(row, "taxpayer_id", taxpayer, overlays, "suppliers", key, track);
  return { row, synthesized };
}

function overlaySiteRow(
  source: Record<string, string> | undefined,
  supplier: Supplier,
  site: SupplierSite,
  overlays: FbdiOverlay[],
): { row: Record<string, string>; synthesized: boolean } {
  const synthesized = !source;
  const row = clone(source);
  const key = siteKey(supplier.supplierNumber, site.siteCode);
  const track = !synthesized;
  if (!row.vid) row.vid = supplier.id;
  if (!row.sid) row.sid = site.id;
  overlayField(row, "supplier_name", supplier.name, overlays, "sites", key, track);
  overlayField(row, "procurement_bu", site.procurementBu, overlays, "sites", key, track);
  overlayField(row, "address_name", site.addressName || site.siteCode, overlays, "sites", key, track);
  overlayField(row, "supplier_site", site.siteCode, overlays, "sites", key, track);
  overlayField(row, "inactive_date", site.inactiveDate ?? "", overlays, "sites", key, track);
  overlayField(row, "email", site.email ?? "", overlays, "sites", key, track);
  overlayField(row, "invoice_currency", site.invoiceCurrency, overlays, "sites", key, track);
  overlayField(row, "payment_currency", site.paymentCurrency, overlays, "sites", key, track);
  overlayField(row, "pay_group", site.payGroup, overlays, "sites", key, track);
  overlayField(row, "payment_terms", site.paymentTerms, overlays, "sites", key, track);
  overlayField(row, "payment_method", site.paymentMethod, overlays, "sites", key, track);
  overlayField(row, "country_of_origin", site.country, overlays, "sites", key, track);
  overlayField(row, "site_vat", site.siteVat, overlays, "sites", key, track);
  if (synthesized) {
    if (!row.purchasing) row.purchasing = "Y";
    if (!row.pay) row.pay = "Y";
    if (!row.primary_pay) row.primary_pay = "Y";
    if (!row.procurement_card) row.procurement_card = "N";
    if (!row.invoice_match_option) row.invoice_match_option = "P";
    if (!row.payment_priority) row.payment_priority = "99";
    if (!row.terms_date_basis) row.terms_date_basis = "Invoice";
    if (!row.pay_date_basis) row.pay_date_basis = "DUE";
  }
  return { row, synthesized };
}

function overlayAddressRow(
  source: Record<string, string> | undefined,
  supplier: Supplier,
  site: SupplierSite,
  overlays: FbdiOverlay[],
): { row: Record<string, string>; synthesized: boolean } {
  const synthesized = !source;
  const row = clone(source);
  const key = `${supplier.supplierNumber}|${site.addressName || site.siteCode}`;
  const track = !synthesized;
  if (!row.vid) row.vid = supplier.id;
  overlayField(row, "supplier_name", supplier.name, overlays, "addresses", key, track);
  overlayField(row, "address_name", site.addressName || site.siteCode, overlays, "addresses", key, track);
  overlayField(row, "country", site.country, overlays, "addresses", key, track);
  overlayField(row, "address_line_1", site.addressLine1, overlays, "addresses", key, track);
  overlayField(row, "address_line_2", site.addressLine2 ?? "", overlays, "addresses", key, track);
  overlayField(row, "city", site.city, overlays, "addresses", key, track);
  overlayField(row, "state", site.state ?? "", overlays, "addresses", key, track);
  overlayField(row, "province", site.province ?? "", overlays, "addresses", key, track);
  overlayField(row, "county", site.county ?? "", overlays, "addresses", key, track);
  overlayField(row, "postal_code", site.postalCode, overlays, "addresses", key, track);
  overlayField(row, "e_mail", site.email ?? row.e_mail ?? "", overlays, "addresses", key, track);
  if (synthesized) {
    if (!row.rfq_or_bidding) row.rfq_or_bidding = "N";
    if (!row.ordering) row.ordering = "Y";
    if (!row.pay) row.pay = "Y";
  }
  return { row, synthesized };
}

function mapSupplierFbdi(
  row: Record<string, string>,
  opts: { action: FbdiImportAction; batchId: string; businessRelationship: string; country: string; vat: string },
): Record<string, string> {
  return {
    "Import Action": opts.action,
    "Batch ID": opts.batchId,
    "Supplier Name": row.supplier_name ?? "",
    "Supplier Number": row.supplier_number ?? "",
    "Alternate Name": row.alternate_name ?? "",
    "Inactive Date": fusionDate(row.inactive_date),
    "Supplier Type": row.tax_organization_type ?? "",
    "One Time Supplier Flag": yn(row.one_time_supplier, "N"),
    "Customer Number": row.customer_number ?? "",
    "Alias": row.alias1 ?? row.alias ?? "",
    "DUNS Number": row.duns_number ?? "",
    "SIC": row.sic ?? "",
    "National Insurance Number": row.national_insurance_number ?? "",
    "Corporate Website": row.corporate_web_site ?? "",
    "Chief Executive Title": row.chief_executive_title ?? "",
    "Chief Executive Name": row.chief_executive_name ?? "",
    "Tax Organization Type": row.tax_organization_type ?? "",
    "Taxpayer ID": row.taxpayer_id ?? "",
    "Federal Reportable": yn(row.federal_reportable),
    "Federal Income Tax Type": row.federal_income_tax_type ?? "",
    "Tax Reporting Name": row.tax_reporting_name ?? "",
    "Name Control": row.name_control ?? "",
    "Tax Verification Date": fusionDate(row.tax_verification_date),
    "Withholding Tax Group": row.withholding_tax_group ?? "",
    "VAT Code": row.vat_code ?? "",
    "Tax Registration Number": row.tax_registration_number ?? "",
    "Business Relationship": opts.businessRelationship,
    "Taxpayer Country": taxpayerCountry(opts.vat || row.tax_registration_number, opts.country),
    "Parent Supplier Name": row.parent_supplier_name ?? "",
    "Delivery Channel": row.delivery_channel ?? "",
    "Bank Instruction 1": row.bank_instruction_1 ?? "",
    "Bank Instruction 2": row.bank_instruction_2 ?? "",
    "Bank Instruction": row.bank_instruction ?? "",
    "Settlement Priority": row.settlement_priority ?? "",
    "Payment Text Message 1": row.payment_text_message_1 ?? "",
    "Payment Text Message 2": row.payment_text_message_2 ?? "",
    "Payment Text Message 3": row.payment_text_message_3 ?? "",
    "Bank Charge Bearer": row.bank_charge_bearer ?? "",
    "Payment Reason": row.payment_reason ?? "",
    "Payment Reason Comments": row.payment_reason_comments ?? "",
    "Payment Format": row.payment_format ?? "",
    "Pay Each Document Alone": yn(row.pay_each_document_alone),
    "Remittance Advice Fax": row.remittance_fax ?? "",
  };
}

function mapAddressFbdi(
  row: Record<string, string>,
  opts: { action: FbdiImportAction; batchId: string; supplierNumber: string },
): Record<string, string> {
  return {
    "Import Action": opts.action,
    "Batch ID": opts.batchId,
    "Supplier Name": row.supplier_name ?? "",
    "Supplier Number": opts.supplierNumber || row.supplier_number || "",
    "Address Name": row.address_name ?? "",
    "Country": row.country ?? "",
    "Address Line 1": row.address_line_1 ?? "",
    "Address Line 2": row.address_line_2 ?? "",
    "Address Line 3": row.address_line_3 ?? "",
    "Address Line 4": row.address_line_4 ?? "",
    "City": row.city ?? "",
    "State": row.state ?? "",
    "Province": row.province ?? "",
    "County": row.county ?? "",
    "Postal Code": row.postal_code ?? "",
    "Addressee": row.addressee ?? "",
    "Phone Country Code": row.phone_country_code ?? "",
    "Phone Area Code": row.phone_area_code ?? "",
    "Phone": row.phone ?? "",
    "Phone Extension": row.phone_extension ?? "",
    "Fax Country Code": row.fax_country_code ?? "",
    "Fax Area Code": row.fax_area_code ?? "",
    "Fax": row.fax ?? "",
    "RFQ or Bidding": yn(row.rfq_or_bidding),
    "Ordering": yn(row.ordering, "Y"),
    "Pay": yn(row.pay, "Y"),
    "Email Address": row.e_mail ?? row.email ?? "",
    "Inactive Date": fusionDate(row.inactive_date),
    "Language": row.language ?? "",
    "Global Location Number": row.global_location_number ?? "",
  };
}

function mapSiteFbdi(
  row: Record<string, string>,
  opts: { action: FbdiImportAction; batchId: string; supplierNumber: string },
): Record<string, string> {
  return {
    "Import Action": opts.action,
    "Batch ID": opts.batchId,
    "Supplier Name": row.supplier_name ?? "",
    "Supplier Number": opts.supplierNumber,
    "Procurement BU": row.procurement_bu ?? "",
    "Address Name": row.address_name ?? "",
    "Supplier Site": row.supplier_site ?? "",
    "Alternate Site Name": row.alternate_site_name ?? "",
    "Inactive Date": fusionDate(row.inactive_date),
    "Purchasing": yn(row.purchasing, "Y"),
    "Procurement Card": yn(row.procurement_card, "N"),
    "Pay": yn(row.pay, "Y"),
    "Primary Pay": yn(row.primary_pay, "Y"),
    "Sourcing Only": yn(row.sourcing_only, "N"),
    "Email": row.email ?? "",
    "Country of Origin": row.country_of_origin ?? "",
    "Invoice Currency": row.invoice_currency ?? "",
    "Invoice Amount Limit": row.invoice_amount_limit ?? "",
    "Invoice Match Option": row.invoice_match_option ?? "",
    "Payment Currency": row.payment_currency ?? "",
    "Payment Priority": row.payment_priority ?? "",
    "Pay Group": row.pay_group ?? "",
    "Payment Terms": row.payment_terms ?? "",
    "Terms Date Basis": row.terms_date_basis ?? "",
    "Pay Date Basis": row.pay_date_basis ?? "",
    "Always Take Discount": yn(row.always_take_discount),
    "Exclude Freight From Discount": yn(row.exclude_freight_from_discount),
    "Create Interest Invoices": yn(row.create_interest_invoices),
    "Payment Method": row.payment_method ?? "",
    "Hold Flag": yn(row.hold_flag),
    "Hold Reason": row.hold_reason ?? "",
    "Freight Terms": row.freight_terms ?? "",
    "Pay On Receipt": yn(row.pay_on_receipt),
    "FOB": row.fob ?? "",
    "Communication Method": row.comm_method ?? "",
    "Customer Number": row.customer_number ?? "",
    "Invoice Summary Level": row.invoice_summary_level ?? "",
    "Gapless Invoice Numbering": yn(row.gapless_invoice_numbering),
    "Selling Company Identifier": row.selling_company_identifier ?? "",
    "Delivery Channel": row.delivery_channel ?? "",
    "Bank Instruction 1": row.bank_instruction_1 ?? "",
    "Bank Instruction 2": row.bank_instruction_2 ?? "",
    "Bank Instruction": row.bank_instruction ?? "",
    "Settlement Priority": row.settlement_priority ?? "",
    "Payment Text Message 1": row.payment_text_message_1 ?? "",
    "Payment Text Message 2": row.payment_text_message_2 ?? "",
    "Payment Text Message 3": row.payment_text_message_3 ?? "",
    "Bank Charge Bearer": row.bank_charge_bearer ?? "",
    "Payment Reason": row.payment_reason ?? "",
    "Payment Reason Comments": row.payment_reason_comments ?? "",
    "Delivery Method": row.delivery_method ?? "",
    "Remittance Email": row.remittance_email ?? "",
    "Remittance Fax": row.remittance_fax ?? "",
    "Pay Each Document Alone": yn(row.pay_each_document_alone),
    "Tax Registration Number": row.site_vat ?? "",
  };
}

function mapAssignmentFbdi(
  row: Record<string, string>,
  opts: { action: FbdiImportAction; batchId: string; supplierNumber: string },
): Record<string, string> {
  const bu = row.procurement_bu ?? "";
  return {
    "Import Action": opts.action,
    "Batch ID": opts.batchId,
    "Supplier Name": row.supplier_name ?? "",
    "Supplier Number": opts.supplierNumber,
    "Supplier Site": row.supplier_site ?? "",
    "Procurement BU": bu,
    "Client BU": bu,
    "Bill-to BU": bu,
    "Ship to Exception Action": "",
    "Bill to Exception Action": "",
    "Inactive Date": fusionDate(row.inactive_date),
  };
}

function workingCopyOrExtract(
  suppliers: Supplier[],
  sites: SupplierSite[],
  extracts: { profiles: Record<string, string>[]; sites: Record<string, string>[]; addresses: Record<string, string>[]; vat: Record<string, string>[] },
): { suppliers: Supplier[]; sites: SupplierSite[] } {
  if (suppliers.length && sites.length) return { suppliers, sites };
  const mapped = mapSupplierExtracts(extracts);
  return mapped;
}

export function buildSupplierFbdiFrom(
  input: {
    suppliers: Supplier[];
    sites: SupplierSite[];
    audit?: SupplierAuditEvent[];
    extracts: {
      profiles: Record<string, string>[];
      sites: Record<string, string>[];
      addresses: Record<string, string>[];
      vat: Record<string, string>[];
    };
    sourceFiles?: { key: string; rows: number }[];
    sourceErrors?: { key: string; error: string }[];
    usedSampleFallback?: boolean;
    provider?: string;
    prefix?: string;
  },
  options: FbdiBuildOptions = {},
): FbdiBuildResult {
  const now = options.now ?? new Date();
  const batchId = options.batchId ?? batchIdFrom(now);
  const scope = options.scope ?? "all";
  const importAction = options.importAction ?? "CREATE";
  const businessRelationship = options.businessRelationship ?? "SPEND_AUTHORIZED";
  const actor = (options.actor ?? "operator").trim() || "operator";
  const createdAt = now.toISOString();
  const prefix = options.outputPrefix ?? input.prefix ?? DEFAULT_SUPPLIER_FBDI_PREFIX;
  const working = workingCopyOrExtract(input.suppliers, input.sites, input.extracts);
  const audit = input.audit ?? [];
  const index = indexExtracts(input.extracts);
  const overlays: FbdiOverlay[] = [];

  const sitesBySupplier = new Map<string, SupplierSite[]>();
  for (const site of working.sites) {
    const list = sitesBySupplier.get(site.supplierId) ?? [];
    list.push(site);
    sitesBySupplier.set(site.supplierId, list);
  }

  const inScopeSupplierIds = new Set<string>();
  for (const supplier of working.suppliers) {
    const supplierSites = sitesBySupplier.get(supplier.id) ?? [];
    const anyNew =
      !findProfile(index, supplier) || supplierSites.some((s) => !findSite(index, supplier, s));
    const anyChanged = supplierSites.some((s) => hasUpdate(audit, supplier.id, s.id));
    const include =
      scope === "all" ||
      (scope === "new" && anyNew) ||
      (scope === "changed" && (anyChanged || anyNew));
    if (include) inScopeSupplierIds.add(supplier.id);
  }

  const supplierRows: Record<string, string>[] = [];
  const addressRows: Record<string, string>[] = [];
  const siteRows: Record<string, string>[] = [];
  const assignmentRows: Record<string, string>[] = [];
  const seenSuppliers = new Set<string>();
  const seenAddresses = new Set<string>();
  let overlayed = 0;
  let synthesized = 0;

  for (const supplier of working.suppliers) {
    if (!inScopeSupplierIds.has(supplier.id)) continue;
    const supplierSites = sitesBySupplier.get(supplier.id) ?? [];
    const profileHit = findProfile(index, supplier);
    const beforeOverlay = overlays.length;
    const { row: profileRow, synthesized: newSupplier } = overlaySupplier(
      profileHit,
      supplier,
      overlays,
    );
    if (newSupplier) synthesized += 1;
    if (overlays.length > beforeOverlay && !newSupplier) overlayed += 1;

    const country =
      supplierSites.find((s) => blank(s.country))?.country ??
      "";
    const number = blank(profileRow.supplier_number) || supplier.supplierNumber;
    if (!seenSuppliers.has(number || supplier.id)) {
      seenSuppliers.add(number || supplier.id);
      supplierRows.push(
        mapSupplierFbdi(profileRow, {
          action: importAction,
          batchId,
          businessRelationship,
          country,
          vat: supplier.supplierVat,
        }),
      );
    }

    for (const site of supplierSites) {
      const siteHit = findSite(index, supplier, site);
      const siteBefore = overlays.length;
      const { row: siteRow, synthesized: newSite } = overlaySiteRow(
        siteHit,
        supplier,
        site,
        overlays,
      );
      if (newSite) synthesized += 1;
      if (overlays.length > siteBefore && !newSite) overlayed += 1;

      const addrHit = findAddress(index, supplier, site);
      const addrBefore = overlays.length;
      const { row: addrRow, synthesized: newAddr } = overlayAddressRow(
        addrHit,
        supplier,
        site,
        overlays,
      );
      if (newAddr) synthesized += 1;
      if (overlays.length > addrBefore && !newAddr) overlayed += 1;

      const addrKey = `${number}|${upper(addrRow.address_name)}`;
      if (!seenAddresses.has(addrKey)) {
        seenAddresses.add(addrKey);
        addressRows.push(
          mapAddressFbdi(addrRow, { action: importAction, batchId, supplierNumber: number }),
        );
      }
      siteRows.push(
        mapSiteFbdi(siteRow, { action: importAction, batchId, supplierNumber: number }),
      );
      assignmentRows.push(
        mapAssignmentFbdi(siteRow, { action: importAction, batchId, supplierNumber: number }),
      );
    }
  }

  const files: FbdiFile[] = [
    {
      name: "POZ_SUPPLIERS_INT.csv",
      csv: serializeCsv(SUPPLIER_HEADERS, supplierRows),
      rows: supplierRows.length,
    },
    {
      name: "POZ_SUP_ADDRESSES_INT.csv",
      csv: serializeCsv(ADDRESS_HEADERS, addressRows),
      rows: addressRows.length,
    },
    {
      name: "POZ_SUPPLIER_SITES_INT.csv",
      csv: serializeCsv(SITE_HEADERS, siteRows),
      rows: siteRows.length,
    },
    {
      name: "POZ_SITE_ASSIGNMENTS_INT.csv",
      csv: serializeCsv(ASSIGNMENT_HEADERS, assignmentRows),
      rows: assignmentRows.length,
    },
    {
      name: "overlay-report.csv",
      csv: serializeCsv(
        OVERLAY_HEADERS,
        overlays.map((o) => ({
          Sheet: o.sheet,
          Key: o.key,
          Field: o.field,
          From: o.from,
          To: o.to,
        })),
      ),
      rows: overlays.length,
    },
  ];

  const zipEntries = files
    .filter((f) => f.name.startsWith("POZ_"))
    .map((f) => ({ name: f.name, data: Buffer.from(f.csv, "utf8") }));
  const zip = createZipStore(zipEntries, now);

  return {
    batchId,
    createdAt,
    actor,
    scope,
    importAction,
    businessRelationship,
    prefix,
    provider: input.provider ?? "local",
    usedSampleFallback: Boolean(input.usedSampleFallback),
    sourceFiles: input.sourceFiles ?? [],
    sourceErrors: input.sourceErrors ?? [],
    counts: {
      suppliers: supplierRows.length,
      addresses: addressRows.length,
      sites: siteRows.length,
      assignments: assignmentRows.length,
      overlayed,
      synthesized,
    },
    overlays,
    files,
    zip,
    preview: {
      suppliers: supplierRows.slice(0, 12),
      sites: siteRows.slice(0, 12),
      addresses: addressRows.slice(0, 12),
    },
  };
}

export async function buildSupplierFbdi(options: FbdiBuildOptions = {}): Promise<FbdiBuildResult> {
  const config = getConfig();
  const storage = options.storage ?? getStorageProvider();
  const repo = options.repo ?? getSupplierRepository();
  const sourcePrefix = options.sourcePrefix ?? config.supplierPrefix;
  const outputPrefix = options.outputPrefix ?? config.supplierFbdiPrefix;
  const [extracts, suppliers, sites, audit] = await Promise.all([
    loadSupplierExtractFiles({ storage, prefix: sourcePrefix }),
    repo.listSuppliers(),
    repo.listSites(),
    repo.listAudit(),
  ]);
  return buildSupplierFbdiFrom(
    {
      suppliers,
      sites,
      audit,
      extracts,
      sourceFiles: extracts.files,
      sourceErrors: extracts.errors,
      usedSampleFallback: extracts.usedSampleFallback,
      provider: storage.name,
      prefix: outputPrefix,
    },
    { ...options, storage, repo, outputPrefix },
  );
}

export function manifestJson(result: FbdiBuildResult): string {
  return `${JSON.stringify(
    {
      batchId: result.batchId,
      createdAt: result.createdAt,
      actor: result.actor,
      scope: result.scope,
      importAction: result.importAction,
      businessRelationship: result.businessRelationship,
      prefix: result.prefix,
      provider: result.provider,
      usedSampleFallback: result.usedSampleFallback,
      sourceFiles: result.sourceFiles,
      sourceErrors: result.sourceErrors,
      counts: result.counts,
      overlayCount: result.overlays.length,
      files: result.files.map((f) => ({ name: f.name, rows: f.rows })),
      zip: FBDI_ZIP_NAME,
    },
    null,
    2,
  )}\n`;
}

export async function saveSupplierFbdi(options: FbdiBuildOptions = {}): Promise<FbdiSaveResult> {
  const result = await buildSupplierFbdi(options);
  const storage = options.storage ?? getStorageProvider();
  const folder = `${result.prefix.replace(/\/+$/, "")}/${result.batchId}`;
  const saved: FbdiSavedFile[] = [];

  for (const file of result.files) {
    const key = `${folder}/${file.name}`;
    const buf = Buffer.from(file.csv, "utf8");
    const obj = await storage.put(key, buf, "text/csv");
    saved.push({ name: file.name, key: obj.key, size: obj.size, rows: file.rows });
  }
  const zipKey = `${folder}/${FBDI_ZIP_NAME}`;
  const zipObj = await storage.put(zipKey, result.zip, "application/zip");
  saved.push({ name: FBDI_ZIP_NAME, key: zipObj.key, size: zipObj.size });
  const manifestKey = `${folder}/manifest.json`;
  const manifestBuf = Buffer.from(manifestJson(result), "utf8");
  const manifestObj = await storage.put(manifestKey, manifestBuf, "application/json");
  saved.push({ name: "manifest.json", key: manifestObj.key, size: manifestObj.size });

  return { ...result, saved };
}

function batchFromKey(key: string, prefix: string): string | undefined {
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const batch = rest.split("/").filter(Boolean)[0];
  return batch;
}

export async function listSupplierFbdiPackages(deps?: {
  storage?: StorageProvider;
  prefix?: string;
}): Promise<{ provider: string; prefix: string; packages: FbdiSavedPackage[] }> {
  const config = getConfig();
  const storage = deps?.storage ?? getStorageProvider();
  const prefix = (deps?.prefix ?? config.supplierFbdiPrefix).replace(/\/+$/, "") + "/";
  const objects = await storage.list(prefix);
  const byBatch = new Map<string, StoredObject[]>();
  for (const obj of objects) {
    const batch = batchFromKey(obj.key, prefix);
    if (!batch || batch.toLowerCase().endsWith(".csv") || batch.toLowerCase().endsWith(".zip")) {
      continue;
    }
    const list = byBatch.get(batch) ?? [];
    list.push(obj);
    byBatch.set(batch, list);
  }

  const packages: FbdiSavedPackage[] = [];
  for (const [batchId, files] of byBatch) {
    const manifestObj = files.find((f) => f.key.endsWith("/manifest.json"));
    let counts: FbdiBuildResult["counts"] | undefined;
    let createdAt = files.map((f) => f.lastModified).sort().at(-1) ?? new Date().toISOString();
    let actor: string | undefined;
    let scope: FbdiScope | undefined;
    let importAction: FbdiImportAction | undefined;
    if (manifestObj) {
      try {
        const parsed = JSON.parse((await storage.get(manifestObj.key)).toString("utf8")) as {
          createdAt?: string;
          actor?: string;
          scope?: FbdiScope;
          importAction?: FbdiImportAction;
          counts?: FbdiBuildResult["counts"];
        };
        createdAt = parsed.createdAt ?? createdAt;
        actor = parsed.actor;
        scope = parsed.scope;
        importAction = parsed.importAction;
        counts = parsed.counts;
      } catch {
        /* keep inferred metadata */
      }
    }
    packages.push({
      batchId,
      createdAt,
      actor,
      scope,
      importAction,
      prefix: `${prefix}${batchId}/`,
      counts,
      files: files.map((f) => ({
        name: f.key.split("/").pop() ?? f.key,
        key: f.key,
        size: f.size,
        rows: undefined,
      })),
    });
  }

  packages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { provider: storage.name, prefix, packages };
}

export function publicFbdiBuild(result: FbdiBuildResult) {
  return {
    batchId: result.batchId,
    createdAt: result.createdAt,
    actor: result.actor,
    scope: result.scope,
    importAction: result.importAction,
    businessRelationship: result.businessRelationship,
    prefix: result.prefix,
    provider: result.provider,
    usedSampleFallback: result.usedSampleFallback,
    sourceFiles: result.sourceFiles,
    sourceErrors: result.sourceErrors,
    counts: result.counts,
    overlayCount: result.overlays.length,
    overlays: result.overlays.slice(0, 50),
    files: result.files.map((f) => ({ name: f.name, rows: f.rows })),
    zip: FBDI_ZIP_NAME,
    preview: result.preview,
  };
}

export function isFbdiDownloadKey(key: string, prefix: string): boolean {
  const normalised = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return key.startsWith(normalised) && !key.includes("..");
}

/** Parse a generated FBDI CSV back into row objects (headers lower-cased). */
export function parseFbdiCsv(csv: string): Record<string, string>[] {
  return parseCsv(csv);
}
