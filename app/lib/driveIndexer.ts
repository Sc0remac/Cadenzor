import type { SupabaseClient } from "@supabase/supabase-js";
import type { drive_v3 } from "googleapis";
import type { DerivedLabelSuggestion } from "@cadenzor/shared";
import {
  listFolderTree,
  toAssetInsertPayload,
  suggestLabelsFromPath,
  mergeDerivedLabelSuggestions,
} from "./googleDriveClient";

const BATCH_SIZE = 500;
const GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

interface IndexDriveFolderOptions {
  projectId: string;
  projectSourceId: string;
  rootFolderId: string;
  rootFolderName: string;
  drive: drive_v3.Drive;
  accountEmail: string;
  maxDepth?: number;
}

interface IndexDriveFolderResult {
  assetCount: number;
  derivedLabels: DerivedLabelSuggestion[];
  indexedAt: string;
}

interface QueueDerivedLabelsOptions {
  projectId: string;
  requestedBy: string;
  suggestions: DerivedLabelSuggestion[];
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function buildFolderParentLookup(entries: Map<string, any>) {
  const lookup = new Map<string, { name: string; parents: string[] | undefined }>();
  for (const entry of entries.values()) {
    if (entry.mimeType === GOOGLE_DRIVE_FOLDER_MIME) {
      lookup.set(entry.id, { name: entry.name, parents: entry.parents });
    }
  }
  return lookup;
}

function computePathSegments(
  rootId: string,
  rootName: string,
  folderLookup: Map<string, { name: string; parents: string[] | undefined }>,
  entryParents: string[] | undefined
): string[] {
  if (!entryParents || entryParents.length === 0) {
    return [rootName];
  }

  const segments: string[] = [];
  let currentParent = entryParents[0];
  const safetyLimit = 32;
  let counter = 0;

  while (currentParent && counter < safetyLimit) {
    counter += 1;
    if (currentParent === rootId) {
      segments.unshift(rootName);
      break;
    }

    const info = folderLookup.get(currentParent);
    if (!info) {
      break;
    }
    segments.unshift(info.name);
    currentParent = info.parents?.[0];
  }

  if (segments.length === 0) {
    segments.push(rootName);
  }

  return segments;
}

export async function indexDriveFolder(
  supabase: SupabaseClient,
  options: IndexDriveFolderOptions
): Promise<IndexDriveFolderResult> {
  const {
    projectId,
    projectSourceId,
    rootFolderId,
    rootFolderName,
    drive,
    maxDepth = 8,
  } = options;

  const entries = await listFolderTree(drive, rootFolderId, { maxDepth });
  const folderLookup = buildFolderParentLookup(entries);

  const assetPayloads = [];
  let derived: DerivedLabelSuggestion[] = [];

  for (const entry of entries.values()) {
    const pathSegments = computePathSegments(rootFolderId, rootFolderName, folderLookup, entry.parents);
    const payload = toAssetInsertPayload({
      projectId,
      projectSourceId,
      entry,
      pathSegments,
    });

    if (!payload) continue;

    assetPayloads.push(payload);

    const suggestions = suggestLabelsFromPath(payload.path);
    if (suggestions.length > 0) {
      derived = mergeDerivedLabelSuggestions(derived, suggestions);
    }
  }

  await supabase.from("assets").delete().eq("project_source_id", projectSourceId);

  for (const batch of chunkArray(assetPayloads, BATCH_SIZE)) {
    const { error } = await supabase.from("assets").upsert(batch, {
      ignoreDuplicates: false,
      onConflict: "project_source_id,external_id",
    });
    if (error) {
      throw error;
    }
  }

  const indexedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("project_sources")
    .update({ last_indexed_at: indexedAt })
    .eq("id", projectSourceId);
  if (updateError) {
    throw updateError;
  }

  return {
    assetCount: assetPayloads.length,
    derivedLabels: derived,
    indexedAt,
  };
}

export async function queueDerivedLabelApprovals(
  supabase: SupabaseClient,
  options: QueueDerivedLabelsOptions
): Promise<void> {
  const { projectId, requestedBy, suggestions } = options;
  if (suggestions.length === 0) {
    return;
  }

  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("id, labels")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    throw projectError;
  }

  const existingLabels: Record<string, unknown> =
    (projectRow?.labels as Record<string, unknown>) ?? {};

  const filtered = suggestions.filter((suggestion) => {
    const current = existingLabels[suggestion.labelKey];
    return current !== suggestion.labelValue;
  });

  if (filtered.length === 0) {
    return;
  }

  const { data: pendingRows, error: pendingError } = await supabase
    .from("approvals")
    .select("id, payload")
    .eq("project_id", projectId)
    .eq("type", "project_label_suggestion")
    .eq("status", "pending");

  if (pendingError) {
    throw pendingError;
  }

  const skip = new Set<string>();
  for (const row of pendingRows ?? []) {
    const payload = (row.payload as Record<string, unknown>) ?? {};
    const key = String(payload.labelKey ?? "");
    const value = payload.labelValue;
    skip.add(`${key}:${value}`);
  }

  const inserts = filtered
    .filter((suggestion) => !skip.has(`${suggestion.labelKey}:${suggestion.labelValue}`))
    .map((suggestion) => ({
      project_id: projectId,
      type: "project_label_suggestion",
      status: "pending",
      payload: {
        labelKey: suggestion.labelKey,
        labelValue: suggestion.labelValue,
        evidence: suggestion.evidence.slice(0, 10),
        source: "drive_indexer",
      },
      requested_by: requestedBy,
      created_by: requestedBy,
    }));

  if (inserts.length === 0) {
    return;
  }

  const { error } = await supabase.from("approvals").insert(inserts);
  if (error) {
    throw error;
  }
}
