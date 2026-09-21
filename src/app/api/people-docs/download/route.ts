import { NextResponse } from "next/server";

import { exportPeopleDocsKeywordSearch, peopleDocSearchFileName } from "@/lib/peopleDocs";
import type { PeopleDocFolder } from "@/lib/parse/peopleDocs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const folder = url.searchParams.get("folder") as PeopleDocFolder | null;
  const parseStatus = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q") ?? url.searchParams.get("keyword") ?? undefined;

  try {
    const payload = await exportPeopleDocsKeywordSearch({
      folder: folder || undefined,
      parseStatus,
      q,
    });
    const name = peopleDocSearchFileName(payload.keyword, payload.exportedAt);
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to download people-docs search JSON";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
