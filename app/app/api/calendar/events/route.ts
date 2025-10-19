import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { mapProjectSourceRow } from "@/lib/projectMappers";
import { assertProjectRole } from "@/lib/projectAccess";
import { recordAuditLog } from "@/lib/auditLog";
import {
  ensureCalendarOAuthClient,
  createCalendarClient,
  createCalendarEvent,
  getCalendarAccountById,
} from "@/lib/googleCalendarClient";
import { mapGoogleEventToTimelineItem } from "@/lib/calendarMapper";
import { ensureProjectTimelineItem, mapCalendarEventRow } from "@/lib/calendarEventUtils";
import type { CalendarEventRecord, TimelineItemRecord } from "@kazador/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value == null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms);
}

function normaliseDateInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isValidDate(trimmed) ? trimmed : null;
}

function normaliseTimeInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
  const [hours, minutes] = trimmed.split(":").map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function addMinutesToTime(time: string, minutesToAdd: number): { time: string; dayOffset: number } {
  const [hours, minutes] = time.split(":").map((part) => Number.parseInt(part, 10));
  const totalMinutes = hours * 60 + minutes + minutesToAdd;
  const dayOffset = Math.floor(totalMinutes / (24 * 60));
  const normalizedMinutes = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const nextHours = Math.floor(normalizedMinutes / 60);
  const nextMinutes = normalizedMinutes % 60;
  return {
    time: `${nextHours.toString().padStart(2, "0")}:${nextMinutes.toString().padStart(2, "0")}`,
    dayOffset,
  };
}

