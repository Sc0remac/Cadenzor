import type {
  CalendarEventRecord,
  CalendarSyncStatus,
  ProjectSourceRecord,
  TimelineItemRecord,
  UserCalendarSourceRecord,
} from "@kazador/shared";
import { mapProjectSourceRow } from "@/lib/projectMappers";

interface TimelineMapping {
  labels?: Record<string, unknown> | null;
  links?: Record<string, unknown> | null;
  lane: string;
  type: TimelineItemRecord["type"];
  kind?: TimelineItemRecord["kind"];
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  status: TimelineItemRecord["status"];
  priorityScore: number | null;
  priorityComponents?: TimelineItemRecord["priorityComponents"] | null;
}

export function mapCalendarEventRow(row: any): CalendarEventRecord {
  const sourceRow = row.project_sources ?? null;
  let source: ProjectSourceRecord | undefined;
  if (sourceRow) {
    source = mapProjectSourceRow(sourceRow);
  }

  const userSourceRow = row.user_calendar_sources ?? null;
  let userSource: UserCalendarSourceRecord | undefined;
  if (userSourceRow) {
    userSource = {
      id: userSourceRow.id as string,
      userId: userSourceRow.user_id as string,
      calendarId: userSourceRow.calendar_id as string,
      accountId: userSourceRow.account_id as string,
      summary: userSourceRow.summary as string,
      timezone: userSourceRow.timezone ?? null,
      primaryCalendar: Boolean(userSourceRow.primary_calendar),
      accessRole: userSourceRow.access_role ?? null,
      metadata: (userSourceRow.metadata as Record<string, unknown> | null) ?? null,
      lastSyncedAt: userSourceRow.last_synced_at ?? null,
      createdAt: userSourceRow.created_at as string,
      updatedAt: userSourceRow.updated_at as string,
    } satisfies UserCalendarSourceRecord;
  }

  const pendingActionRaw = typeof row.pending_action === "string" ? row.pending_action : null;
  const pendingAction =
    pendingActionRaw === "create" || pendingActionRaw === "update" || pendingActionRaw === "delete"
      ? pendingActionRaw
      : null;

  return {
    id: row.id as string,
    sourceId: row.source_id ?? null,
    userSourceId: row.user_source_id ?? null,
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
    origin: (row.origin as string | undefined) === "kazador" ? "kazador" : "google",
    syncStatus: (() => {
      const status = row.sync_status as string | undefined;
      const validStatuses: CalendarSyncStatus[] = ["pending", "synced", "failed", "deleted", "needs_update", "delete_pending"];
      return status && validStatuses.includes(status as CalendarSyncStatus) ? (status as CalendarSyncStatus) : "pending";
    })(),
    syncError: row.sync_error ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
    lastGoogleUpdatedAt: row.last_google_updated_at ?? null,
    lastKazadorUpdatedAt: row.last_kazador_updated_at ?? null,
    googleEtag: row.google_etag ?? null,
    pendingAction,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    source,
    userSource,
  } satisfies CalendarEventRecord;
}

export async function ensureProjectTimelineItem(
  supabase: any,
  eventRow: any,
  mapping: TimelineMapping,
  projectId: string,
  sourceId: string | null,
  userId: string
): Promise<string | null> {
  if (!mapping) return null;

  if (eventRow.assigned_timeline_item_id) {
    const nextLabels: Record<string, unknown> = { ...(mapping.labels ?? {}), lane: mapping.lane };
    if (sourceId) {
      nextLabels.calendarSourceId = sourceId;
    } else {
      delete nextLabels.calendarSourceId;
    }

    const nextLinks: Record<string, unknown> = { ...(mapping.links ?? {}) };
    if (sourceId) {
      nextLinks.calendarSourceId = sourceId;
    } else {
      delete nextLinks.calendarSourceId;
    }

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

  const baseLinks = { ...(mapping.links ?? {}) };
  if (sourceId) {
    baseLinks.calendarSourceId = sourceId;
  } else {
    delete baseLinks.calendarSourceId;
  }

  const baseLabels = { ...(mapping.labels ?? {}), lane: mapping.lane };
  if (sourceId) {
    baseLabels.calendarSourceId = sourceId;
  } else {
    delete baseLabels.calendarSourceId;
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
    labels: baseLabels,
    links: baseLinks,
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

export async function deleteTimelineItem(
  supabase: any,
  timelineItemId: string | null,
  projectId: string | null
) {
  if (!timelineItemId || !projectId) return;
  await supabase.from("project_items").delete().eq("id", timelineItemId).eq("project_id", projectId);
}
