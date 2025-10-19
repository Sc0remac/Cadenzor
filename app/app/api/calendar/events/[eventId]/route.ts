import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  ensureCalendarOAuthClient,
  createCalendarClient,
  updateCalendarEvent,
  getCalendarAccountById,
} from "@/lib/googleCalendarClient";
import { mapGoogleEventToTimelineItem } from "@/lib/calendarMapper";
import { mapProjectSourceRow } from "@/lib/projectMappers";
import type { CalendarEventRecord, TimelineItemRecord } from "@kazador/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AssignPayload {
  action: "assign";
  projectId: string | null;
}

interface IgnorePayload {
  action: "ignore";
  ignore: boolean;
}

type PatchPayload = AssignPayload | IgnorePayload;

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalisePrivateMetadata(existing: Record<string, unknown> | null | undefined) {
  if (!existing || typeof existing !== "object") {
    return {} as Record<string, unknown>;
  }
  return { ...existing } as Record<string, unknown>;
}

async function ensureProjectTimelineItem(
  supabase: any,
  eventRow: any,
  mapping: TimelineItemRecord,
  projectId: string,
  sourceId: string,
  userId: string
): Promise<string | null> {
  if (!mapping) return null;

  if (eventRow.assigned_timeline_item_id) {
    const nextLabels = { ...(mapping.labels ?? {}), lane: mapping.lane };
    const nextLinks = {
      ...(mapping.links ?? {}),
      calendarSourceId: sourceId,
    };

    const { error: updateError } = await supabase
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
      .eq("id", eventRow.assigned_timeline_item_id)
      .eq("project_id", projectId);

    if (updateError) {
      throw new Error(updateError.message);
    }
    return eventRow.assigned_timeline_item_id as string;
  }

  const insertPayload = {
    project_id: projectId,
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
    labels: { ...(mapping.labels ?? {}), lane: mapping.lane },
    links: { ...(mapping.links ?? {}), calendarSourceId: sourceId },
    created_by: userId,
  } satisfies Record<string, unknown>;

  const { data: insertRow, error: insertError } = await supabase
    .from("project_items")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return insertRow?.id ?? null;
}

async function deleteTimelineItem(supabase: any, timelineItemId: string | null, projectId: string | null) {
  if (!timelineItemId || !projectId) return;
  await supabase.from("project_items").delete().eq("id", timelineItemId).eq("project_id", projectId);
}

