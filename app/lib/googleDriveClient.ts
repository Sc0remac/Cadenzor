import { google, drive_v3 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OAuthAccountRecord,
  AssetRecord,
  DerivedLabelSuggestion,
  AssetCanonicalCategory,
} from "@kazador/shared";
import {
  deleteGoogleAccount,
  ensureGoogleOAuthClient,
  getGoogleAccount,
  getGoogleAccountById,
} from "./googleAccount";

export const GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

export async function getDriveAccount(
  supabase: SupabaseClient,
  options: { userId: string; accountId?: string }
): Promise<OAuthAccountRecord | null> {
  return getGoogleAccount(supabase, options);
}

export async function getDriveAccountById(
  supabase: SupabaseClient,
  accountId: string
): Promise<OAuthAccountRecord | null> {
  return getGoogleAccountById(supabase, accountId);
}

export async function ensureDriveOAuthClient(
  supabase: SupabaseClient,
  account: OAuthAccountRecord
) {
  return ensureGoogleOAuthClient(supabase, account);
}

export async function deleteDriveAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<void> {
  await deleteGoogleAccount(supabase, accountId);
}

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  owners?: Array<{ displayName?: string | null; emailAddress?: string | null }>;
  shortcutDetails?: drive_v3.Schema$File["shortcutDetails"];
  kind?: string;
  trashed?: boolean | null;
}

export interface IndexedAssetResult {
  asset: AssetRecord;
  derivedLabels: DerivedLabelSuggestion[];
}

export interface DriveFolderSummary {
  id: string;
  name: string;
  path: string;
  webViewLink?: string;
  parentId?: string;
}

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: number;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
  parents?: string[];
  shortcutDetails?: drive_v3.Schema$File["shortcutDetails"];
  path?: string;
}

export function detectConfidential(pathOrName: string): boolean {
  const target = pathOrName.toLowerCase();
  const keywords = [
    "contract",
    "settlement",
    "legal",
    "nda",
    "agreement",
    "invoice",
    "bank",
  ];
  return keywords.some((keyword) => target.includes(keyword));
}

export function deriveCanonicalCategory(mimeType: string | null, path: string | null): AssetCanonicalCategory | null {
  if (!mimeType && !path) return null;
  const target = `${mimeType ?? ""} ${(path ?? "").toLowerCase()}`.trim();
  if (target.includes("logo") || target.includes("brand")) return "logo";
  if (target.includes("epk")) return "epk";
  if (target.includes("cover")) return "cover";
  if (target.includes("press")) return "press";
  if (mimeType?.startsWith("audio/") || target.includes(".wav")) return "audio";
  if (mimeType?.startsWith("video/") || target.includes(".mp4") || target.includes(".mov")) return "video";
  return null;
}

export async function fetchFolderMetadata(
  drive: drive_v3.Drive,
  folderId: string
): Promise<DriveFolderSummary> {
  const { data } = await drive.files.get({
    fileId: folderId,
    fields: "id, name, webViewLink, parents",
    supportsAllDrives: true,
  });

  const name = data.name ?? "Unnamed";
  return {
    id: data.id ?? folderId,
    name,
    path: name,
    webViewLink: data.webViewLink ?? undefined,
    parentId: data.parents?.[0],
  };
}

