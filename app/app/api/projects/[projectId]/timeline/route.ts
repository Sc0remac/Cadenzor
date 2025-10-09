import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapTimelineItemRow } from "../../../../../lib/projectMappers";
import {
  getTimelineLaneForType,
  normaliseTimelineItemStatus,
  normaliseTimelineItemType,
  type TimelineItemType,
  type TimelineItemRecord,
} from "@kazador/shared";

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
    .from("timeline_entries")
    .select("*")
    .eq("project_id", projectId)
    .order("start_at", { ascending: true, nullsFirst: true })
    .order("due_at", { ascending: true, nullsFirst: true });

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ items: (data ?? []).map(mapTimelineItemRow) });
}

interface CreateTimelineItemPayload {
  title: string;
  type: TimelineItemType | string;
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

  let payload: CreateTimelineItemPayload;

  try {
    payload = (await request.json()) as CreateTimelineItemPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.title) {
    return formatError("title is required", 400);
  }

  const type = normaliseTimelineItemType(payload.type);
  const status = normaliseTimelineItemStatus(payload.status);
  const labels: Record<string, unknown> = payload.labels ? { ...payload.labels } : {};
  if (payload.territory) {
    labels.territory = payload.territory;
  }
  labels.lane = payload.lane ?? getTimelineLaneForType(type);

  const links: Record<string, unknown> = payload.links ? { ...payload.links } : {};

  const insertPayload = {
    project_id: projectId,
    type,
    kind: payload.kind ?? null,
    title: payload.title,
    description: payload.description ?? null,
    start_at: payload.startsAt ?? null,
    end_at: payload.endsAt ?? null,
    due_at: payload.dueAt ?? null,
    tz: payload.timezone ?? null,
    status,
    priority_score: payload.priority ?? null,
    priority_components: payload.priorityComponents ?? {},
    labels,
    links,
    created_by: user.id,
  } satisfies Record<string, unknown>;

  const { data, error } = await supabase
    .from("project_items")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data?.id) {
    return formatError("Failed to create timeline item", 500);
  }

  const { data: entryRow, error: entryError } = await supabase
    .from("timeline_entries")
    .select("*")
    .eq("id", data.id)
    .maybeSingle();

  if (entryError) {
    return formatError(entryError.message, 500);
  }

  const timelineItem: TimelineItemRecord | null = entryRow ? mapTimelineItemRow(entryRow) : null;

  if (Array.isArray(payload.dependencies) && payload.dependencies.length > 0) {
    const dependencyRows = payload.dependencies
      .filter((dependency) => typeof dependency.itemId === "string" && dependency.itemId)
      .map((dependency) => ({
        project_id: projectId,
        from_item_id: dependency.itemId,
        to_item_id: data.id as string,
        kind: dependency.kind === "SS" ? "SS" : "FS",
        note: dependency.note ?? null,
        created_by: user.id,
      }));

    if (dependencyRows.length > 0) {
      const { error: dependencyError } = await supabase
        .from("timeline_dependencies")
        .insert(dependencyRows);

      if (dependencyError) {
        console.error("Failed to insert timeline dependencies", dependencyError);
      }
    }
  }

  if (!timelineItem) {
    return formatError("Failed to load created item", 500);
  }

  return NextResponse.json({ item: timelineItem });
}
