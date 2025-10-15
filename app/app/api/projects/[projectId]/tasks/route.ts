import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapLaneDefinitionRow, mapProjectTaskRow } from "../../../../../lib/projectMappers";
import { resolveAutoAssignedLane, type TimelineLaneDefinition } from "@kazador/shared";

interface Params {
  params: {
    projectId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request, { params }: Params) {
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
    await assertProjectRole(supabase, projectId, user.id, "viewer");
  } catch (err: any) {
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  const { data, error } = await supabase
    .from("project_tasks")
    .select("*, lane:lane_definitions(id, slug, name, color, icon)")
    .eq("project_id", projectId)
    .order("priority", { ascending: false })
    .order("due_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ tasks: (data ?? []).map(mapProjectTaskRow) });
}

export async function POST(request: Request, { params }: Params) {
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

  let payload: {
    title: string;
    description?: string | null;
    status?: string;
    dueAt?: string | null;
    priority?: number;
    assigneeId?: string | null;
    laneId?: string | null;
    laneSlug?: string | null;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.title) {
    return formatError("title is required", 400);
  }

  const title = payload.title.trim();
  const description = payload.description?.trim() || null;
  const status = payload.status ?? "todo";
  const laneIdProvided = Object.prototype.hasOwnProperty.call(payload, "laneId");
  const laneSlugProvided = Object.prototype.hasOwnProperty.call(payload, "laneSlug");
  const explicitNoLane = (laneIdProvided && payload.laneId === null) || (laneSlugProvided && payload.laneSlug === null);
  const laneSelection = {
    laneId:
      typeof payload.laneId === "string" && payload.laneId.trim().length > 0
        ? payload.laneId.trim()
        : null,
    laneSlug:
      typeof payload.laneSlug === "string" && payload.laneSlug.trim().length > 0
        ? payload.laneSlug.trim().toUpperCase()
        : null,
  };

  const { data: laneRows, error: laneError } = await supabase
    .from("lane_definitions")
    .select("*")
    .or(`user_id.eq.${user.id},user_id.is.null`);

  if (laneError) {
    return formatError(laneError.message, 500);
  }

  const laneDefinitions: TimelineLaneDefinition[] = (laneRows ?? []).map(mapLaneDefinitionRow);
  const byId = new Map(laneDefinitions.map((lane) => [lane.id, lane]));
  const bySlug = new Map(laneDefinitions.map((lane) => [lane.slug.toUpperCase(), lane]));

  let laneId: string | null = null;
  if (!explicitNoLane) {
    if (laneSelection.laneId) {
      const selectedLane = byId.get(laneSelection.laneId);
      if (!selectedLane) {
        return formatError("Selected lane is not available", 400);
      }
      laneId = selectedLane.id;
    } else if (laneSelection.laneSlug) {
      const selectedLane = bySlug.get(laneSelection.laneSlug);
      if (!selectedLane) {
        return formatError("Selected lane is not available", 400);
      }
      laneId = selectedLane.id;
    }
  }

  if (!laneId && !explicitNoLane) {
    const autoLane = resolveAutoAssignedLane(laneDefinitions, {
      type: "task",
      title,
      description,
      status,
      priority: payload.priority ?? null,
    });
    laneId = autoLane?.id ?? null;
  }

  const insertPayload = {
    project_id: projectId,
    title,
    description,
    status,
    due_at: payload.dueAt ?? null,
    priority: payload.priority ?? 0,
    assignee_id: payload.assigneeId ?? null,
    created_by: user.id,
    lane_id: laneId,
  };

  const { data, error } = await supabase
    .from("project_tasks")
    .insert(insertPayload)
    .select("*, lane:lane_definitions(id, slug, name, color, icon)")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Failed to create task", 500);
  }

  return NextResponse.json({ task: mapProjectTaskRow(data) });
}
