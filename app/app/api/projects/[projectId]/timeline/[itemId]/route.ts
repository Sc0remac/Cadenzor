import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../../lib/projectAccess";
import { mapTimelineItemRow } from "../../../../../../lib/projectMappers";
import {
  getTimelineLaneForType,
  normaliseTimelineItemStatus,
  normaliseTimelineItemType,
  type TimelineItemRecord,
  type TimelineItemType,
} from "@cadenzor/shared";

interface Params {
  params: {
    projectId: string;
    itemId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

interface UpdateTimelineItemPayload {
  title?: string;
  type?: TimelineItemType | string;
  kind?: string | null;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  dueAt?: string | null;
  timezone?: string | null;
  lane?: string | null;
  territory?: string | null;
  status?: string | null;
  priority?: number | null;
  priorityComponents?: Record<string, unknown> | null;
  labels?: Record<string, unknown> | null;
  links?: Record<string, unknown> | null;
  dependencies?: Array<{ itemId: string; kind?: "FS" | "SS"; note?: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  const { projectId, itemId } = params;
  if (!projectId || !itemId) {
    return formatError("Project id and item id are required", 400);
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

  let payload: UpdateTimelineItemPayload;
  try {
    payload = (await request.json()) as UpdateTimelineItemPayload;
  } catch {
    return formatError("Invalid JSON payload", 400);
  }

  const { data: existingRow, error: fetchError } = await supabase
    .from("project_items")
    .select("*")
    .eq("id", itemId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (fetchError) {
    return formatError(fetchError.message, 500);
  }

  if (!existingRow) {
    return formatError("Timeline item not found", 404);
  }

  const currentLabels = (existingRow.labels as Record<string, unknown> | null) ?? {};
  const labels: Record<string, unknown> = { ...currentLabels };
  if (payload.labels) {
    Object.assign(labels, payload.labels);
  }
  if (payload.territory !== undefined) {
    if (payload.territory === null) {
      delete labels.territory;
    } else {
      labels.territory = payload.territory;
    }
  }

  const type = payload.type !== undefined
    ? normaliseTimelineItemType(payload.type)
    : normaliseTimelineItemType(existingRow.type as string);
  if (payload.lane !== undefined && payload.lane !== null) {
    labels.lane = payload.lane;
  } else {
    labels.lane = labels.lane ?? getTimelineLaneForType(type);
  }

  const currentLinks = (existingRow.links as Record<string, unknown> | null) ?? {};
  const links: Record<string, unknown> = { ...currentLinks };
  if (payload.links) {
    Object.assign(links, payload.links);
  }

  const priorityComponents =
    payload.priorityComponents ?? (existingRow.priority_components as Record<string, unknown> | null) ?? {};

  const updatePayload: Record<string, unknown> = {};
  if (payload.title !== undefined) updatePayload["title"] = payload.title;
  if (payload.kind !== undefined) updatePayload["kind"] = payload.kind;
  if (payload.description !== undefined) updatePayload["description"] = payload.description;
  if (payload.startsAt !== undefined) updatePayload["start_at"] = payload.startsAt;
  if (payload.endsAt !== undefined) updatePayload["end_at"] = payload.endsAt;
  if (payload.dueAt !== undefined) updatePayload["due_at"] = payload.dueAt;
  if (payload.timezone !== undefined) updatePayload["tz"] = payload.timezone;
  if (payload.priority !== undefined) updatePayload["priority_score"] = payload.priority;
  updatePayload["labels"] = labels;
  updatePayload["links"] = links;
  updatePayload["priority_components"] = priorityComponents;

  const status = payload.status !== undefined
    ? normaliseTimelineItemStatus(payload.status)
    : normaliseTimelineItemStatus(existingRow.status as string | null);
  updatePayload["status"] = status;

  updatePayload["type"] = type;

  const { data: updatedRow, error: updateError } = await supabase
    .from("project_items")
    .update(updatePayload)
    .eq("id", itemId)
    .eq("project_id", projectId)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return formatError(updateError.message, 400);
  }

  if (!updatedRow?.id) {
    return formatError("Failed to update timeline item", 500);
  }

  if (payload.dependencies) {
    const { error: deleteError } = await supabase
      .from("timeline_dependencies")
      .delete()
      .eq("project_id", projectId)
      .eq("to_item_id", itemId);

    if (!deleteError && payload.dependencies.length > 0) {
      const dependencyRows = payload.dependencies
        .filter((dependency) => typeof dependency.itemId === "string" && dependency.itemId.length > 0)
        .map((dependency) => ({
          project_id: projectId,
          from_item_id: dependency.itemId,
          to_item_id: itemId,
          kind: dependency.kind === "SS" ? "SS" : "FS",
          note: dependency.note ?? null,
        }));

      if (dependencyRows.length > 0) {
        const { error: insertError } = await supabase.from("timeline_dependencies").insert(dependencyRows);
        if (insertError) {
          console.error("Failed to persist timeline dependencies", insertError);
        }
      }
    }
  }

  const { data: entryRow, error: entryError } = await supabase
    .from("timeline_entries")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();

  if (entryError) {
    return formatError(entryError.message, 500);
  }

  if (!entryRow) {
    return formatError("Failed to load updated item", 500);
  }

  const item: TimelineItemRecord = mapTimelineItemRow(entryRow);

  return NextResponse.json({ item });
}

export async function DELETE(request: Request, { params }: Params) {
  const { projectId, itemId } = params;
  if (!projectId || !itemId) {
    return formatError("Project id and item id are required", 400);
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
    .from("project_items")
    .delete()
    .eq("id", itemId)
    .eq("project_id", projectId);

  if (error) {
    return formatError(error.message, 400);
  }

  return NextResponse.json({ success: true });
}
