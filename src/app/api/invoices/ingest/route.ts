import { NextResponse } from "next/server";

import { ingestInvoices } from "@/lib/invoices";
import { getInvoiceClassifyStatus } from "@/lib/parse/invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await ingestInvoices();
    return NextResponse.json({ ...result, classify: getInvoiceClassifyStatus() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invoice ingest failed" },
      { status: 502 },
    );
  }
}
