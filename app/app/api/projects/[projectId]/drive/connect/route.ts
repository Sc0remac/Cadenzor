import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  getDriveAccount,
  getDriveAccountById,
  ensureDriveOAuthClient,
  createDriveClient,
  fetchFolderMetadata,
  resolveDrivePath,
  toAssetInsertPayload,
  suggestLabelsFromPath,
  GOOGLE_DRIVE_FOLDER_MIME,
  type DriveFileEntry,
} from "@/lib/googleDriveClient";
import { indexDriveFolder, queueDerivedLabelApprovals } from "@/lib/driveIndexer";
import { mapProjectSourceRow } from "@/lib/projectMappers";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConnectPayload {
  driveId?: string;
  folderId?: string;
  accountId?: string;
  title?: string;
  autoIndex?: boolean;
  maxDepth?: number;
  kind?: "folder" | "file";
  selections?: Array<{
    driveId?: string;
    folderId?: string;
    kind?: "folder" | "file";
    title?: string;
    autoIndex?: boolean;
    maxDepth?: number;
  }>;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, { params }: { params: { projectId: string } }) {
  const { projectId } = params;
  if (!projectId) {
    return formatError("Project id is required", 400);
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

  let payload: ConnectPayload;
  try {
    payload = (await request.json()) as ConnectPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  let account;
  try {
    if (payload.accountId) {
      const accountRecord = await getDriveAccountById(supabase, payload.accountId);
      if (!accountRecord || accountRecord.userId !== user.id) {
        return formatError("Drive account not found", 404);
      }
      account = accountRecord;
    } else {
      const defaultAccount = await getDriveAccount(supabase, { userId: user.id });
      if (!defaultAccount) {
        return formatError("Connect Google Drive first", 404);
      }
      account = defaultAccount;
    }
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Drive account", 500);
  }

  let authClient;
  try {
    authClient = await ensureDriveOAuthClient(supabase, account);
  } catch (err: any) {
    return formatError(err?.message || "Drive authentication failed", 500);
  }

  const drive = createDriveClient(authClient);

  type NormalizedSelection = {
    driveId: string;
    kind: "folder" | "file";
    title?: string;
    autoIndex?: boolean;
    maxDepth?: number;
  };

  const selectionInputs =
    Array.isArray(payload.selections) && payload.selections.length > 0
      ? payload.selections
      : [];

  if (selectionInputs.length === 0) {
    if (payload.driveId || payload.folderId) {
      selectionInputs.push({
        driveId: payload.driveId ?? payload.folderId,
        folderId: payload.folderId,
        kind: payload.kind,
        title: payload.title,
        autoIndex: payload.autoIndex,
        maxDepth: payload.maxDepth,
      });
    } else {
      return formatError("driveId is required", 400);
    }
  }

  const normalizedSelections: NormalizedSelection[] = [];
  for (const selection of selectionInputs) {
    const driveId = selection.driveId ?? selection.folderId;
    if (!driveId) {
      return formatError("driveId is required", 400);
    }
    let kind: "folder" | "file";
    if (selection.kind === "folder" || selection.kind === "file") {
      kind = selection.kind;
    } else if (selection.folderId) {
      kind = "folder";
    } else {
      kind = "file";
    }
    normalizedSelections.push({
      driveId,
      kind,
      title: selection.title,
      autoIndex: selection.autoIndex,
      maxDepth: selection.maxDepth,
    });
  }

  if (normalizedSelections.length === 0) {
    return formatError("driveId is required", 400);
  }

  const results: Array<{ sourceRow: any; indexSummary: { assetCount: number; indexedAt: string } | null }> = [];
  const pathCache = new Map<string, { name: string; parents?: string[] }>();

  for (const selection of normalizedSelections) {
    let itemResponse;
    try {
      itemResponse = await drive.files.get({
        fileId: selection.driveId,
        fields:
          "id, name, mimeType, webViewLink, webContentLink, parents, owners(displayName,emailAddress), shortcutDetails, modifiedTime, size, iconLink",
        supportsAllDrives: true,
      });
    } catch (err: any) {
      return formatError(err?.message || "Failed to load Drive item", 500);
    }

    const itemData = itemResponse.data;
    if (!itemData?.id) {
      return formatError("Drive item not found", 404);
    }

    let targetData = itemData;
    if (itemData.shortcutDetails?.targetId) {
      try {
        const targetResponse = await drive.files.get({
          fileId: itemData.shortcutDetails.targetId,
          fields:
            "id, name, mimeType, webViewLink, webContentLink, parents, owners(displayName,emailAddress), modifiedTime, size, iconLink",
          supportsAllDrives: true,
        });
        if (targetResponse.data?.id) {
          targetData = targetResponse.data;
        }
      } catch (err) {
        // Continue with original metadata if we can't resolve the shortcut target
      }
    }

    const targetMimeType = targetData.mimeType ?? itemData.mimeType ?? "";
    const resolvedKind: "folder" | "file" = targetMimeType === GOOGLE_DRIVE_FOLDER_MIME ? "folder" : "file";
    if (selection.kind && selection.kind !== resolvedKind) {
      return formatError(`Selected item is actually a ${resolvedKind}`, 400);
    }

    const nowIso = new Date().toISOString();
    let indexSummary: { assetCount: number; indexedAt: string } | null = null;
    let sourceRow: any;
    let metadata: Record<string, unknown> = {};

    if (resolvedKind === "folder") {
      const folderId = targetData.id!;

      let folderPath = targetData.name ?? itemData.name ?? folderId;
      try {
        const { path } = await resolveDrivePath(drive, folderId, { cache: pathCache });
        if (path) {
          folderPath = path;
        }
      } catch (err) {
        // Use fallback path based on folder name
      }

      const rootSummary = await fetchFolderMetadata(drive, folderId);

      metadata = {
        folderId,
        folderName: targetData.name ?? rootSummary.name,
        folderPath,
        accountId: account.id,
        accountEmail: account.accountEmail,
        webViewLink: targetData.webViewLink ?? rootSummary.webViewLink ?? null,
        owners: targetData.owners ?? [],
        shortcutDetails: itemData.shortcutDetails ?? null,
        selectedId: itemData.id,
        selectedName: itemData.name,
        connectedBy: user.id,
        connectedAt: nowIso,
      };

      const upsertResult = await supabase
        .from("project_sources")
        .upsert(
          {
            project_id: projectId,
            kind: "drive_folder",
            external_id: folderId,
            title: selection.title ?? (targetData.name ?? "Drive Folder"),
            metadata,
            watch: false,
          },
          { onConflict: "project_id,kind,external_id" }
        )
        .select("*")
        .maybeSingle();

      if (upsertResult.error) {
        return formatError(upsertResult.error.message, 500);
      }

      if (!upsertResult.data) {
        return formatError("Failed to create project source", 500);
      }

      sourceRow = upsertResult.data;

      const autoIndex = selection.autoIndex !== false;
      if (autoIndex) {
        try {
          const summary = await indexDriveFolder(supabase, {
            projectId,
            projectSourceId: sourceRow.id,
            rootFolderId: folderId,
            rootFolderName: targetData.name ?? rootSummary.name,
            drive,
            accountEmail: account.accountEmail,
            maxDepth: selection.maxDepth ?? 8,
          });

          indexSummary = { assetCount: summary.assetCount, indexedAt: summary.indexedAt };

          if (summary.derivedLabels.length > 0) {
            await queueDerivedLabelApprovals(supabase, {
              projectId,
              requestedBy: user.id,
              suggestions: summary.derivedLabels,
            });
          }
        } catch (err: any) {
          return formatError(err?.message || "Failed to index Drive folder", 500);
        }
      }

      try {
        await recordAuditLog(supabase, {
          projectId,
          userId: user.id,
          action: "drive.folder.connected",
          entity: "project_source",
          refId: sourceRow.id,
          metadata,
        });
      } catch (err) {
        // Non-fatal
      }
    } else {
      const fileId = targetData.id!;

      let fullPath = targetData.name ?? itemData.name ?? fileId;
      let pathSegments: string[] = [];
      try {
        const { segments, path } = await resolveDrivePath(drive, fileId, { cache: pathCache });
        if (path) {
          fullPath = path;
        }
        pathSegments = segments.slice(0, Math.max(segments.length - 1, 0));
      } catch (err) {
        // Fallback to defaults
      }

      if (pathSegments.length === 0) {
        pathSegments = ["My Drive"];
      }

      if (!fullPath || !fullPath.includes("/")) {
        fullPath = `${pathSegments.join("/")}/${targetData.name ?? itemData.name ?? fileId}`;
      }

      metadata = {
        fileId,
        fileName: targetData.name ?? itemData.name ?? "Drive File",
        mimeType: targetMimeType,
        path: fullPath,
        accountId: account.id,
        accountEmail: account.accountEmail,
        webViewLink: targetData.webViewLink ?? itemData.webViewLink ?? null,
        webContentLink: targetData.webContentLink ?? itemData.webContentLink ?? null,
        owners: targetData.owners ?? [],
        shortcutDetails: itemData.shortcutDetails ?? null,
        selectedId: itemData.id,
        selectedName: itemData.name,
        connectedBy: user.id,
        connectedAt: nowIso,
      };

      const upsertResult = await supabase
        .from("project_sources")
        .upsert(
          {
            project_id: projectId,
            kind: "drive_file",
            external_id: fileId,
            title: selection.title ?? (targetData.name ?? "Drive File"),
            metadata,
            watch: false,
          },
          { onConflict: "project_id,kind,external_id" }
        )
        .select("*")
        .maybeSingle();

      if (upsertResult.error) {
        return formatError(upsertResult.error.message, 500);
      }

      if (!upsertResult.data) {
        return formatError("Failed to create project source", 500);
      }

      sourceRow = upsertResult.data;

      await supabase.from("assets").delete().eq("project_source_id", sourceRow.id);

      const fileEntry: DriveFileEntry = {
        id: fileId,
        name: targetData.name ?? itemData.name ?? "Drive File",
        mimeType: targetMimeType || "application/octet-stream",
        modifiedTime: targetData.modifiedTime ?? itemData.modifiedTime ?? undefined,
        size: targetData.size ? Number(targetData.size) : itemData.size ? Number(itemData.size) : undefined,
        parents: targetData.parents ?? itemData.parents ?? undefined,
        webViewLink: targetData.webViewLink ?? itemData.webViewLink ?? undefined,
        webContentLink: targetData.webContentLink ?? itemData.webContentLink ?? undefined,
        owners: targetData.owners ?? itemData.owners ?? undefined,
        shortcutDetails: itemData.shortcutDetails ?? targetData.shortcutDetails ?? undefined,
        iconLink: targetData.iconLink ?? itemData.iconLink ?? undefined,
      };

      const assetPayload = toAssetInsertPayload({
        projectId,
        projectSourceId: sourceRow.id,
        entry: fileEntry,
        pathSegments,
      });

      if (!assetPayload) {
        return formatError("Unable to index Drive file", 500);
      }

      const { error: assetError } = await supabase
        .from("assets")
        .upsert(assetPayload, { onConflict: "project_source_id,external_id" });

      if (assetError) {
        return formatError(assetError.message, 500);
      }

      const indexedAt = new Date().toISOString();
      const { error: updateIndexedAtError } = await supabase
        .from("project_sources")
        .update({ last_indexed_at: indexedAt, metadata })
        .eq("id", sourceRow.id);

      if (updateIndexedAtError) {
        return formatError(updateIndexedAtError.message, 500);
      }

      sourceRow = { ...sourceRow, last_indexed_at: indexedAt, metadata };
      indexSummary = { assetCount: 1, indexedAt };

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
          action: "drive.file.connected",
          entity: "project_source",
          refId: sourceRow.id,
          metadata,
        });
      } catch (err) {
        // Non-fatal
      }
    }

    results.push({ sourceRow, indexSummary });
  }

  const mappedResults = results.map((result) => ({
    source: mapProjectSourceRow(result.sourceRow),
    indexSummary: result.indexSummary,
  }));
  const firstResult = mappedResults[0] ?? null;

  return NextResponse.json({
    results: mappedResults,
    source: firstResult?.source ?? null,
    indexSummary: firstResult?.indexSummary ?? null,
  });
}
