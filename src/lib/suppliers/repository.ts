import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { isDatabaseConfigured } from "../db/client";
import {
  SITE_FIELDS,
  SUPPLIER_HEADER_FIELDS,
  type Supplier,
  type SupplierAuditAction,
  type SupplierAuditEvent,
  type SupplierPatchField,
  type SupplierRecordType,
  type SupplierSite,
  type SupplierStatus,
  type SupplierUpdateInput,
  type SupplierVatCheck,
  type SupplierVersion,
  type VatCheckValidity,
  type VatDetailMatch,
} from "./types";

export type { SupplierUpdateInput };

export interface SupplierSnapshot {
  suppliers: Supplier[];
  sites: SupplierSite[];
  versions: SupplierVersion[];
  audit: SupplierAuditEvent[];
  vatChecks: SupplierVatCheck[];
  files: { key: string; rows: number }[];
  ingestedAt?: string;
}

export interface SupplierRepository {
  readonly name: string;
  replaceWorkingCopy(
    snapshot: { suppliers: Supplier[]; sites: SupplierSite[]; files: { key: string; rows: number }[] },
    actor?: string,
  ): Promise<void>;
  listSuppliers(): Promise<Supplier[]>;
  listSites(): Promise<SupplierSite[]>;
  getSite(id: string): Promise<SupplierSite | undefined>;
  getSupplier(id: string): Promise<Supplier | undefined>;
  listVersions(recordType?: SupplierRecordType, recordId?: string): Promise<SupplierVersion[]>;
  listAudit(recordId?: string): Promise<SupplierAuditEvent[]>;
  listVatChecks(siteId?: string): Promise<SupplierVatCheck[]>;
  saveVatCheck(check: SupplierVatCheck): Promise<void>;
  meta(): Promise<{ files: { key: string; rows: number }[]; ingestedAt?: string }>;
  updateRecord(siteId: string, input: SupplierUpdateInput): Promise<{
    supplier: Supplier;
    site: SupplierSite;
    audit: SupplierAuditEvent[];
  }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function asStatus(value: string): SupplierStatus {
  return value === "inactive" ? "inactive" : "active";
}

function empty(): SupplierSnapshot {
  return { suppliers: [], sites: [], versions: [], audit: [], vatChecks: [], files: [] };
}

export class LocalJsonSupplierRepository implements SupplierRepository {
  readonly name = "local-json";
  constructor(private readonly file = path.join(process.cwd(), ".data", "suppliers.json")) {}

