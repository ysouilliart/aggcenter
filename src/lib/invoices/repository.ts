import { promises as fs } from "fs";
import path from "path";

import { eq } from "drizzle-orm";

import { isDatabaseConfigured } from "../db/client";
import type {
  ClassifiedField,
  InvoiceBankDetails,
  InvoiceFolder,
  InvoiceLineItem,
  InvoiceTaxLine,
} from "../parse/invoice/types";
import type { InvoiceConfirmEvent, InvoiceParseJob, InvoiceRecord, InvoiceSummary } from "./types";
import { INVOICE_FOLDERS } from "./types";

export interface InvoiceSnapshot {
  invoices: InvoiceRecord[];
  lineItems: Record<string, InvoiceLineItem[]>;
  taxLines: Record<string, InvoiceTaxLine[]>;
  bank: Record<string, InvoiceBankDetails>;
  fields: Record<string, ClassifiedField[]>;
  jobs: Record<string, InvoiceParseJob>;
  confirmEvents: Record<string, InvoiceConfirmEvent[]>;
}

export interface InvoiceRepository {
  readonly name: string;
  saveParsed(input: {
    invoice: InvoiceRecord;
    lineItems: InvoiceLineItem[];
    taxLines: InvoiceTaxLine[];
    bank?: InvoiceBankDetails;
    fields: ClassifiedField[];
    job: InvoiceParseJob;
  }): Promise<void>;
  list(filter?: { folder?: InvoiceFolder; parseStatus?: string }): Promise<InvoiceRecord[]>;
  get(id: string): Promise<{
    invoice: InvoiceRecord;
    lineItems: InvoiceLineItem[];
    taxLines: InvoiceTaxLine[];
    bank?: InvoiceBankDetails;
    fields: ClassifiedField[];
    job: InvoiceParseJob | null;
    confirmEvents: InvoiceConfirmEvent[];
  } | undefined>;
  findByHash(hash: string): Promise<InvoiceRecord | undefined>;
  findByOriginalKey(key: string): Promise<InvoiceRecord | undefined>;
  updateFolder(
    id: string,
    folder: InvoiceFolder,
    patch?: Partial<Pick<InvoiceRecord, "storageKey" | "archivedAt" | "parseStatus">>,
  ): Promise<InvoiceRecord | undefined>;
  saveConfirm(input: {
    invoice: InvoiceRecord;
    events: InvoiceConfirmEvent[];
  }): Promise<{
    invoice: InvoiceRecord;
    lineItems: InvoiceLineItem[];
    taxLines: InvoiceTaxLine[];
    bank?: InvoiceBankDetails;
    fields: ClassifiedField[];
    job: InvoiceParseJob | null;
    confirmEvents: InvoiceConfirmEvent[];
  } | undefined>;
  summary(): Promise<InvoiceSummary>;
}

function empty(): InvoiceSnapshot {
  return { invoices: [], lineItems: {}, taxLines: {}, bank: {}, fields: {}, jobs: {}, confirmEvents: {} };
}

function toSummary(rows: InvoiceRecord[]): InvoiceSummary {
  const byFolder = Object.fromEntries(INVOICE_FOLDERS.map((f) => [f, 0])) as Record<
    InvoiceFolder,
    number
  >;
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    byFolder[row.folder] = (byFolder[row.folder] ?? 0) + 1;
    byStatus[row.parseStatus] = (byStatus[row.parseStatus] ?? 0) + 1;
  }
  return {
    total: rows.length,
    byFolder,
    byStatus,
    needsReview: byFolder.anomaly,
    parsed: (byStatus.parsed ?? 0) + (byStatus.partial ?? 0),
  };
}

export class LocalJsonInvoiceRepository implements InvoiceRepository {
  readonly name = "local-json";
  constructor(private readonly file = path.join(process.cwd(), ".data", "invoices.json")) {}

