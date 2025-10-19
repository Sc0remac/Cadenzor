import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import { mapProjectSourceRow, mapTimelineItemRow } from "@/lib/projectMappers";
import {
  getCalendarAccountById,
  ensureCalendarOAuthClient,
  createCalendarClient,
  createCalendarEvent,
  updateCalendarEvent,
} from "@/lib/googleCalendarClient";
import { buildGoogleEventFromTimelineItem } from "@/lib/calendarMapper";
import { recordAuditLog } from "@/lib/auditLog";
import type { TimelineItemRecord } from "@kazador/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

interface CalendarSyncPayload {
  sourceId: string;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function fetchTimelineItem(
  supabase: SupabaseClient,
  projectId: string,
  itemId: string
): Promise<TimelineItemRecord> {
  const { data: entryRow, error: entryError } = await supabase
    .from("timeline_entries")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", itemId)
    .maybeSingle();

  if (entryError) {
    throw new Error(entryError.message);
  }
  if (!entryRow) {
    throw new Error("Timeline item not found");
  }

  return mapTimelineItemRow(entryRow);
}

async function fetchProjectItemRaw(
  supabase: SupabaseClient,
  projectId: string,
  itemId: string
) {
  const { data, error } = await supabase
    .from("project_items")
    .select("id, project_id, labels, links")
    .eq("project_id", projectId)
    .eq("id", itemId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Timeline item not found");
  }
  return data;
}

function mergeJson<T extends Record<string, unknown>>(base: any, patch: Record<string, unknown>): Record<string, unknown> {
  const initial = typeof base === "object" && base != null ? { ...base } : {};
  return { ...initial, ...patch };
}

async function handleSync(
  request: Request,
  { params }: { params: { projectId: string; itemId: string } },
  method: "create" | "update"
) {
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

  let payload: CalendarSyncPayload;
  try {
    payload = (await request.json()) as CalendarSyncPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.sourceId) {
    return formatError("sourceId is required", 400);
  }

  const { data: sourceRow, error: sourceError } = await supabase
    .from("project_sources")
    .select("*")
    .eq("id", payload.sourceId)
    .eq("project_id", projectId)
    .eq("kind", "calendar")
    .maybeSingle();

  if (sourceError) {
    return formatError(sourceError.message, 500);
  }
  if (!sourceRow) {
    return formatError("Calendar source not found", 404);
  }

  const source = mapProjectSourceRow(sourceRow);
  const metadata = (source.metadata ?? {}) as Record<string, unknown>;
  const accountId = metadata.accountId as string | undefined;
  const connectedBy = metadata.connectedBy as string | undefined;
  const calendarId = metadata.calendarId as string | undefined;
  const calendarSummary = (metadata.calendarSummary as string | undefined) ?? source.title ?? "Google Calendar";
  const calendarTimezone = (metadata.calendarTimezone as string | undefined) ?? null;

  if (!calendarId || !accountId) {
    return formatError("Calendar source metadata is incomplete", 400);
  }

  if (connectedBy && connectedBy !== user.id) {
    return formatError("Only the teammate who connected this calendar can sync events right now", 403);
  }

  let account;
  try {
    account = await getCalendarAccountById(supabase, accountId);
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Google account", 500);
  }

  if (!account || account.userId !== user.id) {
    return formatError("Reconnect Google Calendar to refresh credentials", 404);
  }

  let authClient;
  try {
    authClient = await ensureCalendarOAuthClient(supabase, account);
  } catch (err: any) {
    return formatError(err?.message || "Calendar authentication failed", 500);
  }

  let projectItemRow;
  let timelineItem: TimelineItemRecord;
  try {
    projectItemRow = await fetchProjectItemRaw(supabase, projectId, itemId);
    timelineItem = await fetchTimelineItem(supabase, projectId, itemId);
  } catch (err: any) {
    return formatError(err?.message || "Timeline item not found", 404);
  }

  const existingLinks = (projectItemRow.links as Record<string, unknown> | null) ?? {};
  const existingLabels = (projectItemRow.labels as Record<string, unknown> | null) ?? {};
  const existingCalendarId = typeof existingLinks.calendarId === "string" ? (existingLinks.calendarId as string) : null;

  if (method === "create" && existingCalendarId) {
    return formatError("This timeline item is already linked to Google Calendar", 400);
  }
  if (method === "update" && !existingCalendarId) {
    return formatError("Timeline item is not linked to Google Calendar yet", 400);
  }

  const calendar = createCalendarClient(authClient);

  const eventPayload = buildGoogleEventFromTimelineItem(timelineItem, {
    projectId,
    calendarSummary,
    calendarTimezone,
  });

  let eventResponse;
  try {
    if (method === "create") {
      eventResponse = await createCalendarEvent(calendar, calendarId, eventPayload);
    } else {
      eventResponse = await updateCalendarEvent(calendar, calendarId, existingCalendarId!, eventPayload);
    }
  } catch (err: any) {
    return formatError(err?.message || "Google Calendar API request failed", 502);
  }

  const nowIso = new Date().toISOString();
  const updatedLinks = mergeJson(existingLinks, {
    calendarId: eventResponse.id ?? existingCalendarId,
    calendarSourceId: payload.sourceId,
    meetingUrl: eventResponse.hangoutLink ?? existingLinks.meetingUrl ?? null,
    calendarSyncedAt: nowIso,
  });

  const updatedLabels = mergeJson(existingLabels, {
    calendarTitle: calendarSummary,
    calendarSourceId: payload.sourceId,
    calendarSyncedAt: nowIso,
  });

  const { error: updateError } = await supabase
    .from("project_items")
    .update({
      links: updatedLinks,
      labels: updatedLabels,
    })
    .eq("id", itemId)
    .eq("project_id", projectId);

  if (updateError) {
    return formatError(updateError.message, 500);
  }

  let refreshed: TimelineItemRecord;
  try {
    refreshed = await fetchTimelineItem(supabase, projectId, itemId);
  } catch (err: any) {
    return formatError(err?.message || "Failed to reload timeline item", 500);
  }

  try {
    await recordAuditLog(supabase, {
      projectId,
      userId: user.id,
      action: method === "create" ? "calendar.event.created" : "calendar.event.updated",
      entity: "project_item",
      refId: itemId,
      metadata: {
        calendarId: eventResponse.id ?? existingCalendarId,
        sourceId: payload.sourceId,
        summary: refreshed.title,
      },
    });
  } catch (err) {
    // ignore audit failures
  }

  return NextResponse.json({ item: refreshed });
}

export async function POST(request: Request, context: { params: { projectId: string; itemId: string } }) {
  return handleSync(request, context, "create");
}

export async function PATCH(request: Request, context: { params: { projectId: string; itemId: string } }) {
  return handleSync(request, context, "update");
}
