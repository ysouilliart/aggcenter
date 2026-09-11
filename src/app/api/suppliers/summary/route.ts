import { NextResponse } from "next/server";

import { getSupplierWorkspace } from "@/lib/suppliers/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("source") ?? undefined;
  try {
    const { summary } = await getSupplierWorkspace(source);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load supplier summary" },
      { status: 500 },
    );
  }
}
