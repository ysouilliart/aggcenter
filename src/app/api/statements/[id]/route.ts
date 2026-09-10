import { NextResponse } from "next/server";

import { getStatementDetail } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detail = await getStatementDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Statement not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