  private async read(): Promise<InvoiceSnapshot> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<InvoiceSnapshot>;
      return { ...empty(), ...parsed, confirmEvents: parsed.confirmEvents ?? {} };
    } catch {
      return empty();
    }
  }

  private async write(snap: InvoiceSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(snap, null, 2), "utf8");
  }

  async saveParsed(input: {
    invoice: InvoiceRecord;
    lineItems: InvoiceLineItem[];
    taxLines: InvoiceTaxLine[];
    bank?: InvoiceBankDetails;
    fields: ClassifiedField[];
    job: InvoiceParseJob;
  }): Promise<void> {
    const snap = await this.read();
    snap.invoices = snap.invoices.filter((r) => r.id !== input.invoice.id);
    snap.invoices.unshift(input.invoice);
    snap.lineItems[input.invoice.id] = input.lineItems;
    snap.taxLines[input.invoice.id] = input.taxLines;
    if (input.bank) snap.bank[input.invoice.id] = input.bank;
    else delete snap.bank[input.invoice.id];
    snap.fields[input.invoice.id] = input.fields;
    snap.jobs[input.invoice.id] = input.job;
    if (!snap.confirmEvents[input.invoice.id]) snap.confirmEvents[input.invoice.id] = [];
    await this.write(snap);
  }

  async list(filter?: { folder?: InvoiceFolder; parseStatus?: string }) {
    let rows = (await this.read()).invoices;
    if (filter?.folder) rows = rows.filter((r) => r.folder === filter.folder);
    if (filter?.parseStatus) rows = rows.filter((r) => r.parseStatus === filter.parseStatus);
    return rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async get(id: string) {
    const snap = await this.read();
    const invoice = snap.invoices.find((r) => r.id === id);
    if (!invoice) return undefined;
    return {
      invoice,
      lineItems: snap.lineItems[id] ?? [],
      taxLines: snap.taxLines[id] ?? [],
      bank: snap.bank[id],
      fields: snap.fields[id] ?? [],
      job: snap.jobs[id] ?? null,
      confirmEvents: snap.confirmEvents[id] ?? [],
    };
  }

  async findByHash(hash: string) {
    return (await this.read()).invoices.find((r) => r.contentHash === hash);
  }

  async findByOriginalKey(key: string) {
    return (await this.read()).invoices.find((r) => r.originalKey === key);
  }

  async updateFolder(
    id: string,
    folder: InvoiceFolder,
    patch?: Partial<Pick<InvoiceRecord, "storageKey" | "archivedAt" | "parseStatus">>,
  ) {
    const snap = await this.read();
    const idx = snap.invoices.findIndex((r) => r.id === id);
    if (idx < 0) return undefined;
    snap.invoices[idx] = { ...snap.invoices[idx], folder, ...patch };
    await this.write(snap);
    return snap.invoices[idx];
  }

  async saveConfirm(input: { invoice: InvoiceRecord; events: InvoiceConfirmEvent[] }) {
    const snap = await this.read();
    const idx = snap.invoices.findIndex((r) => r.id === input.invoice.id);
    if (idx < 0) return undefined;
    snap.invoices[idx] = input.invoice;
    const existing = snap.confirmEvents[input.invoice.id] ?? [];
    snap.confirmEvents[input.invoice.id] = [...input.events, ...existing];
    await this.write(snap);
    return this.get(input.invoice.id);
  }

  async summary() {
    return toSummary(await this.list());
  }
}

function qty(value: number | undefined): string | null {
  return value == null ? null : String(value);
}

function parseQty(value: string | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function extra(value: Record<string, string> | undefined): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}

function parseExtra(value: string | null | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return undefined;
  }
}

export class PostgresInvoiceRepository implements InvoiceRepository {
  readonly name = "postgres";