  private async read(): Promise<SupplierSnapshot> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<SupplierSnapshot>;
      return {
        ...empty(),
        ...parsed,
        vatChecks: parsed.vatChecks ?? [],
      };
    } catch {
      return empty();
    }
  }

  private async write(snap: SupplierSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(snap, null, 2), "utf8");
  }

  async replaceWorkingCopy(
    incoming: { suppliers: Supplier[]; sites: SupplierSite[]; files: { key: string; rows: number }[] },
    actor = "ingest",
  ): Promise<void> {
    const snap = await this.read();
    const createdAt = nowIso();
    snap.suppliers = incoming.suppliers;
    snap.sites = incoming.sites;
    snap.files = incoming.files;
    snap.ingestedAt = createdAt;
    snap.audit.unshift({
      id: newId("AUD"),
      recordType: "supplier",
      recordId: "*",
      action: "ingest",
      newValue: JSON.stringify({
        suppliers: incoming.suppliers.length,
        sites: incoming.sites.length,
        files: incoming.files.length,
      }),
      actor,
      reason: "Reload working copy from object storage",
      createdAt,
      version: 1,
    });
    await this.write(snap);
  }

  async listSuppliers() {
    return (await this.read()).suppliers;
  }
  async listSites() {
    return (await this.read()).sites;
  }
  async getSite(id: string) {
    return (await this.read()).sites.find((s) => s.id === id);
  }
  async getSupplier(id: string) {
    return (await this.read()).suppliers.find((s) => s.id === id);
  }
  async listVersions(recordType?: SupplierRecordType, recordId?: string) {
    let rows = (await this.read()).versions;
    if (recordType) rows = rows.filter((v) => v.recordType === recordType);
    if (recordId) rows = rows.filter((v) => v.recordId === recordId);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async listAudit(recordId?: string) {
    let rows = (await this.read()).audit;
    if (recordId) rows = rows.filter((e) => e.recordId === recordId || e.recordId === "*");
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async meta() {
    const snap = await this.read();
    return { files: snap.files, ingestedAt: snap.ingestedAt };
  }

  async listVatChecks(siteId?: string) {
    const rows = (await this.read()).vatChecks;
    const filtered = siteId ? rows.filter((c) => c.siteId === siteId) : rows;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveVatCheck(check: SupplierVatCheck) {
    const snap = await this.read();
    snap.vatChecks.unshift(check);
    await this.write(snap);
  }

  async updateRecord(siteId: string, input: SupplierUpdateInput) {
    const snap = await this.read();
    const siteIdx = snap.sites.findIndex((s) => s.id === siteId);
    if (siteIdx < 0) throw new Error(`Site ${siteId} not found.`);
    const site = snap.sites[siteIdx];
    const supplierIdx = snap.suppliers.findIndex((s) => s.id === site.supplierId);
    if (supplierIdx < 0) throw new Error(`Supplier ${site.supplierId} not found.`);
    const supplier = snap.suppliers[supplierIdx];
    const result = applyUpdate(supplier, site, input);
    snap.suppliers[supplierIdx] = result.supplier;
    snap.sites[siteIdx] = result.site;
    snap.versions.unshift(...result.versions);
    snap.audit.unshift(...result.audit);
    await this.write(snap);
    return { supplier: result.supplier, site: result.site, audit: result.audit };
  }
}

const BATCH = 400;

export class PostgresSupplierRepository implements SupplierRepository {
  readonly name = "postgres";

  async replaceWorkingCopy(
    incoming: { suppliers: Supplier[]; sites: SupplierSite[]; files: { key: string; rows: number }[] },
    actor = "ingest",
  ): Promise<void> {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const createdAt = nowIso();
    await db.transaction(async (tx) => {
      await tx.delete(schema.supplierSites);
      await tx.delete(schema.suppliers);
      for (let i = 0; i < incoming.suppliers.length; i += BATCH) {
        const chunk = incoming.suppliers.slice(i, i + BATCH).map(supplierInsert);
        if (chunk.length) await tx.insert(schema.suppliers).values(chunk);
      }
      for (let i = 0; i < incoming.sites.length; i += BATCH) {
        const chunk = incoming.sites.slice(i, i + BATCH).map(siteInsert);
        if (chunk.length) await tx.insert(schema.supplierSites).values(chunk);
      }
      await tx.insert(schema.supplierAuditEvents).values({
        id: newId("AUD"),
        recordType: "supplier",
        recordId: "*",
        action: "ingest",
        field: "files",
        newValue: JSON.stringify({
          suppliers: incoming.suppliers.length,
          sites: incoming.sites.length,
          files: incoming.files,
        }),
        actor,
        reason: "Reload working copy from object storage",
        createdAt,
        version: 1,
      });
    });
  }

  async listSuppliers(): Promise<Supplier[]> {
    const { getDb } = await import("../db/client");
    const { suppliers } = await import("../db/schema");
    const rows = await getDb().select().from(suppliers);
    return rows.map(supplierFromRow);
  }

  async listSites(): Promise<SupplierSite[]> {
    const { getDb } = await import("../db/client");
    const { supplierSites } = await import("../db/schema");
    const rows = await getDb().select().from(supplierSites);
    return rows.map(siteFromRow);
  }

  async getSite(id: string) {
    const { getDb } = await import("../db/client");
    const { supplierSites } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await getDb().select().from(supplierSites).where(eq(supplierSites.id, id));
    return rows[0] ? siteFromRow(rows[0]) : undefined;
  }

  async getSupplier(id: string) {
    const { getDb } = await import("../db/client");
    const { suppliers } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await getDb().select().from(suppliers).where(eq(suppliers.id, id));
    return rows[0] ? supplierFromRow(rows[0]) : undefined;
  }

  async listVersions(recordType?: SupplierRecordType, recordId?: string) {
    const { getDb } = await import("../db/client");
    const { supplierRecordVersions } = await import("../db/schema");
    const { and, desc, eq } = await import("drizzle-orm");
    const db = getDb();
    const filters = [];
    if (recordType) filters.push(eq(supplierRecordVersions.recordType, recordType));
    if (recordId) filters.push(eq(supplierRecordVersions.recordId, recordId));
    const rows = await db
      .select()
      .from(supplierRecordVersions)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(supplierRecordVersions.createdAt));
    return rows.map(versionFromRow);
  }

  async listAudit(recordId?: string) {
    const { getDb } = await import("../db/client");
    const { supplierAuditEvents } = await import("../db/schema");
    const { desc, eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = recordId
      ? await db
          .select()
          .from(supplierAuditEvents)
          .where(eq(supplierAuditEvents.recordId, recordId))
          .orderBy(desc(supplierAuditEvents.createdAt))
      : await db.select().from(supplierAuditEvents).orderBy(desc(supplierAuditEvents.createdAt));
    return rows.map(auditFromRow);
  }

  async meta() {
    const events = await this.listAudit("*");
    const ingest = events.find((e) => e.action === "ingest");
    let files: { key: string; rows: number }[] = [];
    if (ingest?.newValue) {
      try {
        const parsed = JSON.parse(ingest.newValue) as {
          files?: { key: string; rows: number }[];
        };
        files = parsed.files ?? [];
      } catch {
        files = [];
      }
    }
    return { files, ingestedAt: ingest?.createdAt };
  }

  async listVatChecks(siteId?: string): Promise<SupplierVatCheck[]> {
    const { getDb } = await import("../db/client");
    const { supplierVatChecks } = await import("../db/schema");
    const { desc, eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = siteId
      ? await db
          .select()
          .from(supplierVatChecks)
          .where(eq(supplierVatChecks.siteId, siteId))
          .orderBy(desc(supplierVatChecks.createdAt))
      : await db.select().from(supplierVatChecks).orderBy(desc(supplierVatChecks.createdAt));
    return rows.map(vatCheckFromRow);
  }

  async saveVatCheck(check: SupplierVatCheck): Promise<void> {
    const { getDb } = await import("../db/client");
    const { supplierVatChecks } = await import("../db/schema");
    await getDb().insert(supplierVatChecks).values(vatCheckInsert(check));
  }

  async updateRecord(siteId: string, input: SupplierUpdateInput) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const site = await this.getSite(siteId);
    if (!site) throw new Error(`Site ${siteId} not found.`);
    const supplier = await this.getSupplier(site.supplierId);
    if (!supplier) throw new Error(`Supplier ${site.supplierId} not found.`);
    const result = applyUpdate(supplier, site, input);

    await db.transaction(async (tx) => {
      await tx
        .update(schema.suppliers)
        .set(supplierInsert(result.supplier))
        .where(eq(schema.suppliers.id, result.supplier.id));
      await tx
        .update(schema.supplierSites)
        .set(siteInsert(result.site))
        .where(eq(schema.supplierSites.id, result.site.id));
      if (result.versions.length) {
        await tx.insert(schema.supplierRecordVersions).values(
          result.versions.map((v) => ({
            id: v.id,
            recordType: v.recordType,
            recordId: v.recordId,
            version: v.version,
            snapshot: JSON.stringify(v.snapshot),
            createdAt: v.createdAt,
            actor: v.actor,
            reason: v.reason ?? null,
          })),
        );
      }
      if (result.audit.length) {
        await tx.insert(schema.supplierAuditEvents).values(
          result.audit.map((e) => ({
            id: e.id,
            recordType: e.recordType,
            recordId: e.recordId,
            action: e.action,
            field: e.field ?? null,
            oldValue: e.oldValue ?? null,
            newValue: e.newValue ?? null,
            actor: e.actor,
            reason: e.reason ?? null,
            createdAt: e.createdAt,
            version: e.version,
          })),
        );
      }
    });

    return { supplier: result.supplier, site: result.site, audit: result.audit };
  }
}

function supplierInsert(s: Supplier) {
  return {
    id: s.id,
    supplierNumber: s.supplierNumber,
    name: s.name,
    type: s.type,
    status: s.status,
    supplierVat: s.supplierVat,
    taxRegistrationNumber: s.taxRegistrationNumber,
    taxpayerId: s.taxpayerId,
    oneTime: s.oneTime ? "Y" : "N",
    inactiveDate: s.inactiveDate ?? null,
    source: s.source,
    version: s.version,
    updatedAt: s.updatedAt,
  };
}

function siteInsert(s: SupplierSite) {
  return {
    id: s.id,
    supplierId: s.supplierId,
    siteCode: s.siteCode,
    addressName: s.addressName,
    procurementBu: s.procurementBu,
    operatingUnit: s.operatingUnit ?? null,
    inactiveDate: s.inactiveDate ?? null,
    paymentTerms: s.paymentTerms,
    payGroup: s.payGroup,
    paymentMethod: s.paymentMethod,
    invoiceCurrency: s.invoiceCurrency,
    paymentCurrency: s.paymentCurrency,
    country: s.country,
    addressLine1: s.addressLine1,
    addressLine2: s.addressLine2 ?? null,
    city: s.city,
    state: s.state ?? null,
    province: s.province ?? null,
    county: s.county ?? null,
    postalCode: s.postalCode,
    siteVat: s.siteVat,
    email: s.email ?? null,
    source: s.source,
    version: s.version,
    updatedAt: s.updatedAt,
  };
}

function supplierFromRow(r: {
  id: string;
  supplierNumber: string;
  name: string;
  type: string;
  status: string;
  supplierVat: string;
  taxRegistrationNumber: string;
  taxpayerId: string;
  oneTime: string;
  inactiveDate: string | null;
  source: string;
  version: number;
  updatedAt: string;
}): Supplier {
  return {
    id: r.id,
    supplierNumber: r.supplierNumber,
    name: r.name,
    type: r.type,
    status: asStatus(r.status),
    supplierVat: r.supplierVat,
    taxRegistrationNumber: r.taxRegistrationNumber,
    taxpayerId: r.taxpayerId,
    oneTime: r.oneTime === "Y",
    inactiveDate: r.inactiveDate ?? undefined,
    source: r.source,
    version: r.version,
    updatedAt: r.updatedAt,
  };
}

function siteFromRow(r: {
  id: string;
  supplierId: string;
  siteCode: string;
  addressName: string;
  procurementBu: string;
  operatingUnit: string | null;
  inactiveDate: string | null;
  paymentTerms: string;
  payGroup: string;
  paymentMethod: string;
  invoiceCurrency: string;
  paymentCurrency: string;
  country: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  province: string | null;
  county: string | null;
  postalCode: string;
  siteVat: string;
  email: string | null;
  source: string;
  version: number;
  updatedAt: string;
}): SupplierSite {
  return {
    id: r.id,
    supplierId: r.supplierId,
    siteCode: r.siteCode,
    addressName: r.addressName,
    procurementBu: r.procurementBu,
    operatingUnit: r.operatingUnit ?? undefined,
    inactiveDate: r.inactiveDate ?? undefined,
    paymentTerms: r.paymentTerms,
    payGroup: r.payGroup,
    paymentMethod: r.paymentMethod,
    invoiceCurrency: r.invoiceCurrency,
    paymentCurrency: r.paymentCurrency,
    country: r.country,
    addressLine1: r.addressLine1,
    addressLine2: r.addressLine2 ?? undefined,
    city: r.city,
    state: r.state ?? undefined,
    province: r.province ?? undefined,
    county: r.county ?? undefined,
    postalCode: r.postalCode,
    siteVat: r.siteVat,
    email: r.email ?? undefined,
    source: r.source,
    version: r.version,
    updatedAt: r.updatedAt,
  };
}

function versionFromRow(r: {
  id: string;
  recordType: string;
  recordId: string;
  version: number;
  snapshot: string;
  createdAt: string;
  actor: string;
  reason: string | null;
}): SupplierVersion {
  return {
    id: r.id,
    recordType: r.recordType as SupplierRecordType,
    recordId: r.recordId,
    version: r.version,
    snapshot: JSON.parse(r.snapshot) as Supplier | SupplierSite,
    createdAt: r.createdAt,
    actor: r.actor,
    reason: r.reason ?? undefined,
  };
}

function auditFromRow(r: {
  id: string;
  recordType: string;
  recordId: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  actor: string;
  reason: string | null;
  createdAt: string;
  version: number;
}): SupplierAuditEvent {
  return {
    id: r.id,
    recordType: r.recordType as SupplierRecordType,
    recordId: r.recordId,
    action: r.action as SupplierAuditAction,
    field: r.field ?? undefined,
    oldValue: r.oldValue ?? undefined,
    newValue: r.newValue ?? undefined,
    actor: r.actor,
    reason: r.reason ?? undefined,
    createdAt: r.createdAt,
    version: r.version,
  };
}

function vatCheckInsert(c: SupplierVatCheck) {
  return {
    id: c.id,
    siteId: c.siteId,
    supplierId: c.supplierId,
    vatNumber: c.vatNumber,
    vatScope: c.vatScope,
    countryCode: c.countryCode,
    validity: c.validity,
    registeredName: c.registeredName ?? null,
    registeredAddress: c.registeredAddress ?? null,
    requestDate: c.requestDate ?? null,
    nameMatch: c.nameMatch,
    addressMatch: c.addressMatch,
    message: c.message,
    actor: c.actor,
    createdAt: c.createdAt,
  };
}

function vatCheckFromRow(r: {
  id: string;
  siteId: string;
  supplierId: string;
  vatNumber: string;
  vatScope?: string | null;
  countryCode: string;
  validity: string;
  registeredName: string | null;
  registeredAddress: string | null;
  requestDate: string | null;
  nameMatch: string;
  addressMatch: string;
  message: string;
  actor: string;
  createdAt: string;
}): SupplierVatCheck {
  return {
    id: r.id,
    siteId: r.siteId,
    supplierId: r.supplierId,
    vatNumber: r.vatNumber,
    vatScope: r.vatScope === "supplier" ? "supplier" : "site",
    countryCode: r.countryCode,
    validity: r.validity as VatCheckValidity,
    registeredName: r.registeredName ?? undefined,
    registeredAddress: r.registeredAddress ?? undefined,
    requestDate: r.requestDate ?? undefined,
    nameMatch: r.nameMatch as VatDetailMatch,
    addressMatch: r.addressMatch as VatDetailMatch,
    message: r.message,
    actor: r.actor,
    createdAt: r.createdAt,
  };
}

export function applyUpdate(
  supplier: Supplier,
  site: SupplierSite,
  input: SupplierUpdateInput,
): {
  supplier: Supplier;
  site: SupplierSite;
  versions: SupplierVersion[];
  audit: SupplierAuditEvent[];
} {
  const actor = (input.actor ?? "operator").trim() || "operator";
  const reason = input.reason?.trim() || undefined;
  const createdAt = nowIso();
  const nextSupplier = { ...supplier };
  const nextSite = { ...site };
  const versions: SupplierVersion[] = [];
  const audit: SupplierAuditEvent[] = [];

  let supplierChanged = false;
  let siteChanged = false;

  for (const [rawKey, rawValue] of Object.entries(input.fields)) {
    const field = rawKey as SupplierPatchField;
    if (rawValue == null) continue;
    const value = String(rawValue);
    if (SUPPLIER_HEADER_FIELDS.has(field)) {
      const current = String(nextSupplier[field as keyof Supplier] ?? "");
      if (current === value) continue;
      if (!supplierChanged) {
        versions.push({
          id: newId("VER"),
          recordType: "supplier",
          recordId: supplier.id,
          version: supplier.version,
          snapshot: { ...supplier },
          createdAt,
          actor,
          reason,
        });
        supplierChanged = true;
      }
      if (field === "status") nextSupplier.status = asStatus(value);
      else (nextSupplier as unknown as Record<string, string>)[field] = value;
      audit.push(event("supplier", supplier.id, field, current, value, actor, reason, createdAt, supplier.version + 1));
    } else if (SITE_FIELDS.has(field)) {
      const current = String(nextSite[field as keyof SupplierSite] ?? "");
      if (current === value) continue;
      if (!siteChanged) {
        versions.push({
          id: newId("VER"),
          recordType: "site",
          recordId: site.id,
          version: site.version,
          snapshot: { ...site },
          createdAt,
          actor,
          reason,
        });
        siteChanged = true;
      }
      (nextSite as unknown as Record<string, string>)[field] = value;
      audit.push(event("site", site.id, field, current, value, actor, reason, createdAt, site.version + 1));
    }
  }

  if (supplierChanged) {
    nextSupplier.version = supplier.version + 1;
    nextSupplier.updatedAt = createdAt;
  }
  if (siteChanged) {
    nextSite.version = site.version + 1;
    nextSite.updatedAt = createdAt;
  }
  if (!supplierChanged && !siteChanged) {
    throw new Error("No changes to apply.");
  }
  return { supplier: nextSupplier, site: nextSite, versions, audit };
}

function event(
  recordType: SupplierRecordType,
  recordId: string,
  field: string,
  oldValue: string,
  newValue: string,
  actor: string,
  reason: string | undefined,
  createdAt: string,
  version: number,
): SupplierAuditEvent {
  return {
    id: newId("AUD"),
    recordType,
    recordId,
    action: "update",
    field,
    oldValue,
    newValue,
    actor,
    reason,
    createdAt,
    version,
  };
}

let cached: SupplierRepository | null = null;

export function getSupplierRepository(): SupplierRepository {
  if (cached) return cached;
  cached = isDatabaseConfigured()
    ? new PostgresSupplierRepository()
    : new LocalJsonSupplierRepository();
  return cached;
}

/** Test helper. */
export function resetSupplierRepositoryCache(): void {
  cached = null;
}
