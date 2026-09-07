import { NextResponse } from "next/server";

import { getCashPositions } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const positions = await getCashPositions();
  return NextResponse.json({ positions });
}
