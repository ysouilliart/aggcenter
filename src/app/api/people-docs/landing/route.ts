import { NextResponse } from "next/server";

import { ingestPeopleDocLandingFile, listPeopleDocLanding, PeopleDocLandingError } from "@/lib/peopleDocs";
import { getPeopleDocClassifyStatus } from "@/lib/parse/peopleDocs";
import { PeopleDocModelError } from "@/lib/parse/peopleDocs/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const landing = await listPeopleDocLanding();
    return NextResponse.json(landing);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not list the landing folder" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let body: { key?: unknown; model?: unknown };
  try {
    body = (await request.json()) as { key?: unknown; model?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (typeof body.key !== "string" || !body.key.trim()) {
    return NextResponse.json({ error: "A landing file key is required." }, { status: 400 });
  }
  const model = typeof body.model === "string" ? body.model : undefined;
  try {
    const result = await ingestPeopleDocLandingFile({ key: body.key, model });
    return NextResponse.json({ ...result, classify: getPeopleDocClassifyStatus() });
  } catch (err) {
    const status =
      err instanceof PeopleDocLandingError ? err.status : err instanceof PeopleDocModelError ? 400 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not process the landing file" },
      { status },
    );
  }
}
