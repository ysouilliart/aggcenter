import { NextResponse } from "next/server";

import { ingestPeopleDocs } from "@/lib/peopleDocs";
import { getPeopleDocClassifyStatus } from "@/lib/parse/peopleDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await ingestPeopleDocs();
    return NextResponse.json({ ...result, classify: getPeopleDocClassifyStatus() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "People docs ingest failed" },
      { status: 502 },
    );
  }
}
