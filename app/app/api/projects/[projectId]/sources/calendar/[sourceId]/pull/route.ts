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
    await assertProjectRole(supabase, projectId, user.id, "editor");
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

  if (connectedBy && connectedBy !== user.id) {
    return formatError("Only the teammate who connected this calendar can pull events right now", 403);
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
  const defaultEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // ~60 days ahead

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

  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  let skipped = 0;
  let cancelled = 0;

  try {
    for (const event of events) {
      const mapping = mapGoogleEventToTimelineItem(event, {
        projectId,
        projectSourceId: sourceId,
        calendarSummary,
        calendarTimezone,
      });

      if (!mapping) {
        skipped += 1;
        continue;
      }

      if (mapping.status === "canceled" && !payload.includeCancelled) {
        cancelled += 1;
      }

      const { data: existingRow, error: existingError } = await supabase
        .from("project_items")
        .select("id, labels, links")
        .eq("project_id", projectId)
        .contains("links", { calendarId: mapping.links.calendarId })
        .maybeSingle();

      if (existingError) {
        throw existingError;
      }

      const basePayload = {
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
        labels: mapping.labels,
        links: mapping.links,
      } satisfies Record<string, unknown>;

      if (existingRow?.id) {
        const nextLabels = { ...(existingRow.labels as Record<string, unknown>), ...mapping.labels, lane: mapping.lane };
        const nextLinks = {
          ...(existingRow.links as Record<string, unknown>),
          ...mapping.links,
          calendarSourceId: sourceId,
        };

        const { error: updateError } = await supabase
          .from("project_items")
          .update({
            ...basePayload,
            labels: nextLabels,
            links: nextLinks,
          })
          .eq("id", existingRow.id);

        if (updateError) {
          throw updateError;
        }

        updatedIds.push(existingRow.id as string);
      } else {
        if (mapping.status === "canceled" && !payload.includeCancelled) {
          continue;
        }

        const insertPayload = {
          project_id: projectId,
          ...basePayload,
          labels: {
            ...basePayload.labels,
            lane: mapping.lane,
          },
          links: {
            ...basePayload.links,
            calendarSourceId: sourceId,
          },
          created_by: user.id,
        } satisfies Record<string, unknown>;

        const { data: insertRow, error: insertError } = await supabase
          .from("project_items")
          .insert(insertPayload)
          .select("id")
          .maybeSingle();

        if (insertError) {
          throw insertError;
        }

        if (insertRow?.id) {
          createdIds.push(insertRow.id as string);
        }
      }
    }
  } catch (err: any) {
    return formatError(err?.message || "Failed to import calendar events", 500);
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
