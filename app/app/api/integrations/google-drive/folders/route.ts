import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  getDriveAccount,
  ensureDriveOAuthClient,
  createDriveClient,
  fetchFolderMetadata,
  listChildFolders,
  listChildFiles,
  searchDriveItems,
  resolveDrivePath,
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
  const searchParam = (searchParams.get("search") ?? "").trim();
  const mode = searchParam ? "search" : "browse";

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

  if (mode === "search") {
    let searchResults;
    try {
      searchResults = await searchDriveItems(drive, searchParam, { limit: 50 });
    } catch (err: any) {
      return formatError(err?.message || "Failed to search Drive", 500);
    }

    const cache = new Map<string, { name: string; parents?: string[] }>();

    const foldersWithPath = await Promise.all(
      searchResults.folders.map(async (folder) => {
        try {
          const { path } = await resolveDrivePath(drive, folder.id, { cache });
          return { ...folder, path };
        } catch (err: any) {
          return { ...folder, path: folder.path };
        }
      })
    );

    const filesWithPath = await Promise.all(
      searchResults.files.map(async (file) => {
        try {
          const { path } = await resolveDrivePath(drive, file.id, { cache });
          return { ...file, path };
        } catch (err: any) {
          return { ...file, path: file.path };
        }
      })
    );

    return NextResponse.json({
      mode,
      query: searchParam,
      current: {
        id: "search",
        name: searchParam,
        path: `Search results for "${searchParam}"`,
      },
      folders: foldersWithPath,
      files: filesWithPath,
    });
  }

  const currentFolderId = parentParam === "root" ? "root" : parentParam;

  let current;
  try {
    current = await fetchFolderMetadata(drive, currentFolderId);
  } catch (err: any) {
    return formatError(err?.message || "Failed to load folder metadata", 500);
  }

  let folders;
  let files;
  try {
    [folders, files] = await Promise.all([
      listChildFolders(drive, currentFolderId),
      listChildFiles(drive, currentFolderId),
    ]);
  } catch (err: any) {
    return formatError(err?.message || "Failed to browse Drive", 500);
  }

  return NextResponse.json({
    mode,
    query: null,
    current,
    folders,
    files,
  });
}
