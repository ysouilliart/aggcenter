import { NextResponse } from "next/server";

import { listSupplierReview } from "@/lib/suppliers/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await listSupplierReview();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load review" },
      { status: 500 },
    );
  }
}
