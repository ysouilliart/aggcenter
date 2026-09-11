import { NextResponse } from "next/server";

import { ingestReferenceDocuments } from "@/lib/reference/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await ingestReferenceDocuments();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reference ingest failed" },
      { status: 502 },
    );
  }
}
