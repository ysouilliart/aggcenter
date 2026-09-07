import { NextResponse } from "next/server";

import { getAccounts } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const accounts = await getAccounts();
  return NextResponse.json({ accounts });
}
