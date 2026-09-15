import { NextResponse } from "next/server";

import { getInvoiceSummary } from "@/lib/invoices";
import { getInvoiceClassifyStatus } from "@/lib/parse/invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const summary = await getInvoiceSummary();
  return NextResponse.json({ ...summary, classify: getInvoiceClassifyStatus() });
}
