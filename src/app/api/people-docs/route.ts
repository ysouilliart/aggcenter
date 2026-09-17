import { NextResponse } from "next/server";

import { listPeopleDocs, uploadPeopleDoc } from "@/lib/peopleDocs";
import { getPeopleDocClassifyStatus } from "@/lib/parse/peopleDocs";
import type { PeopleDocFolder } from "@/lib/parse/peopleDocs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const folder = url.searchParams.get("folder") as PeopleDocFolder | null;
  const parseStatus = url.searchParams.get("status") ?? undefined;
  const docs = await listPeopleDocs({
    folder: folder || undefined,
    parseStatus,
  });
  return NextResponse.json({ docs, classify: getPeopleDocClassifyStatus() });
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
  try {
    const content = Buffer.from(await file.arrayBuffer());
    const doc = await uploadPeopleDoc({ fileName: file.name, content });
    return NextResponse.json({ doc, classify: getPeopleDocClassifyStatus() }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