function shiftDate(value: string, days: number): string {
  const base = new Date(`${value}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function sanitiseText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

interface CreateCalendarEventPayload {
  summary: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  description?: string | null;
  location?: string | null;
  projectId?: string | null;
  projectSourceId?: string | null;
  userSourceId?: string | null;
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return formatError(auth.error, auth.status);
  }

  const { supabase } = auth;
  const url = new URL(request.url);
  const assignedFilter = url.searchParams.get("assigned") ?? "unassigned";
  const sourceId = url.searchParams.get("sourceId");
  const projectId = url.searchParams.get("projectId");
  const calendarId = url.searchParams.get("calendarId");
  const includeIgnored = parseBoolean(url.searchParams.get("includeIgnored")) ?? false;
  const searchQuery = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const rangeStart = url.searchParams.get("rangeStart");
  const rangeEnd = url.searchParams.get("rangeEnd");
  const originFilter = (url.searchParams.get("origin") ?? "all").toLowerCase();
  const syncStatusParam = url.searchParams.get("syncStatus");
  const pendingActionFilter = url.searchParams.get("pendingAction");

  let query = supabase
    .from("calendar_events")
    .select(
      `id, source_id, user_source_id, calendar_id, event_id, summary, description, location, status, start_at, end_at, is_all_day, timezone, organizer, attendees, hangout_link, raw, assigned_project_id, assigned_timeline_item_id, assigned_by, assigned_at, ignore, origin, sync_status, sync_error, last_synced_at, last_google_updated_at, last_kazador_updated_at, google_etag, pending_action, created_at, updated_at, project_sources:project_sources(id, project_id, kind, external_id, title, metadata), user_calendar_sources:user_calendar_sources(id, user_id, calendar_id, account_id, summary, timezone, primary_calendar, access_role, metadata, last_synced_at, created_at, updated_at))`,
      { count: "exact" }
    )
    .order("start_at", { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (!includeIgnored) {
    query = query.eq("ignore", false);
  }

  if (assignedFilter === "assigned") {
    query = query.not("assigned_project_id", "is", null);
  } else if (assignedFilter === "unassigned") {
    query = query.is("assigned_project_id", null);
  }

  if (sourceId) {
    query = query.eq("source_id", sourceId);
  }

  if (projectId) {
    query = query.eq("assigned_project_id", projectId);
  }

  if (calendarId) {
    query = query.eq("calendar_id", calendarId);
  }

  if (rangeStart) {
    query = query.gte("start_at", rangeStart);
  }
  if (rangeEnd) {
    query = query.lte("start_at", rangeEnd);
  }

  if (originFilter === "google") {
    query = query.eq("origin", "google");
  } else if (originFilter === "kazador" || originFilter === "local") {
    query = query.eq("origin", "kazador");
  }

  if (syncStatusParam) {
    const allowedStatuses = new Set([
      "pending",
      "synced",
      "failed",
      "deleted",
      "needs_update",
      "delete_pending",
    ]);
    const statuses = syncStatusParam
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => allowedStatuses.has(value));
    if (statuses.length > 0) {
      query = query.in("sync_status", statuses);
    }
  }

  if (pendingActionFilter) {
    const normalised = pendingActionFilter.toLowerCase();
    if (normalised === "any") {
      query = query.not("pending_action", "is", null);
    } else if (normalised === "none") {
      query = query.is("pending_action", null);
    } else if (["create", "update", "delete"].includes(normalised)) {
      query = query.eq("pending_action", normalised);
    }
  }

  if (searchQuery.length > 0) {
    query = query.or(
      [
        `summary.ilike.%${searchQuery}%`,
        `description.ilike.%${searchQuery}%`,
        `location.ilike.%${searchQuery}%`,
      ].join(",")
    );
  }

  const { data, error, count } = await query;
  if (error) {
    return formatError(error.message, 500);
  }

  const events: CalendarEventRecord[] = (data ?? []).map((row: any) => mapCalendarEventRow(row));

  return NextResponse.json({
    events,
    count: count ?? events.length,
    pagination: {
      limit,
      offset,
      total: count ?? events.length,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return formatError(auth.error, auth.status);
  }

  const { supabase, user } = auth;

  let payload: CreateCalendarEventPayload;
  try {
    payload = (await request.json()) as CreateCalendarEventPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const summary = sanitiseText(payload.summary);
  if (!summary) {
    return formatError("Event name is required", 400);
  }

  const date = normaliseDateInput(payload.date);
  if (!date) {
    return formatError("A valid event date is required", 400);
  }

  const projectId = sanitiseText(payload.projectId);
  const projectSourceId = sanitiseText(payload.projectSourceId);
  const userSourceId = sanitiseText(payload.userSourceId);

  const hasProject = Boolean(projectId);
  const hasUserCalendar = Boolean(userSourceId);

  if (!hasProject && !hasUserCalendar) {
    return formatError("Select a project or personal calendar to create the event", 400);
  }

  if (hasProject && !projectSourceId) {
    return formatError("Select a connected calendar for the chosen project", 400);
  }

  if (!hasProject && !hasUserCalendar) {
    return formatError("Select a personal calendar to create the event", 400);
  }

  const startTime = normaliseTimeInput(payload.startTime);
  const endTime = normaliseTimeInput(payload.endTime);

  if (endTime && !startTime) {
    return formatError("End time requires a start time", 400);
  }

  if (startTime && endTime && timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    return formatError("End time must be after the start time", 400);
  }

  const description = sanitiseText(payload.description);
  const location = sanitiseText(payload.location);

  let source: ReturnType<typeof mapProjectSourceRow> | null = null;
  let projectRow: { id: string; name: string | null } | null = null;
  let accountId: string | undefined;
  let calendarId: string | undefined;
  let calendarSummary = "Calendar";
  let calendarTimezone: string | null = null;
  let userCalendarSourceId: string | null = null;

  if (hasProject && projectId) {
    try {
      await assertProjectRole(supabase, projectId, user.id, "editor");
    } catch (err: any) {
      return formatError(err?.message || "Forbidden", err?.status ?? 403);
    }

    const { data: sourceRow, error: sourceError } = await supabase
      .from("project_sources")
      .select("*")
      .eq("id", projectSourceId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (sourceError) {
      return formatError(sourceError.message, 500);
    }

    if (!sourceRow || sourceRow.kind !== "calendar") {
      return formatError("Project calendar source not found", 404);
    }

    source = mapProjectSourceRow(sourceRow);
    const metadata = (source.metadata as Record<string, unknown> | null) ?? {};
    accountId = metadata.accountId as string | undefined;
    calendarId = metadata.calendarId as string | undefined;
    calendarSummary = (metadata.calendarSummary as string | undefined) ?? source.title ?? "Calendar";
    calendarTimezone = (metadata.calendarTimezone as string | undefined) ?? null;

    if (!accountId || !calendarId) {
      return formatError("Project calendar source is missing Google account linkage", 400);
    }

    const { data: projectRowData, error: projectError } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      return formatError(projectError.message, 500);
    }

    if (!projectRowData) {
      return formatError("Project not found", 404);
    }

    projectRow = projectRowData;
  } else if (hasUserCalendar && userSourceId) {
    const { data: userSourceRow, error: userSourceError } = await supabase
      .from("user_calendar_sources")
      .select("*")
      .eq("id", userSourceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (userSourceError) {
      return formatError(userSourceError.message, 500);
    }

    if (!userSourceRow) {
      return formatError("Personal calendar source not found", 404);
    }

    accountId = (userSourceRow.account_id as string | undefined) ?? undefined;
    calendarId = (userSourceRow.calendar_id as string | undefined) ?? undefined;
    calendarSummary = userSourceRow.summary ?? userSourceRow.calendar_id ?? "Calendar";
    calendarTimezone = userSourceRow.timezone ?? null;
    userCalendarSourceId = userSourceId;

    if (!accountId || !calendarId) {
      return formatError("Reconnect Google Calendar to refresh credentials", 400);
    }
  }

  if (!accountId || !calendarId) {
    return formatError("A linked Google Calendar could not be resolved", 400);
  }

  const account = await getCalendarAccountById(supabase, accountId);
  if (!account || account.userId !== user.id) {
    return formatError("Reconnect Google Calendar to refresh credentials", 403);
  }

  const oauthClient = await ensureCalendarOAuthClient(supabase, account);
  const calendar = createCalendarClient(oauthClient);

  const timezone = calendarTimezone ?? "UTC";
  const resolvedCalendarId = calendarId as string;
  const assignedProjectId = hasProject && projectId ? projectId : null;
  const resolvedProjectSourceId = source?.id ?? null;
  let computedEndTime = endTime ?? null;
  let computedEndDate = date;

  if (startTime && !computedEndTime) {
    const addition = addMinutesToTime(startTime, 60);
    computedEndTime = addition.time;
    if (addition.dayOffset > 0) {
      computedEndDate = shiftDate(date, addition.dayOffset);
    }
  }

  if (startTime && !computedEndTime) {
    computedEndTime = startTime;
  }

  const isTimedEvent = Boolean(startTime);
  const finalEndTime = computedEndTime ?? startTime ?? null;

  const eventPayload: Record<string, unknown> = {
    summary,
    start: isTimedEvent
      ? { dateTime: `${date}T${startTime!}:00`, timeZone: timezone }
      : { date },
    end: isTimedEvent
      ? { dateTime: `${computedEndDate}T${finalEndTime!}:00`, timeZone: timezone }
      : { date: shiftDate(date, 1) },
  };

  if (projectRow && projectId) {
    eventPayload.extendedProperties = {
      private: {
        kazadorProjectId: projectId,
        kazadorProjectName: projectRow.name ?? undefined,
      },
    };
  }

  if (description) {
    eventPayload.description = description;
  }
  if (location) {
    eventPayload.location = location;
  }

  let createdEvent;
  try {
    createdEvent = await createCalendarEvent(calendar, resolvedCalendarId, eventPayload);
  } catch (err: any) {
    return formatError(err?.message || "Failed to create Google Calendar event", 502);
  }

  if (!createdEvent?.id) {
    return formatError("Google Calendar did not return a created event id", 502);
  }

  let timelineItem: TimelineItemRecord | null = null;
  let assignedTimelineItemId: string | null = null;

  if (source && assignedProjectId) {
    const mapping = mapGoogleEventToTimelineItem(createdEvent, {
      projectId: assignedProjectId,
      projectSourceId: source.id,
      calendarSummary,
      calendarTimezone,
    });

    if (mapping) {
      timelineItem = mapping as TimelineItemRecord;
      try {
        assignedTimelineItemId = await ensureProjectTimelineItem(
          supabase,
          { assigned_timeline_item_id: null },
          mapping,
          assignedProjectId,
          source.id,
          user.id
        );
      } catch (err: any) {
        return formatError(err?.message || "Failed to sync timeline item", 500);
      }
    }
  }

  const nowIso = new Date().toISOString();
  const timezoneValue =
    createdEvent.start?.timeZone ??
    createdEvent.end?.timeZone ??
    createdEvent.originalStartTime?.timeZone ??
    calendarTimezone ??
    null;

  const insertPayload: Record<string, unknown> = {
    source_id: resolvedProjectSourceId,
    user_source_id: userCalendarSourceId,
    calendar_id: resolvedCalendarId,
    event_id: createdEvent.id,
    summary: createdEvent.summary ?? summary,
    description: createdEvent.description ?? description,
    location: createdEvent.location ?? location,
    status: createdEvent.status ?? null,
    start_at: createdEvent.start?.dateTime ?? createdEvent.start?.date ?? null,
    end_at: createdEvent.end?.dateTime ?? createdEvent.end?.date ?? null,
    is_all_day: Boolean(createdEvent.start?.date && !createdEvent.start?.dateTime),
    timezone: timezoneValue,
    organizer: createdEvent.organizer ?? null,
    attendees: createdEvent.attendees ?? null,
    hangout_link: createdEvent.hangoutLink ?? null,
    raw: JSON.parse(JSON.stringify(createdEvent)),
    assigned_project_id: assignedProjectId,
    assigned_timeline_item_id: assignedTimelineItemId,
    assigned_by: assignedProjectId ? user.id : null,
    assigned_at: assignedProjectId ? nowIso : null,
    ignore: false,
    origin: "kazador",
    sync_status: "synced",
    pending_action: null,
    last_synced_at: nowIso,
    last_google_updated_at: createdEvent.updated ?? nowIso,
    last_kazador_updated_at: nowIso,
  };

  const { data: insertedRow, error: insertError } = await supabase
    .from("calendar_events")
    .insert(insertPayload)
    .select("*, project_sources:project_sources(*), user_calendar_sources:user_calendar_sources(*)")
    .maybeSingle();

  if (insertError) {
    return formatError(insertError.message, 500);
  }

  if (!insertedRow) {
    return formatError("Failed to save calendar event", 500);
  }

  const mappedEvent = mapCalendarEventRow(insertedRow);

  try {
    await recordAuditLog(supabase, {
      projectId: assignedProjectId,
      userId: user.id,
      action: "calendar.event.created",
      entity: "calendar_event",
      refId: mappedEvent.id,
      metadata: {
        calendarEventId: createdEvent.id,
        calendarSourceId: resolvedProjectSourceId ?? null,
        userCalendarSourceId,
        summary,
      },
    });
  } catch (err) {
    // ignore audit failures
  }

  return NextResponse.json({ success: true, event: mappedEvent, timelineItem });
}
