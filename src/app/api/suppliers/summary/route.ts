import { NextResponse } from "next/server";

import { getSupplierWorkspace } from "@/lib/suppliers/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { summary } = await getSupplierWorkspace();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load supplier summary" },
      { status: 500 },
    );
  }
}
