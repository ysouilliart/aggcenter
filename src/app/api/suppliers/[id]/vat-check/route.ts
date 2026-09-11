import { NextResponse } from "next/server";

import { getSupplierRepository } from "@/lib/suppliers/repository";
import { checkSupplierVat } from "@/lib/suppliers/service";
import type { VatScope } from "@/lib/suppliers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asScope(value: unknown): VatScope {
  return value === "supplier" ? "supplier" : "site";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const checks = await getSupplierRepository().listVatChecks(id);
    const supplier = checks.find((c) => c.vatScope === "supplier") ?? null;
    const site = checks.find((c) => c.vatScope === "site") ?? null;
    return NextResponse.json({
      vatCheck: checks[0] ?? null,
      supplierVatCheck: supplier,
      siteVatCheck: site,
      checks,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load VAT check" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { actor?: string; scope?: string };
    const vatCheck = await checkSupplierVat(id, body.actor, undefined, asScope(body.scope));
    return NextResponse.json({ vatCheck });
  } catch (err) {
    const message = err instanceof Error ? err.message : "VAT check failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
