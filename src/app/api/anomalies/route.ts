import { NextResponse } from "next/server";

import { getAnomalies } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const anomalies = await getAnomalies();
  return NextResponse.json({ anomalies });
}
