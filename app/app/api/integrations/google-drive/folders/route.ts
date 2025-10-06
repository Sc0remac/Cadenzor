import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  getDriveAccount,
  ensureDriveOAuthClient,
  createDriveClient,
  fetchFolderMetadata,
  listChildFolders,
} from "@/lib/googleDriveClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;
  const { searchParams } = new URL(request.url);
  const parentParam = searchParams.get("parent") ?? "root";

  let account;
  try {
    account = await getDriveAccount(supabase, { userId: user.id });
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Drive account", 500);
  }

  if (!account) {
    return formatError("Connect Google Drive first", 404);
  }

  let authClient;
  try {
    authClient = await ensureDriveOAuthClient(supabase, account);
  } catch (err: any) {
    return formatError(err?.message || "Google Drive authentication failed", 500);
  }

  const drive = createDriveClient(authClient);

  const currentFolderId = parentParam === "root" ? "root" : parentParam;

  let current;
  try {
    current = await fetchFolderMetadata(drive, currentFolderId);
  } catch (err: any) {
    return formatError(err?.message || "Failed to load folder metadata", 500);
  }

  let folders;
  try {
    folders = await listChildFolders(drive, currentFolderId);
  } catch (err: any) {
    return formatError(err?.message || "Failed to list folders", 500);
  }

  return NextResponse.json({
    current,
    folders,
  });
}
