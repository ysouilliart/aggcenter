import { NextResponse } from "next/server";

import { archivePeopleDoc, getPeopleDocDetail, reprocessPeopleDoc } from "@/lib/peopleDocs";

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
  let body: { action?: string } = {};
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
    const doc = await reprocessPeopleDoc(id);
    if (!doc) {
      return NextResponse.json({ error: "People doc not found" }, { status: 404 });
    }
    const detail = await getPeopleDocDetail(id);
    return NextResponse.json(detail);
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
