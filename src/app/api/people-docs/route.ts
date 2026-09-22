import { NextResponse } from "next/server";

import { listPeopleDocs, uploadPeopleDoc } from "@/lib/peopleDocs";
import { getPeopleDocClassifyStatus } from "@/lib/parse/peopleDocs";
import { PeopleDocModelError } from "@/lib/parse/peopleDocs/models";
import type { PeopleDocFolder } from "@/lib/parse/peopleDocs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const folder = url.searchParams.get("folder") as PeopleDocFolder | null;
  const parseStatus = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const docs = await listPeopleDocs({
    folder: folder || undefined,
    parseStatus,
    q,
  });
  return NextResponse.json({ docs, classify: getPeopleDocClassifyStatus(), q: q?.trim() ?? "" });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "A people-doc file is required (field name: 'file')." },
      { status: 400 },
    );
  }
  const modelField = formData.get("model");
  const model = typeof modelField === "string" ? modelField : undefined;
  try {
    const content = Buffer.from(await file.arrayBuffer());
    const doc = await uploadPeopleDoc({ fileName: file.name, content, model });
    return NextResponse.json({ doc, classify: getPeopleDocClassifyStatus() }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: err instanceof PeopleDocModelError ? 400 : 500 },
    );
  }
}