  async saveParsed(input: {
    invoice: InvoiceRecord;
    lineItems: InvoiceLineItem[];
    taxLines: InvoiceTaxLine[];
    bank?: InvoiceBankDetails;
    fields: ClassifiedField[];
    job: InvoiceParseJob;
  }): Promise<void> {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const inv = input.invoice;
    await db.transaction(async (tx) => {
      const existingJobs = await tx
        .select({ id: schema.invoiceParseJobs.id })
        .from(schema.invoiceParseJobs)
        .where(eq(schema.invoiceParseJobs.invoiceId, inv.id));
      for (const job of existingJobs) {
        await tx
          .delete(schema.invoiceParseEvents)
          .where(eq(schema.invoiceParseEvents.jobId, job.id));
      }
      await tx.delete(schema.invoiceParseJobs).where(eq(schema.invoiceParseJobs.invoiceId, inv.id));
      await tx.delete(schema.invoiceFields).where(eq(schema.invoiceFields.invoiceId, inv.id));
      await tx.delete(schema.invoiceBankDetails).where(eq(schema.invoiceBankDetails.invoiceId, inv.id));
      await tx.delete(schema.invoiceTaxLines).where(eq(schema.invoiceTaxLines.invoiceId, inv.id));
      await tx.delete(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, inv.id));
      await tx.delete(schema.invoices).where(eq(schema.invoices.id, inv.id));

      await tx.insert(schema.invoices).values({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber ?? "",
        invoiceDate: inv.invoiceDate ?? null,
        issueDate: inv.issueDate ?? null,
        dueDate: inv.dueDate ?? null,
        paymentTerms: inv.paymentTerms ?? null,
        currency: inv.currency ?? "",
        subtotal: inv.subtotal ?? null,
        taxTotal: inv.taxTotal ?? null,
        total: inv.total ?? null,
        amountDue: inv.amountDue ?? null,
        poNumber: inv.poNumber ?? null,
        accountNumber: inv.accountNumber ?? null,
        referenceNumber: inv.referenceNumber ?? null,
        customerNumber: inv.customerNumber ?? null,
        customerName: inv.customerName ?? null,
        customerAddress: inv.customerAddress ?? null,
        customerEmail: inv.customerEmail ?? null,
        supplierName: inv.supplierName ?? "",
        supplierLegalName: inv.supplierLegalName ?? null,
        supplierTaxId: inv.supplierTaxId ?? null,
        supplierVat: inv.supplierVat ?? null,
        supplierAddress: inv.supplierAddress ?? null,
        supplierCountry: inv.supplierCountry ?? null,
        supplierEmail: inv.supplierEmail ?? null,
        supplierPhone: inv.supplierPhone ?? null,
        supplierWebsite: inv.supplierWebsite ?? null,
        notes: inv.notes ?? null,
        extraJson: null,
        fileName: inv.fileName,
        mimeType: inv.mimeType,
        contentHash: inv.contentHash,
        source: inv.source,
        folder: inv.folder,
        storageKey: inv.storageKey ?? null,
        originalKey: inv.originalKey ?? null,
        parseStatus: inv.parseStatus,
        parserId: inv.parserId ?? null,
        parserVersion: inv.parserVersion ?? null,
        vendor: inv.vendor ?? null,
        confidence: inv.confidence,
        pageCount: inv.pageCount ?? null,
        reviewReason: inv.reviewReason ?? null,
        extractedText: inv.extractedText ?? null,
        classifyMode: inv.classifyMode ?? null,
        classifierWarning: inv.classifierWarning ?? null,
        needsConfirm: inv.needsConfirm ?? false,
        confirmedAt: inv.confirmedAt ?? null,
        confirmedBy: inv.confirmedBy ?? null,
        confirmAction: inv.confirmAction ?? null,
        uploadedAt: inv.uploadedAt,
        processedAt: inv.processedAt ?? null,
        archivedAt: inv.archivedAt ?? null,
      });

      if (input.lineItems.length) {
        await tx.insert(schema.invoiceLineItems).values(
          input.lineItems.map((line, i) => ({
            id: `${inv.id}-L${line.lineNumber || i + 1}`,
            invoiceId: inv.id,
            lineNumber: line.lineNumber,
            description: line.description,
            quantity: qty(line.quantity),
            unit: line.unit ?? null,
            unitPrice: line.unitPrice ?? null,
            taxRate: line.taxRate ?? null,
            taxAmount: line.taxAmount ?? null,
            lineTotal: line.lineTotal ?? null,
            periodStart: line.periodStart ?? null,
            periodEnd: line.periodEnd ?? null,
            extraJson: extra(line.extra),
          })),
        );
      }
      if (input.taxLines.length) {
        await tx.insert(schema.invoiceTaxLines).values(
          input.taxLines.map((line, i) => ({
            id: `${inv.id}-T${i + 1}`,
            invoiceId: inv.id,
            label: line.label,
            rate: line.rate ?? null,
            taxableAmount: line.taxableAmount ?? null,
            taxAmount: line.taxAmount ?? null,
          })),
        );
      }
      if (input.bank) {
        await tx.insert(schema.invoiceBankDetails).values({
          id: `${inv.id}-BANK`,
          invoiceId: inv.id,
          bankName: input.bank.bankName ?? null,
          accountName: input.bank.accountName ?? null,
          accountNumber: input.bank.accountNumber ?? null,
          bsb: input.bank.bsb ?? null,
          iban: input.bank.iban ?? null,
          bic: input.bank.bic ?? null,
          billerCode: input.bank.billerCode ?? null,
          bpayReference: input.bank.bpayReference ?? null,
          paymentMethod: input.bank.paymentMethod ?? null,
          extraJson: extra(input.bank.extra),
        });
      }
      if (input.fields.length) {
        await tx.insert(schema.invoiceFields).values(
          input.fields.map((f, i) => ({
            id: `${inv.id}-F${i + 1}`,
            invoiceId: inv.id,
            category: f.category,
            key: f.key,
            value: f.value,
            confidence: f.confidence,
          })),
        );
      }
      await tx.insert(schema.invoiceParseJobs).values({
        id: input.job.id,
        invoiceId: inv.id,
        storageKey: input.job.storageKey ?? null,
        parserId: input.job.parserId,
        parserVersion: input.job.parserVersion,
        status: input.job.status,
        startedAt: input.job.startedAt,
        finishedAt: input.job.finishedAt,
        lineItemCount: input.job.lineItemCount,
        warningCount: input.job.warningCount,
        pageCount: input.job.pageCount,
        confidence: input.job.confidence,
      });
      if (input.job.events.length) {
        await tx.insert(schema.invoiceParseEvents).values(
          input.job.events.map((ev) => ({
            id: `${input.job.id}-E${ev.seq}`,
            jobId: input.job.id,
            seq: ev.seq,
            level: ev.level,
            stage: ev.stage,
            message: ev.message,
            page: ev.page ?? null,
            detail: ev.detail ? JSON.stringify(ev.detail) : null,
          })),
        );
      }
    });
  }

  async list(filter?: { folder?: InvoiceFolder; parseStatus?: string }) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const rows = await db.select().from(schema.invoices);
    return rows
      .map(rowToInvoice)
      .filter((r) => (filter?.folder ? r.folder === filter.folder : true))
      .filter((r) => (filter?.parseStatus ? r.parseStatus === filter.parseStatus : true))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async get(id: string) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id));
    if (!row) return undefined;
    const [lines, taxes, banks, fields, jobs, confirmRows] = await Promise.all([
      db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, id)),
      db.select().from(schema.invoiceTaxLines).where(eq(schema.invoiceTaxLines.invoiceId, id)),
      db.select().from(schema.invoiceBankDetails).where(eq(schema.invoiceBankDetails.invoiceId, id)),
      db.select().from(schema.invoiceFields).where(eq(schema.invoiceFields.invoiceId, id)),
      db.select().from(schema.invoiceParseJobs).where(eq(schema.invoiceParseJobs.invoiceId, id)),
      db.select().from(schema.invoiceConfirmEvents).where(eq(schema.invoiceConfirmEvents.invoiceId, id)),
    ]);
    const jobRow = jobs[0];
    const events = jobRow
      ? await db
          .select()
          .from(schema.invoiceParseEvents)
          .where(eq(schema.invoiceParseEvents.jobId, jobRow.id))
      : [];
    return {
      invoice: rowToInvoice(row),
      lineItems: lines
        .sort((a, b) => a.lineNumber - b.lineNumber)
        .map((l) => ({
          lineNumber: l.lineNumber,
          description: l.description,
          quantity: parseQty(l.quantity),
          unit: l.unit ?? undefined,
          unitPrice: l.unitPrice ?? undefined,
          taxRate: l.taxRate ?? undefined,
          taxAmount: l.taxAmount ?? undefined,
          lineTotal: l.lineTotal ?? undefined,
          periodStart: l.periodStart ?? undefined,
          periodEnd: l.periodEnd ?? undefined,
          extra: parseExtra(l.extraJson),
        })),
      taxLines: taxes.map((t) => ({
        label: t.label,
        rate: t.rate ?? undefined,
        taxableAmount: t.taxableAmount ?? undefined,
        taxAmount: t.taxAmount ?? undefined,
      })),
      bank: banks[0]
        ? {
            bankName: banks[0].bankName ?? undefined,
            accountName: banks[0].accountName ?? undefined,
            accountNumber: banks[0].accountNumber ?? undefined,
            bsb: banks[0].bsb ?? undefined,
            iban: banks[0].iban ?? undefined,
            bic: banks[0].bic ?? undefined,
            billerCode: banks[0].billerCode ?? undefined,
            bpayReference: banks[0].bpayReference ?? undefined,
            paymentMethod: banks[0].paymentMethod ?? undefined,
            extra: parseExtra(banks[0].extraJson),
          }
        : undefined,
      fields: fields.map((f) => ({
        category: f.category as ClassifiedField["category"],
        key: f.key,
        value: f.value,
        confidence: f.confidence,
      })),
      job: jobRow
        ? {
            id: jobRow.id,
            invoiceId: jobRow.invoiceId,
            storageKey: jobRow.storageKey ?? undefined,
            parserId: jobRow.parserId,
            parserVersion: jobRow.parserVersion,
            status: jobRow.status as InvoiceParseJob["status"],
            startedAt: jobRow.startedAt,
            finishedAt: jobRow.finishedAt,
            lineItemCount: jobRow.lineItemCount,
            warningCount: jobRow.warningCount,
            pageCount: jobRow.pageCount,
            confidence: jobRow.confidence,
            events: events
              .sort((a, b) => a.seq - b.seq)
              .map((e) => ({
                seq: e.seq,
                level: e.level as InvoiceParseJob["events"][number]["level"],
                stage: e.stage,
                message: e.message,
                page: e.page ?? undefined,
                detail: e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : undefined,
              })),
          }
        : null,
      confirmEvents: confirmRows
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map((e) => ({
          id: e.id,
          invoiceId: e.invoiceId,
          action: e.action as InvoiceConfirmEvent["action"],
          field: e.field ?? undefined,
          oldValue: e.oldValue ?? undefined,
          newValue: e.newValue ?? undefined,
          actor: e.actor,
          reason: e.reason ?? undefined,
          createdAt: e.createdAt,
        })),
    };
  }

  async findByHash(hash: string) {
    const rows = await this.list();
    return rows.find((r) => r.contentHash === hash);
  }

  async findByOriginalKey(key: string) {
    const rows = await this.list();
    return rows.find((r) => r.originalKey === key);
  }

  async updateFolder(
    id: string,
    folder: InvoiceFolder,
    patch?: Partial<Pick<InvoiceRecord, "storageKey" | "archivedAt" | "parseStatus">>,
  ) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const set: Record<string, unknown> = { folder };
    if (patch?.storageKey !== undefined) set.storageKey = patch.storageKey;
    if (patch?.archivedAt !== undefined) set.archivedAt = patch.archivedAt;
    if (patch?.parseStatus !== undefined) set.parseStatus = patch.parseStatus;
    await db.update(schema.invoices).set(set).where(eq(schema.invoices.id, id));
    const detail = await this.get(id);
    return detail?.invoice;
  }

  async saveConfirm(input: { invoice: InvoiceRecord; events: InvoiceConfirmEvent[] }) {
    const { getDb } = await import("../db/client");
    const schema = await import("../db/schema");
    const db = getDb();
    const inv = input.invoice;
    await db.transaction(async (tx) => {
      await tx
        .update(schema.invoices)
        .set({
          invoiceNumber: inv.invoiceNumber ?? "",
          invoiceDate: inv.invoiceDate ?? null,
          dueDate: inv.dueDate ?? null,
          paymentTerms: inv.paymentTerms ?? null,
          currency: inv.currency ?? "",
          subtotal: inv.subtotal ?? null,
          taxTotal: inv.taxTotal ?? null,
          total: inv.total ?? null,
          amountDue: inv.amountDue ?? null,
          poNumber: inv.poNumber ?? null,
          notes: inv.notes ?? null,
          supplierName: inv.supplierName ?? "",
          folder: inv.folder,
          storageKey: inv.storageKey ?? null,
          parseStatus: inv.parseStatus,
          reviewReason: inv.reviewReason ?? null,
          needsConfirm: inv.needsConfirm ?? false,
          confirmedAt: inv.confirmedAt ?? null,
          confirmedBy: inv.confirmedBy ?? null,
          confirmAction: inv.confirmAction ?? null,
          processedAt: inv.processedAt ?? null,
        })
        .where(eq(schema.invoices.id, inv.id));
      if (input.events.length) {
        await tx.insert(schema.invoiceConfirmEvents).values(
          input.events.map((e) => ({
            id: e.id,
            invoiceId: e.invoiceId,
            action: e.action,
            field: e.field ?? null,
            oldValue: e.oldValue ?? null,
            newValue: e.newValue ?? null,
            actor: e.actor,
            reason: e.reason ?? null,
            createdAt: e.createdAt,
          })),
        );
      }
    });
    return this.get(inv.id);
  }

  async summary() {
    return toSummary(await this.list());
  }
}

