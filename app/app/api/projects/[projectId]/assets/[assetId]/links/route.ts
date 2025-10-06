import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import { mapAssetLinkRow } from "@/lib/projectMappers";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LinkPayload {
  refTable: string;
  refId: string;
  source?: string;
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

  let payload: LinkPayload;
  try {
    payload = (await request.json()) as LinkPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.refTable || !payload?.refId) {
    return formatError("refTable and refId are required", 400);
  }

  const { data: assetRow, error: assetError } = await supabase
    .from("assets")
    .select("id, project_id")
    .eq("id", assetId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (assetError) {
    return formatError(assetError.message, 500);
  }

  if (!assetRow) {
    return formatError("Asset not found", 404);
  }

  const { data: linkRow, error: linkError } = await supabase
    .from("asset_links")
    .upsert(
      {
        project_id: projectId,
        asset_id: assetId,
        ref_table: payload.refTable,
        ref_id: payload.refId,
        source: payload.source ?? "manual",
      },
      { onConflict: "project_id,asset_id,ref_table,ref_id", ignoreDuplicates: false }
    )
    .select("*")
    .maybeSingle();

  if (linkError) {
    return formatError(linkError.message, 500);
  }

  if (!linkRow) {
    return formatError("Failed to create asset link", 500);
  }

  try {
    await recordAuditLog(supabase, {
      projectId,
      userId: user.id,
      action: "drive.asset.linked",
      entity: "asset_link",
      refId: linkRow.id,
      metadata: {
        assetId,
        refTable: payload.refTable,
        refId: payload.refId,
      },
    });
  } catch (err) {
    // Non-fatal
  }

  return NextResponse.json({ link: mapAssetLinkRow(linkRow) });
}
