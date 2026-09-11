/**
 * Group field-level update audits into a final-review list: one row per
 * edited site, with net before → after for each changed field.
 */

import type {
  FieldChange,
  Supplier,
  SupplierAuditEvent,
  SupplierReviewItem,
  SupplierSite,
  SupplierVatCheck,
} from "./types";

export function netFieldChanges(events: SupplierAuditEvent[]): FieldChange[] {
  const chrono = [...events].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
  const map = new Map<string, { from: string; to: string }>();
  for (const e of chrono) {
    if (e.action !== "update" || !e.field) continue;
    const from = e.oldValue ?? "";
    const to = e.newValue ?? "";
    const prev = map.get(e.field);
    if (!prev) map.set(e.field, { from, to });
    else map.set(e.field, { from: prev.from, to });
  }
  return [...map.entries()]
    .filter(([, v]) => v.from !== v.to)
    .map(([field, v]) => ({ field, from: v.from, to: v.to }));
}

function latest(events: SupplierAuditEvent[]): SupplierAuditEvent | undefined {
  return [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function latestVatCheck(
  checks: SupplierVatCheck[],
  siteId: string,
): SupplierVatCheck | undefined {
  return checks
    .filter((c) => c.siteId === siteId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function buildReviewItems(input: {
  suppliers: Supplier[];
  sites: SupplierSite[];
  audit: SupplierAuditEvent[];
  vatChecks?: SupplierVatCheck[];
}): SupplierReviewItem[] {
  const updates = input.audit.filter(
    (e) => e.action === "update" && e.recordId !== "*",
  );
  if (updates.length === 0) return [];

  const suppliersById = new Map(input.suppliers.map((s) => [s.id, s]));
  const sitesBySupplier = new Map<string, SupplierSite[]>();
  for (const site of input.sites) {
    const list = sitesBySupplier.get(site.supplierId) ?? [];
    list.push(site);
    sitesBySupplier.set(site.supplierId, list);
  }

  const siteEvents = new Map<string, SupplierAuditEvent[]>();
  const supplierEvents = new Map<string, SupplierAuditEvent[]>();
  for (const e of updates) {
    if (e.recordType === "site") {
      const list = siteEvents.get(e.recordId) ?? [];
      list.push(e);
      siteEvents.set(e.recordId, list);
    } else if (e.recordType === "supplier") {
      const list = supplierEvents.get(e.recordId) ?? [];
      list.push(e);
      supplierEvents.set(e.recordId, list);
    }
  }

  const selected = new Map<string, SupplierSite>();
  for (const site of input.sites) {
    if (siteEvents.has(site.id)) selected.set(site.id, site);
  }
  for (const [supplierId, events] of supplierEvents) {
    const sites = sitesBySupplier.get(supplierId) ?? [];
    const already = sites.filter((s) => selected.has(s.id));
    if (already.length) continue;
    // Header-only edit: show one review row on the first site of that supplier.
    const first = sites[0];
    if (first) selected.set(first.id, first);
    else if (events.length) {
      // No sites — skip; review is site-grained.
    }
  }

  const items: SupplierReviewItem[] = [];
  for (const site of selected.values()) {
    const supplier = suppliersById.get(site.supplierId);
    if (!supplier) continue;
    const events = [
      ...(siteEvents.get(site.id) ?? []),
      ...(supplierEvents.get(supplier.id) ?? []),
    ];
    const changes = netFieldChanges(events);
    if (changes.length === 0) continue;
    const last = latest(events);
    items.push({
      id: site.id,
      supplier,
      site,
      changes,
      lastActor: last?.actor ?? "operator",
      lastReason: last?.reason,
      lastUpdatedAt: last?.createdAt ?? site.updatedAt,
      updateCount: events.length,
      vatCheck: latestVatCheck(input.vatChecks ?? [], site.id),
    });
  }

  return items.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
}
