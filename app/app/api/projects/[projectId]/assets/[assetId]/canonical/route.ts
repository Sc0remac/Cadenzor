import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import { mapAssetRow } from "@/lib/projectMappers";
import { recordAuditLog } from "@/lib/auditLog";
import type { AssetCanonicalCategory } from "@kazador/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CanonicalPayload {
  isCanonical: boolean;
  category?: AssetCanonicalCategory | null;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: {
      projectId: string;
      assetId: string;
    };
  }
) {
  const { projectId, assetId } = params;
  if (!projectId || !assetId) {
    return formatError("Project and asset ids are required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  try {
    await assertProjectRole(supabase, projectId, user.id, "editor");
  } catch (err: any) {
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  let payload: CanonicalPayload;
  try {
    payload = (await request.json()) as CanonicalPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const updatePayload: Record<string, unknown> = {
    is_canonical: Boolean(payload.isCanonical),
    canonical_category: payload.category ?? null,
  };

  const { data, error } = await supabase
    .from("assets")
    .update(updatePayload)
    .eq("id", assetId)
    .eq("project_id", projectId)
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 500);
  }

  if (!data) {
    return formatError("Asset not found", 404);
  }

  try {
    await recordAuditLog(supabase, {
      projectId,
      userId: user.id,
      action: payload.isCanonical ? "drive.asset.marked_canonical" : "drive.asset.unmarked_canonical",
      entity: "asset",
      refId: assetId,
      metadata: { category: payload.category ?? null },
    });
  } catch (err) {
    // Ignore audit failure
  }

  return NextResponse.json({ asset: mapAssetRow(data) });
}
