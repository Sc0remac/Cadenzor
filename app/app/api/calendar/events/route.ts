import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { mapProjectSourceRow } from "@/lib/projectMappers";
import type { CalendarEventRecord, ProjectSourceRecord } from "@kazador/shared";

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

  let query = supabase
    .from("calendar_events")
    .select(
      `id, source_id, calendar_id, event_id, summary, description, location, status, start_at, end_at, is_all_day, timezone, organizer, attendees, hangout_link, raw, assigned_project_id, assigned_timeline_item_id, assigned_by, assigned_at, ignore, created_at, updated_at, project_sources:project_sources(id, project_id, kind, external_id, title, metadata))`,
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

  const events: CalendarEventRecord[] = (data ?? []).map((row: any) => {
    const sourceRow = row.project_sources ?? null;
    let source: ProjectSourceRecord | undefined;
    if (sourceRow) {
      source = mapProjectSourceRow(sourceRow);
    }

    return {
      id: row.id as string,
      sourceId: row.source_id as string,
      calendarId: row.calendar_id as string,
      eventId: row.event_id as string,
      summary: row.summary ?? null,
      description: row.description ?? null,
      location: row.location ?? null,
      status: row.status ?? null,
      startAt: row.start_at ?? null,
      endAt: row.end_at ?? null,
      isAllDay: Boolean(row.is_all_day),
      timezone: row.timezone ?? null,
      organizer: row.organizer ?? null,
      attendees: row.attendees ?? null,
      hangoutLink: row.hangout_link ?? null,
      raw: (row.raw as Record<string, unknown>) ?? {},
      assignedProjectId: row.assigned_project_id ?? null,
      assignedTimelineItemId: row.assigned_timeline_item_id ?? null,
      assignedBy: row.assigned_by ?? null,
      assignedAt: row.assigned_at ?? null,
      ignore: Boolean(row.ignore),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      source,
    } satisfies CalendarEventRecord;
  });

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
