import { NextResponse } from "next/server";

import { getStorageObjectPreview } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  try {
    const preview = await getStorageObjectPreview(key);
    return NextResponse.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch object";
    const status = message === "Invalid object key." ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
