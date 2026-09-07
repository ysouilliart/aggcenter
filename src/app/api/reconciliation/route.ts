import { NextResponse } from "next/server";

import { getReconciliation } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { results, summary } = await getReconciliation();
  return NextResponse.json({ results, summary });
}
