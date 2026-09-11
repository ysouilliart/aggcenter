import { NextResponse } from "next/server";

import { getSupplierRecord, updateSupplierRecord } from "@/lib/suppliers/service";
import { SUPPLIER_PATCH_FIELDS, type SupplierPatchField } from "@/lib/suppliers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const detail = await getSupplierRecord(id);
    if (!detail) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load record" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      fields?: Record<string, string>;
      actor?: string;
      reason?: string;
    };
    const fields: Partial<Record<SupplierPatchField, string>> = {};
    for (const key of SUPPLIER_PATCH_FIELDS) {
      if (body.fields && body.fields[key] != null) fields[key] = String(body.fields[key]);
    }
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }
    const result = await updateSupplierRecord(id, {
      fields,
      actor: body.actor,
      reason: body.reason,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    const status = message.includes("not found") ? 404 : message.includes("No changes") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
