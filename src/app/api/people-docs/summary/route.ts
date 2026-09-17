import { NextResponse } from "next/server";

import { getPeopleDocSummary } from "@/lib/peopleDocs";
import { getPeopleDocClassifyStatus } from "@/lib/parse/peopleDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await getPeopleDocSummary();
  return NextResponse.json({ ...summary, classify: getPeopleDocClassifyStatus() });
}
