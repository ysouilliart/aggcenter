import { NextResponse } from "next/server";

import { formatDbError, withDbTimeout } from "@/lib/db/client";
import { getSupplierWorkspace } from "@/lib/suppliers/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("source") ?? undefined;
  try {
    const { summary } = await withDbTimeout(getSupplierWorkspace(source));
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: formatDbError(err, "Failed to load supplier summary") },
      { status: 500 },
    );
  }
}
