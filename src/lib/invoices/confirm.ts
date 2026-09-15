import { createHash } from "crypto";

import { getConfig } from "../config";
import { toCents } from "../money";
import type { InvoiceFolder, InvoiceHeader } from "../parse/invoice/types";
import { getStorageProvider, type StorageProvider } from "../storage";
import { contentTypeForName, DEFAULT_INVOICE_PREFIX, invoiceFolderKey, withTrailingSlash } from "./folders";
import { getInvoiceRepository, type InvoiceRepository } from "./repository";
import type { InvoiceConfirmEvent, InvoiceDetail, InvoiceRecord } from "./types";

export const CONFIRM_HEADER_FIELDS = [
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "supplierName",
  "currency",
  "total",
  "taxTotal",
  "amountDue",
  "subtotal",
  "paymentTerms",
  "poNumber",
  "notes",
] as const;

export type ConfirmHeaderField = (typeof CONFIRM_HEADER_FIELDS)[number];

export type InvoiceConfirmFields = Partial<
  Pick<InvoiceHeader, ConfirmHeaderField> & {
    /** Major-unit amounts accepted from the UI; converted to cents. */
    totalMajor?: number | string;
    taxTotalMajor?: number | string;
    amountDueMajor?: number | string;
    subtotalMajor?: number | string;
  }
>;

export interface ConfirmInvoiceInput {
  action: "accept" | "reject";
  actor?: string;
  reason?: string;
  fields?: InvoiceConfirmFields;
}

function eventId(invoiceId: string, seq: number, nonce: string): string {
  return `INVCE-${createHash("sha1").update(`${invoiceId}:${seq}:${nonce}`).digest("hex").slice(0, 12)}`;
}

function stringify(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function majorToCents(value: number | string | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return toCents(n);
}

export function applyConfirmFields(
  invoice: InvoiceRecord,
  fields: InvoiceConfirmFields | undefined,
): { next: InvoiceRecord; changes: { field: string; from: string; to: string }[] } {
  if (!fields) return { next: invoice, changes: [] };
  const next: InvoiceRecord = { ...invoice };
  const changes: { field: string; from: string; to: string }[] = [];

  const money: Record<string, ConfirmHeaderField> = {
    totalMajor: "total",
    taxTotalMajor: "taxTotal",
    amountDueMajor: "amountDue",
    subtotalMajor: "subtotal",
  };
  const resolved: Record<string, string | number | undefined> = { ...fields };
  for (const [majorKey, dest] of Object.entries(money)) {
    const cents = majorToCents(fields[majorKey as keyof InvoiceConfirmFields] as number | string | undefined);
    if (cents != null) resolved[dest] = cents;
  }

  for (const field of CONFIRM_HEADER_FIELDS) {
    if (!(field in resolved) || resolved[field] === undefined) continue;
    const to = resolved[field];
    const from = invoice[field];
    if (stringify(from) === stringify(to)) continue;
    (next as unknown as Record<string, unknown>)[field] = to;
    changes.push({ field, from: stringify(from), to: stringify(to) });
  }
  if (next.currency) next.currency = next.currency.toUpperCase();
  return { next, changes };
}

async function moveObject(
  storage: StorageProvider,
  invoice: InvoiceRecord,
  destFolder: InvoiceFolder,
  prefix: string,
): Promise<string | undefined> {
  const dest = invoiceFolderKey(prefix, destFolder, invoice.id, invoice.fileName);
  if (!invoice.storageKey || invoice.storageKey === dest) return dest;
  try {
    const buf = await storage.get(invoice.storageKey);
    await storage.put(dest, buf, contentTypeForName(invoice.fileName));
    try {
      await storage.delete(invoice.storageKey);
    } catch {
      /* ignore */
    }
    return dest;
  } catch {
    return dest;
  }
}

export async function confirmInvoice(
  id: string,
  input: ConfirmInvoiceInput,
  deps?: { repo?: InvoiceRepository; storage?: StorageProvider },
): Promise<InvoiceDetail | undefined> {
  const repo = deps?.repo ?? getInvoiceRepository();
  const storage = deps?.storage ?? getStorageProvider();
  const prefix = withTrailingSlash(getConfig().invoicePrefix ?? DEFAULT_INVOICE_PREFIX);
  const detail = await repo.get(id);
  if (!detail) return undefined;

  const actor = input.actor?.trim() || "operator";
  const now = new Date().toISOString();
  const { next, changes } = applyConfirmFields(detail.invoice, input.fields);
  const events: InvoiceConfirmEvent[] = [];
  const nonce = `${now}:${input.action}`;

  for (const change of changes) {
    events.push({
      id: eventId(id, events.length + 1, nonce),
      invoiceId: id,
      action: "edit",
      field: change.field,
      oldValue: change.from,
      newValue: change.to,
      actor,
      reason: input.reason,
      createdAt: now,
    });
  }

  if (input.action === "reject") {
    const reviewReason = input.reason?.trim() || "Rejected by operator.";
    const updated: InvoiceRecord = {
      ...next,
      folder: "anomaly",
      parseStatus: "anomaly",
      needsConfirm: true,
      confirmedAt: now,
      confirmedBy: actor,
      confirmAction: "reject",
      reviewReason,
    };
    events.push({
      id: eventId(id, events.length + 1, nonce),
      invoiceId: id,
      action: "reject",
      actor,
      reason: reviewReason,
      createdAt: now,
    });
    return repo.saveConfirm({ invoice: updated, events });
  }

  const destKey = await moveObject(storage, next, "processed", prefix);
  const updated: InvoiceRecord = {
    ...next,
    folder: "processed",
    parseStatus: "parsed",
    needsConfirm: false,
    confirmedAt: now,
    confirmedBy: actor,
    confirmAction: "accept",
    storageKey: destKey ?? next.storageKey,
    processedAt: now,
    reviewReason: undefined,
  };
  events.push({
    id: eventId(id, events.length + 1, nonce),
    invoiceId: id,
    action: "accept",
    actor,
    reason: input.reason,
    createdAt: now,
  });
  return repo.saveConfirm({ invoice: updated, events });
}
