import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../../lib/projectAccess";
import { mapTimelineItemRow } from "../../../../../../lib/projectMappers";
import type { TimelineItemType } from "@cadenzor/shared";

interface Params {
  params: {
    projectId: string;
    itemId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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

  let payload: Partial<{
    title: string;
    type: TimelineItemType;
    startsAt: string | null;
    endsAt: string | null;
    lane: string | null;
    territory: string | null;
    status: string | null;
    priority: number;
    refTable: string | null;
    refId: string | null;
    metadata: Record<string, unknown>;
    dependencies: Array<{ itemId: string; kind?: "FS" | "SS"; note?: string }>;
  }>;

  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const updatePayload: Record<string, unknown> = {};
  if (payload.title !== undefined) updatePayload["title"] = payload.title;
  if (payload.type !== undefined) updatePayload["type"] = payload.type;
  if (payload.startsAt !== undefined) updatePayload["starts_at"] = payload.startsAt;
  if (payload.endsAt !== undefined) updatePayload["ends_at"] = payload.endsAt;
  if (payload.lane !== undefined) updatePayload["lane"] = payload.lane;
  if (payload.territory !== undefined) updatePayload["territory"] = payload.territory;
  if (payload.status !== undefined) updatePayload["status"] = payload.status;
  if (payload.priority !== undefined) updatePayload["priority"] = payload.priority;
  if (payload.refTable !== undefined) updatePayload["ref_table"] = payload.refTable;
  if (payload.refId !== undefined) updatePayload["ref_id"] = payload.refId;
  if (payload.metadata !== undefined) updatePayload["metadata"] = payload.metadata;

  if (Object.keys(updatePayload).length === 0) {
    return formatError("No fields to update", 400);
  }

  const { data, error } = await supabase
    .from("timeline_items")
    .update(updatePayload)
    .eq("id", itemId)
    .eq("project_id", projectId)
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Timeline item not found", 404);
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

  return NextResponse.json({ item: mapTimelineItemRow(data) });
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
    .from("timeline_items")
    .delete()
    .eq("id", itemId)
    .eq("project_id", projectId);

  if (error) {
    return formatError(error.message, 400);
  }

  return NextResponse.json({ success: true });
}
