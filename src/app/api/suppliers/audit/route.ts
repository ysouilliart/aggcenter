import { NextResponse } from "next/server";

import { getSupplierRepository } from "@/lib/suppliers/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const recordId = new URL(request.url).searchParams.get("recordId") ?? undefined;
  try {
    const repo = getSupplierRepository();
    const [audit, versions] = await Promise.all([
      repo.listAudit(recordId),
      recordId ? repo.listVersions(undefined, recordId) : repo.listVersions(),
    ]);
    return NextResponse.json({
      audit: audit.slice(0, 500),
      versions: versions.slice(0, 200),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load audit" },
      { status: 500 },
    );
  }
}
