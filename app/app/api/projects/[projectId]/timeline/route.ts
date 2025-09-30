import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapTimelineItemRow } from "../../../../../lib/projectMappers";
import type { TimelineItemType } from "@cadenzor/shared";

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
    .from("timeline_items")
    .select("*")
    .eq("project_id", projectId)
    .order("starts_at", { ascending: true });

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ items: (data ?? []).map(mapTimelineItemRow) });
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
    type: TimelineItemType;
    startsAt?: string | null;
    endsAt?: string | null;
    lane?: string | null;
    territory?: string | null;
    status?: string | null;
    priority?: number;
    refTable?: string | null;
    refId?: string | null;
    metadata?: Record<string, unknown>;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.title || !payload?.type) {
    return formatError("title and type are required", 400);
  }

  const insertPayload = {
    project_id: projectId,
    title: payload.title,
    type: payload.type,
    starts_at: payload.startsAt ?? null,
    ends_at: payload.endsAt ?? null,
    lane: payload.lane ?? null,
    territory: payload.territory ?? null,
    status: payload.status ?? null,
    priority: payload.priority ?? 0,
    ref_table: payload.refTable ?? null,
    ref_id: payload.refId ?? null,
    metadata: payload.metadata ?? {},
    created_by: user.id,
  };

  const { data, error } = await supabase
    .from("timeline_items")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Failed to create timeline item", 500);
  }

  return NextResponse.json({ item: mapTimelineItemRow(data) });
}
