import { NextResponse } from "next/server";

import { archivePeopleDoc, getPeopleDocDetail, reprocessPeopleDoc } from "@/lib/peopleDocs";
import { PeopleDocModelError } from "@/lib/parse/peopleDocs/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const detail = await getPeopleDocDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "People doc not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: { action?: string; model?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = { action: "archive" };
  }
  const action = body.action ?? "archive";

  if (action === "archive") {
    const doc = await archivePeopleDoc(id);
    if (!doc) {
      return NextResponse.json({ error: "People doc not found" }, { status: 404 });
    }
    return NextResponse.json({ doc });
  }

  if (action === "reprocess") {
    try {
      const doc = await reprocessPeopleDoc(id, {
        model: typeof body.model === "string" ? body.model : undefined,
      });
      if (!doc) {
        return NextResponse.json({ error: "People doc not found" }, { status: 404 });
      }
      const detail = await getPeopleDocDetail(id);
      return NextResponse.json(detail);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Reprocess failed" },
        { status: err instanceof PeopleDocModelError ? 400 : 500 },
      );
    }
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
