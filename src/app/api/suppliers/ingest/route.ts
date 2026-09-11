import { NextResponse } from "next/server";

import { ingestSuppliers } from "@/lib/suppliers/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await ingestSuppliers();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Supplier ingest failed" },
      { status: 502 },
    );
  }
}
