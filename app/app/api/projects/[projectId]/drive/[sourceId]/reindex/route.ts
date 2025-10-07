import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  getDriveAccountById,
  ensureDriveOAuthClient,
  createDriveClient,
  resolveDrivePath,
  toAssetInsertPayload,
  suggestLabelsFromPath,
  GOOGLE_DRIVE_FOLDER_MIME,
  type DriveFileEntry,
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

  const metadata = (sourceRow.metadata as Record<string, unknown>) ?? {};
  const accountId = metadata.accountId as string | undefined;

  if (!accountId) {
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

  if (sourceRow.kind === "drive_folder") {
    const folderId = metadata.folderId as string | undefined;
    const folderName = (metadata.folderName as string | undefined) ?? sourceRow.title ?? "Drive";

    if (!folderId) {
      return formatError("Drive source metadata is incomplete", 400);
    }

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

  if (sourceRow.kind === "drive_file") {
    const fileId = metadata.fileId as string | undefined;
    if (!fileId) {
      return formatError("Drive source metadata is incomplete", 400);
    }

    try {
      const fileResponse = await drive.files.get({
        fileId,
        fields:
          "id, name, mimeType, webViewLink, webContentLink, parents, owners(displayName,emailAddress), shortcutDetails, modifiedTime, size, iconLink",
        supportsAllDrives: true,
      });

      const fileData = fileResponse.data;
      if (!fileData?.id) {
        return formatError("Drive file was not found", 404);
      }

      let targetData = fileData;
      if (fileData.shortcutDetails?.targetId) {
        try {
          const targetResponse = await drive.files.get({
            fileId: fileData.shortcutDetails.targetId,
            fields:
              "id, name, mimeType, webViewLink, webContentLink, parents, owners(displayName,emailAddress), modifiedTime, size, iconLink",
            supportsAllDrives: true,
          });
          if (targetResponse.data?.id) {
            targetData = targetResponse.data;
          }
        } catch (err) {
          // Ignore shortcut resolution errors and keep using the file metadata we have
        }
      }

      const targetMimeType = targetData.mimeType ?? fileData.mimeType ?? "";
      if (targetMimeType === GOOGLE_DRIVE_FOLDER_MIME) {
        return formatError("Connected item is a folder; reindex through folder workflow", 400);
      }

      let fullPath = targetData.name ?? fileData.name ?? fileId;
      let pathSegments: string[] = [];
      try {
        const { segments, path } = await resolveDrivePath(drive, targetData.id!);
        if (path) {
          fullPath = path;
        }
        pathSegments = segments.slice(0, Math.max(segments.length - 1, 0));
      } catch (err) {
        // ignore
      }

      if (pathSegments.length === 0) {
        pathSegments = ["My Drive"];
      }

      if (!fullPath || !fullPath.includes("/")) {
        fullPath = `${pathSegments.join("/")}/${targetData.name ?? fileData.name ?? fileId}`;
      }

      await supabase.from("assets").delete().eq("project_source_id", sourceId);

      const fileEntry: DriveFileEntry = {
        id: targetData.id ?? fileData.id,
        name: targetData.name ?? fileData.name ?? "Drive File",
        mimeType: targetMimeType || "application/octet-stream",
        modifiedTime: targetData.modifiedTime ?? fileData.modifiedTime ?? undefined,
        size: targetData.size ? Number(targetData.size) : fileData.size ? Number(fileData.size) : undefined,
        parents: targetData.parents ?? fileData.parents ?? undefined,
        webViewLink: targetData.webViewLink ?? fileData.webViewLink ?? undefined,
        webContentLink: targetData.webContentLink ?? fileData.webContentLink ?? undefined,
        owners: targetData.owners ?? fileData.owners ?? undefined,
        shortcutDetails: fileData.shortcutDetails ?? targetData.shortcutDetails ?? undefined,
        iconLink: targetData.iconLink ?? fileData.iconLink ?? undefined,
      };

      const assetPayload = toAssetInsertPayload({
        projectId,
        projectSourceId: sourceId,
        entry: fileEntry,
        pathSegments,
      });

      if (!assetPayload) {
        return formatError("Unable to compute asset payload for Drive file", 500);
      }

      const { error: assetError } = await supabase
        .from("assets")
        .upsert(assetPayload, { onConflict: "project_source_id,external_id" });

      if (assetError) {
        return formatError(assetError.message, 500);
      }

      const indexedAt = new Date().toISOString();
      const nextMetadata = {
        ...metadata,
        fileName: targetData.name ?? fileData.name ?? metadata.fileName ?? "Drive File",
        mimeType: targetMimeType,
        path: fullPath,
        webViewLink: targetData.webViewLink ?? fileData.webViewLink ?? metadata.webViewLink ?? null,
        webContentLink: targetData.webContentLink ?? fileData.webContentLink ?? metadata.webContentLink ?? null,
        owners: targetData.owners ?? fileData.owners ?? metadata.owners ?? [],
      };

      const { error: updateError } = await supabase
        .from("project_sources")
        .update({ last_indexed_at: indexedAt, metadata: nextMetadata })
        .eq("id", sourceId);

      if (updateError) {
        return formatError(updateError.message, 500);
      }

      const derivedSuggestions = suggestLabelsFromPath(assetPayload.path);
      if (derivedSuggestions.length > 0) {
        await queueDerivedLabelApprovals(supabase, {
          projectId,
          requestedBy: user.id,
          suggestions: derivedSuggestions,
        });
      }

      try {
        await recordAuditLog(supabase, {
          projectId,
          userId: user.id,
          action: "drive.file.reindexed",
          entity: "project_source",
          refId: sourceId,
          metadata: {
            fileId,
            fileName: nextMetadata.fileName,
            accountId,
          },
        });
      } catch (err) {
        // ignore audit failure
      }

      return NextResponse.json({ assetCount: 1, indexedAt });
    } catch (err: any) {
      return formatError(err?.message || "Failed to reindex Drive file", 500);
    }
  }

  return formatError("Unsupported Drive source kind", 400);
}
