import { NextResponse } from "next/server";

import { formatDbError, withDbTimeout } from "@/lib/db/client";
import { listSupplierRecords } from "@/lib/suppliers/service";
import type { SupplierIssueType } from "@/lib/suppliers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const issue = url.searchParams.get("issue") as SupplierIssueType | "any" | null;
  try {
    const result = await withDbTimeout(
      listSupplierRecords({
        q: url.searchParams.get("q") ?? undefined,
        issue: issue ?? undefined,
        country: url.searchParams.get("country") ?? undefined,
        paymentTerms: url.searchParams.get("paymentTerms") ?? undefined,
        source: url.searchParams.get("source") ?? undefined,
        supplierId: url.searchParams.get("supplierId") ?? undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
      }),
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: formatDbError(err, "Failed to list suppliers") },
      { status: 500 },
    );
  }
}
