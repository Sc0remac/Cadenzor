import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  getDriveAccountById,
  ensureDriveOAuthClient,
  createDriveClient,
  ensureFolderPath,
  toAssetInsertPayload,
  suggestLabelsFromPath,
  mergeDerivedLabelSuggestions,
} from "@/lib/googleDriveClient";
import { queueDerivedLabelApprovals } from "@/lib/driveIndexer";
import { mapAssetRow, mapProjectSourceRow } from "@/lib/projectMappers";
import { recordAuditLog } from "@/lib/auditLog";
import type { DerivedLabelSuggestion } from "@kazador/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FileAttachmentPayload {
  attachmentIds: string[];
  projectSourceId: string;
  targetFolderId?: string;
  subfolderPath?: string;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalisePathSegments(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function bufferToStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: {
      projectId: string;
      emailId: string;
    };
  }
) {
  const { projectId, emailId } = params;
  if (!projectId || !emailId) {
    return formatError("Project and email ids are required", 400);
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

  let payload: FileAttachmentPayload;
  try {
    payload = (await request.json()) as FileAttachmentPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.attachmentIds || payload.attachmentIds.length === 0) {
    return formatError("attachmentIds are required", 400);
  }

  if (!payload.projectSourceId) {
    return formatError("projectSourceId is required", 400);
  }

  const { data: sourceRow, error: sourceError } = await supabase
    .from("project_sources")
    .select("*")
    .eq("id", payload.projectSourceId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (sourceError) {
    return formatError(sourceError.message, 500);
  }

  if (!sourceRow || sourceRow.kind !== "drive_folder") {
    return formatError("Drive folder for project not found", 404);
  }

  const source = mapProjectSourceRow(sourceRow);
  const metadata = (source.metadata ?? {}) as Record<string, unknown>;
  const rootFolderId = (metadata.folderId as string | undefined) ?? source.externalId;
  const basePathSegments = normalisePathSegments((metadata.folderPath as string | undefined) ?? null);
  const accountId = metadata.accountId as string | undefined;

  if (!accountId || !rootFolderId) {
    return formatError("Drive source metadata incomplete", 400);
  }

  const { data: attachments, error: attachmentError } = await supabase
    .from("email_attachments")
    .select("*")
    .eq("email_id", emailId)
    .in("id", payload.attachmentIds);

  if (attachmentError) {
    return formatError(attachmentError.message, 500);
  }

  if (!attachments || attachments.length === 0) {
    return formatError("No matching attachments", 404);
  }

  const missingIds = payload.attachmentIds.filter(
    (id) => !attachments.some((attachment) => attachment.id === id)
  );

  if (missingIds.length > 0) {
    return formatError(`Attachment(s) not found: ${missingIds.join(", ")}`, 404);
  }

  let account;
  try {
    account = await getDriveAccountById(supabase, accountId);
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Drive account", 500);
  }

  if (!account) {
    return formatError("Original Drive connection account is unavailable", 409);
  }

  let authClient;
  try {
    authClient = await ensureDriveOAuthClient(supabase, account);
  } catch (err: any) {
    return formatError(err?.message || "Drive authentication failed", 500);
  }

  const drive = createDriveClient(authClient);

  let destinationFolderId = payload.targetFolderId || rootFolderId;
  const subfolderSegments = normalisePathSegments(payload.subfolderPath);

  if (subfolderSegments.length > 0) {
    try {
      destinationFolderId = await ensureFolderPath(
        drive,
        account.accountEmail,
        rootFolderId,
        subfolderSegments
      );
    } catch (err: any) {
      return formatError(err?.message || "Failed to prepare Drive subfolder", 500);
    }
  }

  const resultingAssets = [];
  let derived: DerivedLabelSuggestion[] = [];

  for (const attachment of attachments) {
    if (!attachment.storage_bucket || !attachment.storage_path) {
      return formatError(`Attachment ${attachment.id} missing storage reference`, 400);
    }

    const download = await supabase.storage
      .from(attachment.storage_bucket as string)
      .download(attachment.storage_path as string);

    if (download.error) {
      return formatError(download.error.message, 500);
    }

    const buffer = Buffer.from(await download.data.arrayBuffer());
    const body = bufferToStream(buffer);

    const upload = await drive.files.create({
      requestBody: {
        name: attachment.filename,
        parents: [destinationFolderId],
      },
      media: {
        mimeType: (attachment.mime_type as string) ?? "application/octet-stream",
        body,
      },
      fields:
        "id, name, mimeType, size, modifiedTime, parents, webViewLink, webContentLink, owners(displayName,emailAddress)",
      supportsAllDrives: true,
    });

    if (!upload.data.id) {
      return formatError(`Failed to store attachment ${attachment.id} in Drive`, 500);
    }

    const pathSegments = [...basePathSegments, ...subfolderSegments];
    const payloadForAsset = toAssetInsertPayload({
      projectId,
      projectSourceId: source.id,
      entry: {
        id: upload.data.id,
        name: upload.data.name ?? attachment.filename,
        mimeType: upload.data.mimeType ?? (attachment.mime_type as string) ?? "",
        size: upload.data.size ? Number(upload.data.size) : attachment.size ?? undefined,
        modifiedTime: upload.data.modifiedTime ?? new Date().toISOString(),
        parents: upload.data.parents ?? [destinationFolderId],
        webViewLink: upload.data.webViewLink ?? undefined,
        webContentLink: upload.data.webContentLink ?? undefined,
        owners: upload.data.owners as any,
        shortcutDetails: undefined,
        kind: undefined,
        trashed: false,
      },
      pathSegments,
    });

    if (!payloadForAsset) {
      continue;
    }

    payloadForAsset.metadata = {
      ...payloadForAsset.metadata,
      source: "email_attachment",
      emailId,
      attachmentId: attachment.id,
    };

    const { data: assetRow, error: assetError } = await supabase
      .from("assets")
      .upsert(payloadForAsset, { onConflict: "project_source_id,external_id" })
      .select("*")
      .maybeSingle();

    if (assetError || !assetRow) {
      return formatError(assetError?.message || "Failed to record Drive asset", 500);
    }

    const { error: linkError } = await supabase
      .from("asset_links")
      .upsert(
        {
          project_id: projectId,
          asset_id: assetRow.id,
          ref_table: "emails",
          ref_id: emailId,
          source: "manual",
        },
        { onConflict: "project_id,asset_id,ref_table,ref_id" }
      );

    if (linkError) {
      return formatError(linkError.message, 500);
    }

    resultingAssets.push(mapAssetRow(assetRow));

    const suggestions = suggestLabelsFromPath(payloadForAsset.path);
    if (suggestions.length > 0) {
      derived = mergeDerivedLabelSuggestions(derived, suggestions);
    }
  }

  if (derived.length > 0) {
    try {
      await queueDerivedLabelApprovals(supabase, {
        projectId,
        requestedBy: user.id,
        suggestions: derived,
      });
    } catch (err: any) {
      return formatError(err?.message || "Failed to queue label suggestions", 500);
    }
  }

  await supabase
    .from("project_sources")
    .update({ last_indexed_at: new Date().toISOString() })
    .eq("id", source.id);

  try {
    await recordAuditLog(supabase, {
      projectId,
      userId: user.id,
      action: "drive.asset.filed_from_email",
      entity: "asset",
      metadata: {
        emailId,
        attachmentIds: payload.attachmentIds,
        projectSourceId: source.id,
        destinationFolderId,
        subfolderPath: payload.subfolderPath ?? null,
        assetCount: resultingAssets.length,
      },
    });
  } catch (err) {
    // ignore
  }

  return NextResponse.json({ assets: resultingAssets });
}
