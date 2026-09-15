import { NextResponse } from "next/server";

import { archiveInvoice, confirmInvoice, getInvoiceDetail } from "@/lib/invoices";
import type { InvoiceConfirmFields } from "@/lib/invoices/confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const detail = await getInvoiceDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: {
    action?: string;
    actor?: string;
    reason?: string;
    fields?: Record<string, unknown>;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = { action: "archive" };
  }
  const action = body.action ?? "archive";

  if (action === "archive") {
    const invoice = await archiveInvoice(id);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    return NextResponse.json({ invoice });
  }

  if (action === "confirm" || action === "reject") {
    const detail = await confirmInvoice(id, {
      action: action === "reject" ? "reject" : "accept",
      actor: body.actor,
      reason: body.reason,
      fields: body.fields as InvoiceConfirmFields | undefined,
    });
    if (!detail) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
