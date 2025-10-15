import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import {
  mapProjectRow,
  mapTimelineDependencyRow,
  mapTimelineItemRow,
  mapLaneDefinitionRow,
  mapProjectTaskRow,
} from "../../../lib/projectMappers";
import type {
  ProjectRecord,
  TimelineItemRecord,
  TimelineItemType,
  TimelineItemStatus,
  TimelineLaneDefinition,
  ProjectTaskRecord,
} from "@kazador/shared";

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function itemMatchesRange(
  item: TimelineItemRecord,
  rangeStartMs: number | null,
  rangeEndMs: number | null
): boolean {
  if (rangeStartMs == null && rangeEndMs == null) {
    return true;
  }

  const timestamps = [item.startsAt, item.endsAt, item.dueAt]
    .map((value) => toMs(value))
    .filter((value): value is number => value != null);

  if (timestamps.length === 0) {
    return false;
  }

  const windowStart = Math.min(...timestamps);
  const windowEnd = Math.max(...timestamps);

  if (rangeStartMs != null && windowEnd < rangeStartMs) {
    return false;
  }

  if (rangeEndMs != null && windowStart > rangeEndMs) {
    return false;
  }

  return true;
}

function toTypeFilter(values: string[]): Set<TimelineItemType> | null {
  if (values.length === 0) return null;
  const allowed: TimelineItemType[] = [
    "LIVE_HOLD",
    "TRAVEL_SEGMENT",
    "PROMO_SLOT",
    "RELEASE_MILESTONE",
    "LEGAL_ACTION",
    "FINANCE_ACTION",
    "TASK",
  ];
  const lookup = new Set(values.map((value) => value.trim().toUpperCase()));
  const filtered = allowed.filter((type) => lookup.has(type));
  return filtered.length > 0 ? new Set(filtered) : null;
}

function toLaneFilter(values: string[]): Set<string> | null {
  if (values.length === 0) return null;
  const normalised = values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
  return normalised.length > 0 ? new Set(normalised) : null;
}

function toStatusFilter(values: string[]): Set<TimelineItemStatus> | null {
  if (values.length === 0) return null;
  const allowed: TimelineItemStatus[] = ["planned", "tentative", "confirmed", "waiting", "done", "canceled"];
  const lookup = new Set(values.map((value) => value.trim().toLowerCase()));
  const filtered = allowed.filter((status) => lookup.has(status));
  return filtered.length > 0 ? new Set(filtered) : null;
}

function normaliseIsoTimestamp(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

function mapTaskStatusToTimelineStatus(status: string | null | undefined): TimelineItemStatus {
  const normalised = (status ?? "").trim().toLowerCase();
  switch (normalised) {
    case "waiting":
      return "waiting";
    case "in_progress":
    case "progress":
    case "doing":
      return "confirmed";
    case "tentative":
      return "tentative";
    case "done":
    case "completed":
      return "done";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "planned";
  }
}

function transformTaskToTimelineItem(task: ProjectTaskRecord): TimelineItemRecord | null {
  if (!task.laneSlug) {
    return null;
  }

  return {
    id: `task:${task.id}`,
    projectId: task.projectId,
    type: "TASK",
    lane: task.laneSlug,
    kind: "task",
    title: task.title,
    description: task.description,
    startsAt: null,
    endsAt: null,
    dueAt: task.dueAt,
    timezone: null,
    status: mapTaskStatusToTimelineStatus(task.status),
    priorityScore: task.priority,
    priorityComponents: null,
    labels: { lane: task.laneSlug },
    links: { taskId: task.id },
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    conflictFlags: null,
    layoutRow: null,
    territory: null,
  } satisfies TimelineItemRecord;
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const typeFilter = toTypeFilter(parseCsv(searchParams.get("types")));
  const laneFilter = toLaneFilter(parseCsv(searchParams.get("lanes")));
  const statusFilter = toStatusFilter(parseCsv(searchParams.get("status")));
  const rangeStart = normaliseIsoTimestamp(searchParams.get("rangeStart"));
  const rangeEnd = normaliseIsoTimestamp(searchParams.get("rangeEnd"));
  const rangeStartMs = rangeStart ? Date.parse(rangeStart) : null;
  const rangeEndMs = rangeEnd ? Date.parse(rangeEnd) : null;

  const { data: membershipRow, error: membershipError } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (!membershipRow) {
    return NextResponse.json({ error: "You do not have access to this project" }, { status: 403 });
  }

  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }

  if (!projectRow) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project: ProjectRecord = mapProjectRow(projectRow);

  const { data: timelineRows, error: timelineError } = await supabase
    .from("timeline_entries")
    .select("*")
    .eq("project_id", projectId)
    .order("start_at", { ascending: true, nullsFirst: false })
    .order("due_at", { ascending: true, nullsFirst: false });

  if (timelineError) {
    return NextResponse.json({ error: timelineError.message }, { status: 500 });
  }

  const { data: taskRows, error: taskError } = await supabase
    .from("project_tasks")
    .select("*, lane:lane_definitions(id, slug, name, color, icon)")
    .eq("project_id", projectId)
    .not("lane_id", "is", null);

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  const { data: dependencyRows, error: dependencyError } = await supabase
    .from("timeline_dependencies")
    .select("*")
    .eq("project_id", projectId);

  if (dependencyError) {
    return NextResponse.json({ error: dependencyError.message }, { status: 500 });
  }

  const { data: laneRows, error: laneError } = await supabase
    .from("lane_definitions")
    .select("*")
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (laneError) {
    return NextResponse.json({ error: laneError.message }, { status: 500 });
  }

  const laneDefinitions: TimelineLaneDefinition[] = (laneRows ?? []).map(mapLaneDefinitionRow);

  const laneLookup = new Map<string, TimelineLaneDefinition>();
  for (const lane of laneDefinitions) {
    laneLookup.set(lane.slug.toLowerCase(), lane);
  }

  const timelineItems = (timelineRows ?? []).map((row) => {
    const mapped = mapTimelineItemRow(row);
    const laneKey = mapped.lane.toLowerCase();
    if (laneLookup.has(laneKey)) {
      return mapped;
    }
    return mapped;
  });
  const tasks = (taskRows ?? []).map(mapProjectTaskRow);
  const taskTimelineItems = tasks
    .map((task) => transformTaskToTimelineItem(task))
    .filter((item): item is TimelineItemRecord => Boolean(item));

  const combinedItems = [...timelineItems, ...taskTimelineItems];
  const filteredItems = combinedItems.filter((item) => itemMatchesRange(item, rangeStartMs, rangeEndMs));

  const itemsByType = typeFilter
    ? filteredItems.filter((item) => typeFilter.has(item.type))
    : filteredItems;
  const itemsByLane = laneFilter
    ? itemsByType.filter((item) => laneFilter.has(item.lane.toLowerCase()))
    : itemsByType;
  const itemsByStatus = statusFilter
    ? itemsByLane.filter((item) => item.status && statusFilter.has(item.status))
    : itemsByLane;

  const allowedIds = new Set(itemsByStatus.map((item) => item.id));
  const dependencies = (dependencyRows ?? [])
    .map(mapTimelineDependencyRow)
    .filter(
      (dependency) => allowedIds.has(dependency.fromItemId) && allowedIds.has(dependency.toItemId)
    );

  return NextResponse.json({ project, items: itemsByStatus, dependencies, lanes: laneDefinitions });
}
