import { NextResponse } from "next/server";

import { ingestPeopleDocs } from "@/lib/peopleDocs";
import { getPeopleDocClassifyStatus } from "@/lib/parse/peopleDocs";
import { PeopleDocModelError } from "@/lib/parse/peopleDocs/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let model: string | undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as { model?: unknown };
      if (typeof body.model === "string") model = body.model;
    } catch {
      return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    }
  }
  try {
    const result = await ingestPeopleDocs({ model });
    return NextResponse.json({ ...result, classify: getPeopleDocClassifyStatus() });
  } catch (err) {
    const status = err instanceof PeopleDocModelError ? 400 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "People docs ingest failed" },
      { status },
    );
  }
}
