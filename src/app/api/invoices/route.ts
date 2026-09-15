import { NextResponse } from "next/server";

import { listInvoices, uploadInvoice } from "@/lib/invoices";
import { getInvoiceClassifyStatus } from "@/lib/parse/invoice";
import type { InvoiceFolder } from "@/lib/parse/invoice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const folder = url.searchParams.get("folder") as InvoiceFolder | null;
  const parseStatus = url.searchParams.get("status") ?? undefined;
  const invoices = await listInvoices({
    folder: folder || undefined,
    parseStatus,
  });
  return NextResponse.json({ invoices, classify: getInvoiceClassifyStatus() });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "An invoice file is required (field name: 'file')." },
      { status: 400 },
    );
  }
  try {
    const content = Buffer.from(await file.arrayBuffer());
    const invoice = await uploadInvoice({ fileName: file.name, content });
    return NextResponse.json(
      { invoice, classify: getInvoiceClassifyStatus() },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}
