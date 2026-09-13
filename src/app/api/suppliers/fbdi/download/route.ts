import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { assertSafeKey } from "@/lib/service";
import { getStorageProvider } from "@/lib/storage";
import { isFbdiDownloadKey } from "@/lib/suppliers/fbdi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  try {
    assertSafeKey(key);
    const prefix = getConfig().supplierFbdiPrefix;
    if (!isFbdiDownloadKey(key, prefix)) {
      return NextResponse.json({ error: "Key is not under the FBDI prefix." }, { status: 400 });
    }
    const buf = await getStorageProvider().get(key);
    const name = key.split("/").pop() ?? "download";
    const type = name.endsWith(".zip")
      ? "application/zip"
      : name.endsWith(".json")
        ? "application/json"
        : "text/csv; charset=utf-8";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to download FBDI file";
    const status = message === "Invalid object key." ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
