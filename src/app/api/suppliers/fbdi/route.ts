import { NextResponse } from "next/server";

import {
  buildSupplierFbdi,
  listSupplierFbdiPackages,
  publicFbdiBuild,
  saveSupplierFbdi,
  type FbdiImportAction,
  type FbdiScope,
} from "@/lib/suppliers/fbdi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asScope(value: unknown): FbdiScope | undefined {
  if (value === "all" || value === "changed" || value === "new") return value;
  return undefined;
}

function asAction(value: unknown): FbdiImportAction | undefined {
  if (value === "CREATE" || value === "UPDATE") return value;
  return undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const [build, listed] = await Promise.all([
      buildSupplierFbdi({
        scope: asScope(url.searchParams.get("scope")),
        importAction: asAction(url.searchParams.get("importAction")),
        actor: url.searchParams.get("actor") ?? undefined,
      }),
      listSupplierFbdiPackages(),
    ]);
    return NextResponse.json({
      preview: publicFbdiBuild(build),
      ...listed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to preview FBDI" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      scope?: string;
      importAction?: string;
      businessRelationship?: string;
      actor?: string;
    };
    const saved = await saveSupplierFbdi({
      scope: asScope(body.scope),
      importAction: asAction(body.importAction),
      businessRelationship: body.businessRelationship,
      actor: body.actor,
    });
    return NextResponse.json({
      ...publicFbdiBuild(saved),
      saved: saved.saved,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save FBDI package" },
      { status: 502 },
    );
  }
}
