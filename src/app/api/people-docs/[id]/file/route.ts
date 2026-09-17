import { NextResponse } from "next/server";

import { getPeopleDocFile } from "@/lib/peopleDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const file = await getPeopleDocFile(id);
  if (!file) {
    return NextResponse.json({ error: "People doc file not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"`,
    },
  });
}
