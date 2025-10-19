import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  getCalendarAccountById,
  ensureCalendarOAuthClient,
  createCalendarClient,
  listCalendarEvents,
} from "@/lib/googleCalendarClient";
import { mapGoogleEventToTimelineItem } from "@/lib/calendarMapper";
import { mapTimelineItemRow, mapProjectSourceRow } from "@/lib/projectMappers";
import type { TimelineItemRecord } from "@kazador/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PullPayload {
  rangeStart?: string | null;
  rangeEnd?: string | null;
  maxEvents?: number;
  includeCancelled?: boolean;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: { projectId: string; sourceId: string } }
) {
  const { projectId, sourceId } = params;
  if (!projectId || !sourceId) {
    return formatError("Project id and source id are required", 400);
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

  let payload: PullPayload = {};
  try {
    if (request.headers.get("content-length")) {
      payload = (await request.json()) as PullPayload;
    }
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const { data: sourceRow, error: sourceError } = await supabase
    .from("project_sources")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", sourceId)
    .eq("kind", "calendar")
    .maybeSingle();

  if (sourceError) {
    return formatError(sourceError.message, 500);
  }

  if (!sourceRow) {
    return formatError("Calendar source not found", 404);
  }

  const metadata = (sourceRow.metadata as Record<string, unknown>) ?? {};
  const accountId = metadata.accountId as string | undefined;
  const connectedBy = metadata.connectedBy as string | undefined;
  const calendarId = metadata.calendarId as string | undefined;
  const calendarSummary = (metadata.calendarSummary as string | undefined) ?? sourceRow.title ?? calendarId ?? "";
  const calendarTimezone = (metadata.calendarTimezone as string | undefined) ?? null;

  if (!calendarId) {
    return formatError("Calendar source is missing the remote calendar id", 400);
  }

  if (!accountId) {
    return formatError("Calendar source is missing account linkage", 400);
  }

  let account;
  try {
    account = await getCalendarAccountById(supabase, accountId);
  } catch (err: any) {
    return formatError(err?.message || "Failed to load calendar account", 500);
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

  const calendar = createCalendarClient(authClient);

  const now = new Date();
  const defaultStart = new Date(now.getTime() - 4 * 60 * 60 * 1000); // include recent past for updates
  const defaultEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // ~12 months ahead

  const rangeStartIso = payload.rangeStart ?? defaultStart.toISOString();
  const rangeEndIso = payload.rangeEnd ?? defaultEnd.toISOString();
  const maxEvents = payload.maxEvents && payload.maxEvents > 0 ? payload.maxEvents : 500;

  let events;
  try {
    events = await listCalendarEvents(calendar, calendarId, {
      timeMin: rangeStartIso,
      timeMax: rangeEndIso,
      maxResults,
      singleEvents: true,
    });
  } catch (err: any) {
    return formatError(err?.message || "Failed to list calendar events", 500);
  }

  const eventIds = events.map((event) => event.id).filter((id): id is string => Boolean(id));

  const existingEventsMap = new Map<string, any>();
  if (eventIds.length > 0) {
    const { data: existingEvents, error: existingEventsError } = await supabase
      .from("calendar_events")
      .select("*")
      .eq("source_id", sourceId)
      .in("event_id", eventIds);

    if (existingEventsError) {
      return formatError(existingEventsError.message, 500);
    }

    for (const row of existingEvents ?? []) {
      existingEventsMap.set(row.event_id as string, row);
    }
  }

  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  let skipped = 0;
  let cancelled = 0;

  const calendarUpserts: Record<string, unknown>[] = [];

  for (const event of events) {
    if (!event || !event.id) {
      skipped += 1;
      continue;
    }

    const existingEvent = existingEventsMap.get(event.id) ?? null;
    const assignedProjectId = existingEvent
      ? (existingEvent.assigned_project_id as string | null)
      : projectId;
    const ignoreEvent = existingEvent ? Boolean(existingEvent.ignore) : false;

    const startAt = event.start?.dateTime ?? event.start?.date ?? null;
    const endAt = event.end?.dateTime ?? event.end?.date ?? null;
    const timezone =
      event.start?.timeZone ?? event.end?.timeZone ?? event.originalStartTime?.timeZone ?? calendarTimezone ?? null;

    if (event.status === "cancelled" && !payload.includeCancelled) {
      cancelled += 1;
    }

    let timelineItemId: string | null = existingEvent?.assigned_timeline_item_id ?? null;
    const timelineProjectId = assignedProjectId ?? null;

    if (timelineProjectId && !ignoreEvent) {
      const mapping = mapGoogleEventToTimelineItem(event, {
        projectId: timelineProjectId,
        projectSourceId: sourceId,
        calendarSummary,
        calendarTimezone,
      });

      if (mapping) {
        const nextLabels = { ...(mapping.labels ?? {}), lane: mapping.lane };
        const nextLinks = { ...(mapping.links ?? {}), calendarSourceId: sourceId };

        if (timelineItemId) {
          const { error: updateItemError } = await supabase
            .from("project_items")
            .update({
              type: mapping.type,
              kind: "calendar_event",
              title: mapping.title,
              description: mapping.description,
              start_at: mapping.startsAt,
              end_at: mapping.endsAt,
              due_at: null,
              tz: mapping.timezone,
              status: mapping.status,
              priority_score: mapping.priorityScore,
              priority_components: mapping.priorityComponents ?? { source: "calendar" },
              labels: nextLabels,
              links: nextLinks,
            })
            .eq("id", timelineItemId)
            .eq("project_id", timelineProjectId);

          if (updateItemError && updateItemError.code !== "PGRST116") {
            return formatError(updateItemError.message, 500);
          }

          if (timelineProjectId === projectId && !createdIds.includes(timelineItemId)) {
            updatedIds.push(timelineItemId);
          }
        } else {
          const insertPayload = {
            project_id: timelineProjectId,
            type: mapping.type,
            kind: "calendar_event",
            title: mapping.title,
            description: mapping.description,
            start_at: mapping.startsAt,
            end_at: mapping.endsAt,
            due_at: null,
            tz: mapping.timezone,
            status: mapping.status,
            priority_score: mapping.priorityScore,
            priority_components: mapping.priorityComponents ?? { source: "calendar" },
            labels: nextLabels,
            links: nextLinks,
            created_by: user.id,
          } satisfies Record<string, unknown>;

          const { data: insertRow, error: insertError } = await supabase
            .from("project_items")
            .insert(insertPayload)
            .select("id")
            .maybeSingle();

          if (insertError) {
            return formatError(insertError.message, 500);
          }

          timelineItemId = insertRow?.id ?? null;
          if (timelineItemId && timelineProjectId === projectId) {
            createdIds.push(timelineItemId);
          }
        }
      } else {
        skipped += 1;
      }
    } else if (timelineItemId) {
      await supabase.from("project_items").delete().eq("id", timelineItemId).eq("project_id", timelineProjectId);
      timelineItemId = null;
    }

    calendarUpserts.push({
      id: existingEvent?.id ?? undefined,
      source_id: sourceId,
      calendar_id: calendarId,
      event_id: event.id,
      summary: event.summary ?? null,
      description: event.description ?? null,
      location: event.location ?? null,
      status: event.status ?? null,
      start_at: startAt,
      end_at: endAt,
      is_all_day: Boolean(event.start?.date && !event.start?.dateTime),
      timezone,
      organizer: event.organizer ?? null,
      attendees: event.attendees ?? null,
      hangout_link: event.hangoutLink ?? null,
      raw: event,
      assigned_project_id: timelineProjectId,
      assigned_timeline_item_id: timelineItemId,
      assigned_by: timelineProjectId
        ? existingEvent?.assigned_by ?? user.id
        : existingEvent?.assigned_by ?? null,
      assigned_at: timelineProjectId
        ? existingEvent?.assigned_at ?? new Date().toISOString()
        : existingEvent?.assigned_at ?? null,
      ignore: ignoreEvent,
    });
  }

  if (calendarUpserts.length > 0) {
    const { error: upsertError } = await supabase
      .from("calendar_events")
      .upsert(calendarUpserts, { onConflict: "source_id,event_id" });

    if (upsertError) {
      return formatError(upsertError.message, 500);
    }
  }

  const nowIso = new Date().toISOString();
  const updatedMetadata = {
    ...(metadata ?? {}),
    calendarSummary,
    calendarTimezone,
    lastSyncedAt: nowIso,
    lastSyncRange: { start: rangeStartIso, end: rangeEndIso },
    lastSyncCounts: {
      processed: events.length,
      inserted: createdIds.length,
      updated: updatedIds.length,
      skipped,
      cancelled,
    },
    connectedBy: user.id,
  } satisfies Record<string, unknown>;

  const { data: updatedSource, error: updateSourceError } = await supabase
    .from("project_sources")
    .update({
      metadata: updatedMetadata,
      last_indexed_at: nowIso,
    })
    .eq("id", sourceId)
    .eq("project_id", projectId)
    .select("*")
    .maybeSingle();

  if (updateSourceError) {
    return formatError(updateSourceError.message, 500);
  }

  const idsToLoad = [...new Set([...createdIds, ...updatedIds])];
  let items: TimelineItemRecord[] = [];
  if (idsToLoad.length > 0) {
    const { data: entryRows, error: entryError } = await supabase
      .from("timeline_entries")
      .select("*")
      .in("id", idsToLoad);

    if (entryError) {
      return formatError(entryError.message, 500);
    }

    items = (entryRows ?? []).map(mapTimelineItemRow);
  }

  return NextResponse.json({
    source: updatedSource ? mapProjectSourceRow(updatedSource) : mapProjectSourceRow(sourceRow),
    summary: {
      processed: events.length,
      inserted: createdIds.length,
      updated: updatedIds.length,
      skipped,
      cancelled,
      rangeStart: rangeStartIso,
      rangeEnd: rangeEndIso,
    },
    items,
  });
}
