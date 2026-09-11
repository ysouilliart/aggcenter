import { NextResponse } from "next/server";

import { checkSupplierVats, listSupplierReview } from "@/lib/suppliers/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 25;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      ids?: string[];
      actor?: string;
    };
    let ids = (body.ids ?? []).map((id) => String(id)).filter(Boolean);
    if (ids.length === 0) {
      const { items } = await listSupplierReview();
      ids = items
        .filter((item) => {
          const vat = item.site.siteVat || item.supplier.supplierVat;
          return Boolean(vat) && item.vatCheck?.validity !== "valid";
        })
        .map((item) => item.id);
    }
    ids = [...new Set(ids)].slice(0, MAX_BATCH);
    if (ids.length === 0) {
      return NextResponse.json({ checks: [], errors: [], skipped: true });
    }
    const result = await checkSupplierVats(ids, body.actor);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "VAT checks failed" },
      { status: 500 },
    );
  }
}