function rowToInvoice(row: import("../db/schema").InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber || undefined,
    invoiceDate: row.invoiceDate ?? undefined,
    issueDate: row.issueDate ?? undefined,
    dueDate: row.dueDate ?? undefined,
    paymentTerms: row.paymentTerms ?? undefined,
    currency: row.currency || undefined,
    subtotal: row.subtotal ?? undefined,
    taxTotal: row.taxTotal ?? undefined,
    total: row.total ?? undefined,
    amountDue: row.amountDue ?? undefined,
    poNumber: row.poNumber ?? undefined,
    accountNumber: row.accountNumber ?? undefined,
    referenceNumber: row.referenceNumber ?? undefined,
    customerNumber: row.customerNumber ?? undefined,
    customerName: row.customerName ?? undefined,
    customerAddress: row.customerAddress ?? undefined,
    customerEmail: row.customerEmail ?? undefined,
    supplierName: row.supplierName || undefined,
    supplierLegalName: row.supplierLegalName ?? undefined,
    supplierTaxId: row.supplierTaxId ?? undefined,
    supplierVat: row.supplierVat ?? undefined,
    supplierAddress: row.supplierAddress ?? undefined,
    supplierCountry: row.supplierCountry ?? undefined,
    supplierEmail: row.supplierEmail ?? undefined,
    supplierPhone: row.supplierPhone ?? undefined,
    supplierWebsite: row.supplierWebsite ?? undefined,
    notes: row.notes ?? undefined,
    fileName: row.fileName,
    mimeType: row.mimeType,
    contentHash: row.contentHash,
    source: row.source as InvoiceRecord["source"],
    folder: row.folder as InvoiceFolder,
    storageKey: row.storageKey ?? undefined,
    originalKey: row.originalKey ?? undefined,
    parseStatus: row.parseStatus as InvoiceRecord["parseStatus"],
    parserId: row.parserId ?? undefined,
    parserVersion: row.parserVersion ?? undefined,
    vendor: (row.vendor as InvoiceRecord["vendor"]) ?? undefined,
    confidence: row.confidence,
    pageCount: row.pageCount ?? undefined,
    reviewReason: row.reviewReason ?? undefined,
    extractedText: row.extractedText ?? undefined,
    classifyMode: (row.classifyMode as InvoiceRecord["classifyMode"]) ?? undefined,
    classifierWarning: row.classifierWarning ?? undefined,
    needsConfirm: Boolean(row.needsConfirm),
    confirmedAt: row.confirmedAt ?? undefined,
    confirmedBy: row.confirmedBy ?? undefined,
    confirmAction: (row.confirmAction as InvoiceRecord["confirmAction"]) ?? undefined,
    uploadedAt: row.uploadedAt,
    processedAt: row.processedAt ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    lineItemCount: 0,
  };
}

let cached: InvoiceRepository | null = null;

export function resetInvoiceRepositoryCache(): void {
  cached = null;
}

export function getInvoiceRepository(): InvoiceRepository {
  if (cached) return cached;
  cached = isDatabaseConfigured()
    ? new PostgresInvoiceRepository()
    : new LocalJsonInvoiceRepository();
  return cached;
}
