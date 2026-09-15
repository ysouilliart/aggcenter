import { NextResponse } from "next/server";

import { getCashForecasts } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const forecasts = await getCashForecasts();
  const summaryOnly = new URL(request.url).searchParams.get("summary") === "1";
  return NextResponse.json({
    forecasts: summaryOnly
      ? forecasts.map(({ lines: _lines, ...rest }) => ({ ...rest, lines: [] }))
      : forecasts,
  });
}
