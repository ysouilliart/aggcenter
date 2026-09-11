import { NextResponse } from "next/server";

import { getSupplierRepository } from "@/lib/suppliers/repository";
import { checkSupplierVat } from "@/lib/suppliers/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const checks = await getSupplierRepository().listVatChecks(id);
    return NextResponse.json({ vatCheck: checks[0] ?? null, checks });
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
    const body = (await request.json().catch(() => ({}))) as { actor?: string };
    const vatCheck = await checkSupplierVat(id, body.actor);
    return NextResponse.json({ vatCheck });
  } catch (err) {
    const message = err instanceof Error ? err.message : "VAT check failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
