import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { getPeopleDocClassifyStatus } from "@/lib/parse/peopleDocs";
import { setPeopleDocModelSelection } from "@/lib/parse/peopleDocs/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  let body: { model?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with model." }, { status: 400 });
  }
  if (typeof body.model !== "string" || !body.model.trim()) {
    return NextResponse.json({ error: "model is required." }, { status: 400 });
  }
  const config = getConfig().peopleDocsClassify;
  const result = setPeopleDocModelSelection(body.model, config.provider, config.model);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ classify: getPeopleDocClassifyStatus() });
}
