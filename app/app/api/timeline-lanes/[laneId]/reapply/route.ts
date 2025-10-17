import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { mapLaneDefinitionRow } from "../../../../../lib/projectMappers";
import { resolveAutoAssignedLane, type LaneAutoAssignContext, type TimelineLaneDefinition } from "@kazador/shared";

interface Params {
  params: {
    laneId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, { params }: Params) {
  const { laneId } = params;
  if (!laneId) {
    return formatError("Lane id is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { data: laneRows, error: laneError } = await supabase
    .from("lane_definitions")
    .select("*")
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (laneError) {
    return formatError(laneError.message, 500);
  }

  const laneDefinitions: TimelineLaneDefinition[] = (laneRows ?? []).map(mapLaneDefinitionRow);
  if (!laneDefinitions.some((lane) => lane.id === laneId)) {
    return formatError("Lane not found", 404);
  }

  const { data: taskRows, error: taskError } = await supabase
    .from("project_tasks")
    .select("id, project_id, title, description, status, priority, lane_id, labels")
    .or(`lane_id.is.null,lane_id.eq.${laneId}`)
    .order("updated_at", { ascending: false });

  if (taskError) {
    return formatError(taskError.message, 500);
  }

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const task of taskRows ?? []) {
    const context: LaneAutoAssignContext = {
      type: "task",
      title: task.title ?? "",
      description: task.description ?? null,
      status: task.status ?? null,
      priority: task.priority ?? null,
      labels: task.labels as Record<string, unknown> | null,
    };

    const suggestedLane = resolveAutoAssignedLane(laneDefinitions, context);
    const nextLaneId = suggestedLane?.id ?? null;

    if (nextLaneId === task.lane_id) {
      unchanged += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from("project_tasks")
      .update({ lane_id: nextLaneId })
      .eq("id", task.id)
      .eq("project_id", task.project_id);

    if (updateError) {
      skipped += 1;
      continue;
    }

    updated += 1;
  }

  return NextResponse.json({ updated, unchanged, skipped });
}
