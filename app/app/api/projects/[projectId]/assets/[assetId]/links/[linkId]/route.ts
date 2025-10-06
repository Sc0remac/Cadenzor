import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: {
      projectId: string;
      assetId: string;
      linkId: string;
    };
  }
) {
  const { projectId, assetId, linkId } = params;
  if (!projectId || !assetId || !linkId) {
    return formatError("Project, asset, and link ids are required", 400);
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

  const { error } = await supabase
    .from("asset_links")
    .delete()
    .eq("id", linkId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId);

  if (error) {
    return formatError(error.message, 500);
  }

  try {
    await recordAuditLog(supabase, {
      projectId,
      userId: user.id,
      action: "drive.asset.unlinked",
      entity: "asset_link",
      refId: linkId,
      metadata: { assetId },
    });
  } catch (err) {
    // ignore audit failure
  }

  return NextResponse.json({ success: true });
}
