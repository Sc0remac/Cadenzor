import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  getDriveAccountById,
  ensureDriveOAuthClient,
  createDriveClient,
} from "@/lib/googleDriveClient";
import { indexDriveFolder, queueDerivedLabelApprovals } from "@/lib/driveIndexer";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      sourceId: string;
    };
  }
) {
  const { projectId, sourceId } = params;
  if (!projectId || !sourceId) {
    return formatError("Project and source ids are required", 400);
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

  const { data: sourceRow, error: sourceError } = await supabase
    .from("project_sources")
    .select("*")
    .eq("id", sourceId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (sourceError) {
    return formatError(sourceError.message, 500);
  }

  if (!sourceRow) {
    return formatError("Drive source not found", 404);
  }

  if (sourceRow.kind !== "drive_folder") {
    return formatError("Source is not a Drive folder", 400);
  }

  const metadata = (sourceRow.metadata as Record<string, unknown>) ?? {};
  const folderId = metadata.folderId as string | undefined;
  const folderName = (metadata.folderName as string | undefined) ?? sourceRow.title ?? "Drive";
  const accountId = metadata.accountId as string | undefined;

  if (!folderId || !accountId) {
    return formatError("Drive source metadata is incomplete", 400);
  }

  let account;
  try {
    account = await getDriveAccountById(supabase, accountId);
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Drive account", 500);
  }

  if (!account) {
    return formatError("The Google Drive account used to connect this folder is no longer available", 409);
  }

  let authClient;
  try {
    authClient = await ensureDriveOAuthClient(supabase, account);
  } catch (err: any) {
    return formatError(err?.message || "Drive authentication failed", 500);
  }

  const drive = createDriveClient(authClient);

  try {
    const summary = await indexDriveFolder(supabase, {
      projectId,
      projectSourceId: sourceId,
      rootFolderId: folderId,
      rootFolderName: folderName,
      drive,
      accountEmail: account.accountEmail,
    });

    if (summary.derivedLabels.length > 0) {
      await queueDerivedLabelApprovals(supabase, {
        projectId,
        requestedBy: user.id,
        suggestions: summary.derivedLabels,
      });
    }

    try {
      await recordAuditLog(supabase, {
        projectId,
        userId: user.id,
        action: "drive.folder.reindexed",
        entity: "project_source",
        refId: sourceId,
        metadata: {
          folderId,
          folderName,
          accountId,
          assetCount: summary.assetCount,
        },
      });
    } catch (err) {
      // Ignore audit failures
    }

    return NextResponse.json({
      assetCount: summary.assetCount,
      indexedAt: summary.indexedAt,
    });
  } catch (err: any) {
    return formatError(err?.message || "Failed to reindex Drive folder", 500);
  }
}
