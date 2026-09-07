import { NextResponse } from "next/server";

import { getIntegrationStatus } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getIntegrationStatus());
}