export async function PATCH(
  request: Request,
  { params }: { params: { eventId: string } }
) {
  const { eventId } = params;
  if (!eventId) {
    return formatError("Event id is required", 400);
  }

  let body: PatchPayload;
  try {
    body = (await request.json()) as PatchPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!body?.action) {
    return formatError("action is required", 400);
  }

  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return formatError(auth.error, auth.status);
  }

  const { supabase, user } = auth;

  const { data: eventRow, error: eventError } = await supabase
    .from("calendar_events")
    .select("*, project_sources:project_sources(*)")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    return formatError(eventError.message, 500);
  }

  if (!eventRow) {
    return formatError("Calendar event not found", 404);
  }

  const sourceRow = eventRow.project_sources;
  const source = sourceRow ? mapProjectSourceRow(sourceRow) : null;
  if (!source) {
    return formatError("Calendar source missing", 500);
  }

  const metadata = (source.metadata as Record<string, unknown> | null) ?? {};
  const accountId = metadata.accountId as string | undefined;
  const calendarId = metadata.calendarId as string | undefined;
  const calendarSummary = (metadata.calendarSummary as string | undefined) ?? source.title ?? "Calendar";
  const calendarTimezone = (metadata.calendarTimezone as string | undefined) ?? null;

  if (!accountId || !calendarId) {
    return formatError("Calendar source is missing account linkage", 400);
  }

  const account = await getCalendarAccountById(supabase, accountId);
  if (!account || account.userId !== user.id) {
    return formatError("Reconnect Google Calendar to refresh credentials", 403);
  }

  const oauthClient = await ensureCalendarOAuthClient(supabase, account);
  const calendar = createCalendarClient(oauthClient);

  const existingEvent = eventRow.raw as Record<string, unknown>;

  if (body.action === "ignore") {
    const { error: updateError } = await supabase
      .from("calendar_events")
      .update({ ignore: body.ignore })
      .eq("id", eventId);

    if (updateError) {
      return formatError(updateError.message, 500);
    }

    if (body.ignore && eventRow.assigned_timeline_item_id) {
      await deleteTimelineItem(supabase, eventRow.assigned_timeline_item_id as string, eventRow.assigned_project_id as string | null);
      await supabase
        .from("calendar_events")
        .update({ assigned_timeline_item_id: null })
        .eq("id", eventId);
    }

    const { data: refreshedRow, error: refreshError } = await supabase
      .from("calendar_events")
      .select("*, project_sources:project_sources(*)")
      .eq("id", eventId)
      .maybeSingle();

    if (refreshError) {
      return formatError(refreshError.message, 500);
    }

    const refreshedEvent = refreshedRow ?? eventRow;
    const mappedEvent: CalendarEventRecord = {
      id: refreshedEvent.id as string,
      sourceId: refreshedEvent.source_id as string,
      calendarId: refreshedEvent.calendar_id as string,
      eventId: refreshedEvent.event_id as string,
      summary: refreshedEvent.summary ?? null,
      description: refreshedEvent.description ?? null,
      location: refreshedEvent.location ?? null,
      status: refreshedEvent.status ?? null,
      startAt: refreshedEvent.start_at ?? null,
      endAt: refreshedEvent.end_at ?? null,
      isAllDay: Boolean(refreshedEvent.is_all_day),
      timezone: refreshedEvent.timezone ?? null,
      organizer: refreshedEvent.organizer ?? null,
      attendees: refreshedEvent.attendees ?? null,
      hangoutLink: refreshedEvent.hangout_link ?? null,
      raw: refreshedEvent.raw as Record<string, unknown>,
      assignedProjectId: refreshedEvent.assigned_project_id ?? null,
      assignedTimelineItemId: refreshedEvent.assigned_timeline_item_id ?? null,
      assignedBy: refreshedEvent.assigned_by ?? null,
      assignedAt: refreshedEvent.assigned_at ?? null,
      ignore: Boolean(refreshedEvent.ignore),
      createdAt: refreshedEvent.created_at as string,
      updatedAt: refreshedEvent.updated_at as string,
      source: source,
    };

    return NextResponse.json({ success: true, event: mappedEvent });
  }

  const targetProjectId = body.projectId;
  let assignedTimelineItemId: string | null = eventRow.assigned_timeline_item_id ?? null;

  if (targetProjectId) {
    try {
      await assertProjectRole(supabase, targetProjectId, user.id, "editor");
    } catch (err: any) {
      return formatError(err?.message || "Forbidden", err?.status ?? 403);
    }
  }

  const privateMetadata = normalisePrivateMetadata(
    (existingEvent?.extendedProperties as Record<string, unknown> | undefined)?.private as Record<string, unknown> | undefined
  );

  if (targetProjectId) {
    privateMetadata.kazadorProjectId = targetProjectId;
  } else {
    delete privateMetadata.kazadorProjectId;
    delete privateMetadata.kazadorItemId;
    delete privateMetadata.kazadorProjectName;
  }

  if (targetProjectId) {
    const { data: projectRow, error: projectError } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", targetProjectId)
      .maybeSingle();

    if (projectError) {
      return formatError(projectError.message, 500);
    }

    if (!projectRow) {
      return formatError("Project not found", 404);
    }

    privateMetadata.kazadorProjectName = projectRow.name;
  }

  const patchPayload = {
    extendedProperties: {
      private: Object.keys(privateMetadata).length > 0 ? privateMetadata : undefined,
    },
  } as any;

  let patchedEvent;
  try {
    patchedEvent = await updateCalendarEvent(calendar, eventRow.calendar_id, eventRow.event_id, patchPayload);
  } catch (err: any) {
    return formatError(err?.message || "Failed to update Google Calendar event", 502);
  }

  let timelineItem: TimelineItemRecord | null = null;
  if (targetProjectId) {
    const mapping = mapGoogleEventToTimelineItem(patchedEvent, {
      projectId: targetProjectId,
      projectSourceId: source.id,
      calendarSummary,
      calendarTimezone,
    });
    if (mapping) {
      timelineItem = mapping;
      try {
        const timelineId = await ensureProjectTimelineItem(
          supabase,
          eventRow,
          mapping,
          targetProjectId,
          source.id,
          user.id
        );
        assignedTimelineItemId = timelineId;
      } catch (err: any) {
        return formatError(err?.message || "Failed to sync timeline item", 500);
      }
    }
  } else {
    if (eventRow.assigned_timeline_item_id) {
      await deleteTimelineItem(supabase, eventRow.assigned_timeline_item_id as string, eventRow.assigned_project_id as string | null);
      assignedTimelineItemId = null;
    }
  }

  const updatePayload: Record<string, unknown> = {
    assigned_project_id: targetProjectId ?? null,
    assigned_at: new Date().toISOString(),
    assigned_by: user.id,
    assigned_timeline_item_id: assignedTimelineItemId,
    ignore: false,
    raw: patchedEvent,
    summary: patchedEvent.summary ?? null,
    description: patchedEvent.description ?? null,
    location: patchedEvent.location ?? null,
    status: patchedEvent.status ?? null,
    start_at: patchedEvent.start?.dateTime ?? patchedEvent.start?.date ?? null,
    end_at: patchedEvent.end?.dateTime ?? patchedEvent.end?.date ?? null,
    timezone:
      patchedEvent.start?.timeZone || patchedEvent.end?.timeZone || patchedEvent.originalStartTime?.timeZone || calendarTimezone,
    is_all_day: Boolean(patchedEvent.start?.date && !patchedEvent.start?.dateTime),
    organizer: patchedEvent.organizer ?? null,
    attendees: patchedEvent.attendees ?? null,
    hangout_link: patchedEvent.hangoutLink ?? null,
  };

  const { error: updateEventError } = await supabase
    .from("calendar_events")
    .update(updatePayload)
    .eq("id", eventId);

  if (updateEventError) {
    return formatError(updateEventError.message, 500);
  }

  const { data: refreshedRow, error: refreshedError } = await supabase
    .from("calendar_events")
    .select("*, project_sources:project_sources(*)")
    .eq("id", eventId)
    .maybeSingle();

  if (refreshedError) {
    return formatError(refreshedError.message, 500);
  }

  const refreshedEvent = refreshedRow ?? eventRow;

  const mappedEvent: CalendarEventRecord = {
    id: refreshedEvent.id as string,
    sourceId: refreshedEvent.source_id as string,
    calendarId: refreshedEvent.calendar_id as string,
    eventId: refreshedEvent.event_id as string,
    summary: refreshedEvent.summary ?? null,
    description: refreshedEvent.description ?? null,
    location: refreshedEvent.location ?? null,
    status: refreshedEvent.status ?? null,
    startAt: refreshedEvent.start_at ?? null,
    endAt: refreshedEvent.end_at ?? null,
    isAllDay: Boolean(refreshedEvent.is_all_day),
    timezone: refreshedEvent.timezone ?? null,
    organizer: refreshedEvent.organizer ?? null,
    attendees: refreshedEvent.attendees ?? null,
    hangoutLink: refreshedEvent.hangout_link ?? null,
    raw: refreshedEvent.raw as Record<string, unknown>,
    assignedProjectId: refreshedEvent.assigned_project_id ?? null,
    assignedTimelineItemId: refreshedEvent.assigned_timeline_item_id ?? null,
    assignedBy: refreshedEvent.assigned_by ?? null,
    assignedAt: refreshedEvent.assigned_at ?? null,
    ignore: Boolean(refreshedEvent.ignore),
    createdAt: refreshedEvent.created_at as string,
    updatedAt: refreshedEvent.updated_at as string,
    source,
  };

  return NextResponse.json({
    success: true,
    event: mappedEvent,
    timelineItem,
  });
}
