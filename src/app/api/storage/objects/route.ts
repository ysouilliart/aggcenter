import { NextResponse } from "next/server";

import { listStorageObjects } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const prefix = new URL(request.url).searchParams.get("prefix") ?? "";
  try {
    const result = await listStorageObjects(prefix);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list objects" },
      { status: 502 },
    );
  }
}
