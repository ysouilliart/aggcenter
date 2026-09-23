/**
 * Group field-level update audits into a final-review list: one row per
 * edited supplier. Supplier-header changes are listed once; each site's
 * net before → after sits on that site.
 */

import type {
  FieldChange,
  Supplier,
  SupplierAuditEvent,
  SupplierReviewItem,
  SupplierReviewSite,
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

function reviewSiteFrom(
  site: SupplierSite,
  events: SupplierAuditEvent[],
  vatChecks: SupplierVatCheck[],
  fallback?: SupplierAuditEvent,
): SupplierReviewSite {
  const last = latest(events) ?? fallback;
  return {
    site,
    changes: netFieldChanges(events),
    lastActor: last?.actor ?? "operator",
    lastReason: last?.reason,
    lastUpdatedAt: last?.createdAt ?? site.updatedAt,
    updateCount: events.length,
    vatCheck: latestVatCheck(vatChecks, site.id),
  };
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

  const supplierIds = new Set<string>(supplierEvents.keys());
  for (const site of input.sites) {
    if (siteEvents.has(site.id)) supplierIds.add(site.supplierId);
  }

  const vatChecks = input.vatChecks ?? [];
  const items: SupplierReviewItem[] = [];

  for (const supplierId of supplierIds) {
    const supplier = suppliersById.get(supplierId);
    if (!supplier) continue;

    const headerEvents = supplierEvents.get(supplierId) ?? [];
    const headerChanges = netFieldChanges(headerEvents);
    const headerLast = latest(headerEvents);
    const supplierSites = sitesBySupplier.get(supplierId) ?? [];
    const edited = supplierSites.filter((site) => siteEvents.has(site.id));

    const reviewSites: SupplierReviewSite[] = [];
    if (edited.length) {
      for (const site of edited) {
        const events = siteEvents.get(site.id) ?? [];
        const entry = reviewSiteFrom(site, events, vatChecks, headerLast);
        if (entry.changes.length === 0) continue;
        reviewSites.push(entry);
      }
    } else if (headerChanges.length && supplierSites[0]) {
      // Header-only edit: keep one site so VAT validation still has a target.
      reviewSites.push(reviewSiteFrom(supplierSites[0], [], vatChecks, headerLast));
    }

    if (headerChanges.length === 0 && reviewSites.length === 0) continue;

    reviewSites.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));

    const allEvents = [
      ...headerEvents,
      ...reviewSites.flatMap((entry) => siteEvents.get(entry.site.id) ?? []),
    ];
    const last = latest(allEvents);
    items.push({
      id: supplier.id,
      supplier,
      changes: headerChanges,
      headerUpdateCount: headerEvents.length,
      headerActor: headerLast?.actor,
      headerReason: headerLast?.reason,
      sites: reviewSites,
      lastActor: last?.actor ?? "operator",
      lastReason: last?.reason,
      lastUpdatedAt: last?.createdAt ?? supplier.updatedAt,
      updateCount: allEvents.length,
    });
  }

  return items.sort((a, b) => b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
}
