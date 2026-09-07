import { NextResponse } from "next/server";

import { addUploadedStatement, getStatements } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const statements = await getStatements();
  return NextResponse.json({ statements });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const accountId = String(formData.get("accountId") ?? "");
  const currency = formData.get("currency")
    ? String(formData.get("currency"))
    : undefined;

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "A CSV file is required (field name: 'file')." },
      { status: 400 },
    );
  }
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId is required." },
      { status: 400 },
    );
  }

  const content = Buffer.from(await file.arrayBuffer());
  const { statement, errors } = await addUploadedStatement({
    fileName: file.name,
    content,
    accountId,
    currency,
  });

  return NextResponse.json({ statement, errors }, { status: 201 });
}