export async function listChildFolders(
  drive: drive_v3.Drive,
  parentId: string
): Promise<DriveFolderSummary[]> {
  let nextPageToken: string | undefined;
  const results: DriveFolderSummary[] = [];

  do {
    const { data } = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = '${GOOGLE_DRIVE_FOLDER_MIME}' and trashed = false`,
      fields: "nextPageToken, files(id, name, webViewLink)",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 1000,
      pageToken: nextPageToken,
    });

    for (const file of data.files ?? []) {
      if (!file.id || !file.name) continue;
      results.push({
        id: file.id,
        name: file.name,
        path: file.name,
        webViewLink: file.webViewLink ?? undefined,
      });
    }

    nextPageToken = data.nextPageToken ?? undefined;
  } while (nextPageToken);

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listChildFiles(
  drive: drive_v3.Drive,
  parentId: string
): Promise<DriveFileSummary[]> {
  let nextPageToken: string | undefined;
  const results: DriveFileSummary[] = [];

  do {
    const { data } = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink, webContentLink, iconLink, parents, shortcutDetails)",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 1000,
      pageToken: nextPageToken,
    });

    for (const file of data.files ?? []) {
      if (!file.id || !file.name) continue;
      if (file.mimeType === GOOGLE_DRIVE_FOLDER_MIME) continue;
      results.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType ?? "application/octet-stream",
        modifiedTime: file.modifiedTime ?? undefined,
        size: file.size ? Number(file.size) : undefined,
        webViewLink: file.webViewLink ?? undefined,
        webContentLink: file.webContentLink ?? undefined,
        iconLink: file.iconLink ?? undefined,
        parents: file.parents ?? undefined,
        shortcutDetails: file.shortcutDetails,
      });
    }

    nextPageToken = data.nextPageToken ?? undefined;
  } while (nextPageToken);

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function escapeQueryValue(value: string): string {
  return value.replace(/['\\]/g, (match) => `\\${match}`);
}

export async function searchDriveItems(
  drive: drive_v3.Drive,
  query: string,
  options: { limit?: number } = {}
): Promise<{ folders: DriveFolderSummary[]; files: DriveFileSummary[] }> {
  const sanitized = escapeQueryValue(query.trim());
  if (!sanitized) {
    return { folders: [], files: [] };
  }

  const { data } = await drive.files.list({
    q: `(name contains '${sanitized}' or fullText contains '${sanitized}') and trashed = false`,
    fields:
      "nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink, webContentLink, iconLink, parents, shortcutDetails)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    orderBy: "folder,name",
    pageSize: options.limit ?? 50,
  });

  const folders: DriveFolderSummary[] = [];
  const files: DriveFileSummary[] = [];

  for (const file of data.files ?? []) {
    if (!file.id || !file.name || file.trashed) {
      continue;
    }

    if (file.mimeType === GOOGLE_DRIVE_FOLDER_MIME) {
      folders.push({
        id: file.id,
        name: file.name,
        path: file.name,
        webViewLink: file.webViewLink ?? undefined,
        parentId: file.parents?.[0],
      });
      continue;
    }

    files.push({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType ?? "application/octet-stream",
      modifiedTime: file.modifiedTime ?? undefined,
      size: file.size ? Number(file.size) : undefined,
      webViewLink: file.webViewLink ?? undefined,
      webContentLink: file.webContentLink ?? undefined,
      iconLink: file.iconLink ?? undefined,
      parents: file.parents ?? undefined,
      shortcutDetails: file.shortcutDetails,
    });
  }

  return {
    folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
    files: files.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function resolveDrivePath(
  drive: drive_v3.Drive,
  itemId: string,
  options: { includeTarget?: boolean; cache?: Map<string, { name: string; parents?: string[] }> } = {}
): Promise<{ segments: string[]; path: string }> {
  const { includeTarget = true } = options;
  const cache = options.cache ?? new Map<string, { name: string; parents?: string[] }>();
  const segments: string[] = [];
  let currentId: string | null | undefined = itemId;
  let includeCurrent = includeTarget;
  let safety = 32;

  while (currentId && safety > 0) {
    safety -= 1;
    if (currentId === "root") {
      segments.unshift("My Drive");
      break;
    }

    let info = cache.get(currentId);
    if (!info) {
      const fileData = (await drive.files.get({
        fileId: currentId,
        fields: "id, name, parents",
        supportsAllDrives: true,
      })).data as drive_v3.Schema$File;
      const name: string = fileData.name ?? currentId ?? "";
      info = { name, parents: fileData.parents ?? [] };
      cache.set(currentId, info);
    }

    if (includeCurrent) {
      segments.unshift(info.name ?? currentId);
    }

    includeCurrent = true;
    const parentId = info.parents?.[0];
    if (!parentId) {
      break;
    }
    currentId = parentId;
  }

  return { segments, path: segments.join("/") };
}

export async function listFolderTree(
  drive: drive_v3.Drive,
  rootFolderId: string,
  options: { maxDepth?: number } = {}
): Promise<Map<string, DriveFileEntry>> {
  const queue: Array<{ id: string; depth: number }>
    = [{ id: rootFolderId, depth: 0 }];
  const seen = new Set<string>();
  const files = new Map<string, DriveFileEntry>();
  const maxDepth = options.maxDepth ?? 5;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current.id) || current.depth > maxDepth) continue;
    seen.add(current.id);

    let nextPageToken: string | undefined;

    do {
      const { data } = await drive.files.list({
        q: `'${current.id}' in parents and trashed = false`,
        fields:
          "nextPageToken, files(id, name, mimeType, modifiedTime, size, parents, webViewLink, webContentLink, owners(displayName, emailAddress), shortcutDetails, kind, trashed)",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: 1000,
        pageToken: nextPageToken,
      });

      for (const file of data.files ?? []) {
        if (!file.id || !file.name) continue;

        const entry: DriveFileEntry = {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType ?? "",
          size: file.size ? Number(file.size) : undefined,
          modifiedTime: file.modifiedTime ?? undefined,
          parents: file.parents ?? undefined,
          webViewLink: file.webViewLink ?? undefined,
          webContentLink: file.webContentLink ?? undefined,
          owners: file.owners ?? undefined,
          shortcutDetails: file.shortcutDetails,
          kind: file.kind ?? undefined,
          trashed: file.trashed ?? undefined,
        };

        files.set(file.id, entry);

        const isFolder = file.mimeType === "application/vnd.google-apps.folder";
        if (isFolder && current.depth + 1 <= maxDepth) {
          queue.push({ id: file.id, depth: current.depth + 1 });
        }
      }

      nextPageToken = data.nextPageToken ?? undefined;
    } while (nextPageToken);
  }

  return files;
}

export type PathLookup = Map<string, { segments: string[]; webViewLink?: string }>;

export function buildPathLookup(
  rootId: string,
  rootName: string,
  entries: Map<string, DriveFileEntry>
): PathLookup {
  const lookup: PathLookup = new Map();
  lookup.set(rootId, { segments: [rootName] });

  const folders = Array.from(entries.values()).filter(
    (entry) => entry.mimeType === "application/vnd.google-apps.folder"
  );

  for (const folder of folders) {
    if (!folder.parents?.length) continue;
    const parent = folder.parents[0];
    const parentInfo = lookup.get(parent);
    if (!parentInfo) continue;
    lookup.set(folder.id, {
      segments: [...parentInfo.segments, folder.name],
      webViewLink: folder.webViewLink ?? parentInfo.webViewLink,
    });
  }

  return lookup;
}

export interface AssetInsertPayload {
  project_id: string;
  project_source_id: string;
  source: "drive";
  external_id: string;
  title: string;
  mime_type: string | null;
  size: number | null;
  path: string | null;
  owner: string | null;
  modified_at: string | null;
  confidential: boolean;
  metadata: Record<string, unknown>;
  drive_url: string | null;
  drive_web_view_link: string | null;
  is_canonical: boolean;
  canonical_category: AssetCanonicalCategory | null;
}

export function toAssetInsertPayload(options: {
  projectId: string;
  projectSourceId: string;
  entry: DriveFileEntry;
  pathSegments: string[];
}): AssetInsertPayload | null {
  const { projectId, projectSourceId, entry, pathSegments } = options;

  const isFolder = entry.mimeType === "application/vnd.google-apps.folder";
  if (isFolder) {
    return null;
  }

  const isShortcut = Boolean(entry.shortcutDetails?.targetId);
  const externalId = isShortcut
    ? entry.shortcutDetails?.targetId ?? entry.id
    : entry.id;

  const ownerEmail = entry.owners?.[0]?.emailAddress ?? null;
  const ownerName = entry.owners?.[0]?.displayName;
  const ownerDisplay = ownerEmail ? `${ownerName ?? ownerEmail}` : ownerName ?? null;
  const path = [...pathSegments, entry.name].join("/");
  const confidential = detectConfidential(path);
  const canonicalCategory = deriveCanonicalCategory(entry.mimeType ?? null, path);

  const metadata: Record<string, unknown> = {
    sourceFileId: entry.id,
    isShortcut,
    parents: entry.parents ?? [],
    owners: entry.owners ?? [],
    shortcutDetails: entry.shortcutDetails ?? null,
  };

  if (entry.webContentLink) metadata.webContentLink = entry.webContentLink;

  return {
    project_id: projectId,
    project_source_id: projectSourceId,
    source: "drive",
    external_id: externalId,
    title: entry.name,
    mime_type: entry.mimeType ?? null,
    size: entry.size ?? null,
    path,
    owner: ownerDisplay,
    modified_at: entry.modifiedTime ?? null,
    confidential,
    metadata,
    drive_url: entry.webContentLink ?? entry.webViewLink ?? null,
    drive_web_view_link: entry.webViewLink ?? null,
    is_canonical: Boolean(canonicalCategory),
    canonical_category: canonicalCategory,
  };
}

export function suggestLabelsFromPath(
  path: string | null
): DerivedLabelSuggestion[] {
  if (!path) return [];
  const segments = path.split("/");
  const suggestions: DerivedLabelSuggestion[] = [];

  for (const segment of segments) {
    const territoryMatch = segment.match(/^(?:territory[-_])?([A-Z]{2})$/i);
    if (territoryMatch) {
      const code = territoryMatch[1].toUpperCase();
      suggestions.push({
        labelKey: "territory",
        labelValue: code,
        evidence: [{ reason: `Detected territory code ${code} in path segment`, path }],
      });
      break;
    }
  }

  return suggestions;
}

export function mergeDerivedLabelSuggestions(
  existing: DerivedLabelSuggestion[],
  incoming: DerivedLabelSuggestion[]
): DerivedLabelSuggestion[] {
  const merged = [...existing];

  for (const suggestion of incoming) {
    const existingIndex = merged.findIndex(
      (item) => item.labelKey === suggestion.labelKey && item.labelValue === suggestion.labelValue
    );

    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        evidence: [...merged[existingIndex].evidence, ...suggestion.evidence],
      };
    } else {
      merged.push(suggestion);
    }
  }

  return merged;
}

export async function ensureFolderPath(
  drive: drive_v3.Drive,
  accountEmail: string,
  rootFolderId: string,
  segments: string[]
): Promise<string> {
  let currentParent = rootFolderId;

  for (const segment of segments) {
    let nextId: string | undefined;

    const { data } = await drive.files.list({
      q: `'${currentParent}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${segment.replace(/'/g, "\\'")}' and trashed = false`,
      fields: "files(id)",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 1,
    });

    if (data.files?.length && data.files[0]?.id) {
      nextId = data.files[0].id;
    }

    if (!nextId) {
      const folder = await drive.files.create({
        requestBody: {
          name: segment,
          mimeType: "application/vnd.google-apps.folder",
          parents: [currentParent],
        },
        fields: "id",
        supportsAllDrives: true,
      });

      nextId = folder.data.id ?? undefined;
      if (!nextId) {
        throw new Error(`Failed to create folder segment ${segment}`);
      }
    }

    currentParent = nextId;
  }

  return currentParent;
}

export function createDriveClient(authClient: any): drive_v3.Drive {
  return google.drive({ version: "v3", auth: authClient });
}
