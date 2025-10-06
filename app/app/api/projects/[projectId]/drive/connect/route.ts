import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  getDriveAccount,
  getDriveAccountById,
  ensureDriveOAuthClient,
  createDriveClient,
  fetchFolderMetadata,
} from "@/lib/googleDriveClient";
import { indexDriveFolder, queueDerivedLabelApprovals } from "@/lib/driveIndexer";
import { mapProjectSourceRow } from "@/lib/projectMappers";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

interface ConnectPayload {
  folderId: string;
  accountId?: string;
  title?: string;
  autoIndex?: boolean;
  maxDepth?: number;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function resolveFolderPath(
  drive: ReturnType<typeof createDriveClient>,
  folderId: string
): Promise<string> {
  const segments: string[] = [];
  let currentId: string | undefined | null = folderId;
  const safetyLimit = 24;
  let counter = 0;

  while (currentId && counter < safetyLimit) {
    counter += 1;
    if (currentId === "root") {
      segments.unshift("My Drive");
      break;
    }

    const { data } = await drive.files.get({
      fileId: currentId,
      fields: "id, name, parents, mimeType",
      supportsAllDrives: true,
    });

    if (data.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
      break;
    }

    segments.unshift(data.name ?? currentId);
    const parent = data.parents?.[0];
    if (!parent) {
      break;
    }
    currentId = parent;
  }

  return segments.join("/");
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

  if (!payload?.folderId) {
    return formatError("folderId is required", 400);
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

  let folderMeta;
  try {
    folderMeta = await drive.files.get({
      fileId: payload.folderId,
      fields: "id, name, mimeType, webViewLink, parents, owners(displayName,emailAddress)",
      supportsAllDrives: true,
    });
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Drive folder", 500);
  }

  const fileData = folderMeta.data;
  if (fileData.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
    return formatError("Selected item is not a folder", 400);
  }

  const rootSummary = await fetchFolderMetadata(drive, fileData.id!);
  const folderPath = await resolveFolderPath(drive, fileData.id!);

  const metadata = {
    folderId: fileData.id,
    folderName: fileData.name,
    folderPath,
    accountId: account.id,
    accountEmail: account.accountEmail,
    webViewLink: fileData.webViewLink ?? rootSummary.webViewLink ?? null,
    owners: fileData.owners ?? [],
    connectedBy: user.id,
    connectedAt: new Date().toISOString(),
  };

  const { data: sourceRow, error: sourceError } = await supabase
    .from("project_sources")
    .upsert(
      {
        project_id: projectId,
        kind: "drive_folder",
        external_id: fileData.id,
        title: payload.title ?? fileData.name ?? "Drive Folder",
        metadata,
        watch: false,
      },
      { onConflict: "project_id,kind,external_id" }
    )
    .select("*")
    .maybeSingle();

  if (sourceError) {
    return formatError(sourceError.message, 500);
  }

  if (!sourceRow) {
    return formatError("Failed to create project source", 500);
  }

  const autoIndex = payload.autoIndex !== false;
  let indexSummary: { assetCount: number; indexedAt: string } | null = null;

  if (autoIndex) {
    try {
      const summary = await indexDriveFolder(supabase, {
        projectId,
        projectSourceId: sourceRow.id,
        rootFolderId: fileData.id!,
        rootFolderName: fileData.name ?? rootSummary.name,
        drive,
        accountEmail: account.accountEmail,
        maxDepth: payload.maxDepth ?? 8,
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

  return NextResponse.json({
    source: mapProjectSourceRow(sourceRow),
    indexSummary,
  });
}
