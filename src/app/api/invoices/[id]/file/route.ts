import { NextResponse } from "next/server";

import { getInvoiceFile } from "@/lib/invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const file = await getInvoiceFile(id);
  if (!file) {
    return NextResponse.json({ error: "Invoice file not found" }, { status: 404 });
  }
  const safeName = file.fileName.replace(/"/g, "");
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
