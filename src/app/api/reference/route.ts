import { NextResponse } from "next/server";

import { getReferenceRepository } from "@/lib/reference/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const counts = await getReferenceRepository().counts();
  return NextResponse.json({
    ...counts,
    provider: getReferenceRepository().name,
  });
}
