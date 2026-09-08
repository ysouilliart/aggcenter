import { NextResponse } from "next/server";

import { ingestFromObjectStorage } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let prefix: string | undefined;
  try {
    const body = await request.json();
    if (body && typeof body.prefix === "string") prefix = body.prefix;
  } catch {
    // no body / not JSON — use the default prefix
  }

  try {
    const result = await ingestFromObjectStorage(prefix);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ingest failed" },
      { status: 502 },
    );
  }
}
