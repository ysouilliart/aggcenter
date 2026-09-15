import { NextResponse } from "next/server";

import { loadCashBaseline } from "@/lib/cash/baseline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await loadCashBaseline();
    return NextResponse.json({
      reset: result.reset,
      ...result.reference,
      statements: result.statements,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cash baseline load failed" },
      { status: 502 },
    );
  }
}
