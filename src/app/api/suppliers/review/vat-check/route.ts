import { NextResponse } from "next/server";

import { checkSupplierVat, listSupplierReview } from "@/lib/suppliers/service";
import type { VatScope } from "@/lib/suppliers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 25;

function asScope(value: unknown): VatScope | undefined {
  if (value === "supplier" || value === "site") return value;
  return undefined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      ids?: string[];
      actor?: string;
      scope?: string;
    };
    const forcedScope = asScope(body.scope);
    let ids = (body.ids ?? []).map((id) => String(id)).filter(Boolean);
    const { items } = await listSupplierReview();
    const sites = items.flatMap((item) =>
      item.sites.map((entry) => ({
        siteId: entry.site.id,
        siteVat: entry.site.siteVat,
        supplierVat: item.supplier.supplierVat,
      })),
    );
    if (ids.length === 0) {
      ids = sites
        .filter((entry) => Boolean(entry.siteVat.trim() || entry.supplierVat.trim()))
        .map((entry) => entry.siteId);
    }
    ids = [...new Set(ids)].slice(0, MAX_BATCH);
    if (ids.length === 0) {
      return NextResponse.json({ checks: [], errors: [], skipped: true });
    }
    const bySiteId = new Map(sites.map((entry) => [entry.siteId, entry]));
    const checks = [];
    const errors: { id: string; error: string }[] = [];
    for (const id of ids) {
      const entry = bySiteId.get(id);
      const scope: VatScope = forcedScope ?? (entry?.siteVat.trim() ? "site" : "supplier");
      try {
        checks.push(await checkSupplierVat(id, body.actor, undefined, scope));
      } catch (err) {
        errors.push({ id, error: err instanceof Error ? err.message : "VAT check failed" });
      }
    }
    return NextResponse.json({ checks, errors });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "VAT checks failed" },
      { status: 500 },
    );
  }
}
