import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  getCalendarAccount,
  getCalendarAccountById,
  ensureCalendarOAuthClient,
  createCalendarClient,
  listCalendarEvents,
  listCalendars,
  upsertUserCalendarSources,
} from "@/lib/googleCalendarClient";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST /api/integrations/google-calendar/sync
 * Sync all user-level calendar sources
 */
export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  // Get all user calendar sources
  const { data: sourceRows, error: sourcesError } = await supabase
    .from("user_calendar_sources")
    .select("*")
    .eq("user_id", user.id);

  if (sourcesError) {
    return formatError(sourcesError.message, 500);
  }

  let sources = sourceRows ?? [];

  if (!sources || sources.length === 0) {
    try {
      const account = await getCalendarAccount(supabase, { userId: user.id });
      if (account) {
        const authClient = await ensureCalendarOAuthClient(supabase, account);
        const calendar = createCalendarClient(authClient);
        const summaries = await listCalendars(calendar);
        const seeded = await upsertUserCalendarSources({
          supabase,
          userId: user.id,
          accountId: account.id,
          calendars: summaries,
        });
        if (seeded.length > 0) {
          sources = seeded;
        }
      }
    } catch (err) {
      console.error("Failed to auto-create calendar sources during sync", err);
    }
  }

  if (!sources || sources.length === 0) {
    return formatError("No calendars connected", 404);
  }

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalProcessed = 0;
  const errors: string[] = [];

  // Sync each calendar source
  for (const source of sources) {
    try {
      const account = await getCalendarAccountById(supabase, source.account_id);
      if (!account) {
        errors.push(`Account not found for calendar ${source.summary}`);
        continue;
      }

      const authClient = await ensureCalendarOAuthClient(supabase, account);
      const calendar = createCalendarClient(authClient);

      // Fetch events from the last 30 days to 90 days ahead
      const now = new Date();
      const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

      const events = await listCalendarEvents(calendar, source.calendar_id, {
        timeMin,
        timeMax,
        maxResults: 500,
        singleEvents: true,
      });

      // Upsert events
      for (const event of events) {
        if (!event.id) continue;

        totalProcessed++;

        const eventPayload = {
          user_source_id: source.id,
          calendar_id: source.calendar_id,
          event_id: event.id,
          summary: event.summary ?? null,
          description: event.description ?? null,
          location: event.location ?? null,
          status: event.status ?? null,
          start_at: event.start?.dateTime ?? event.start?.date ?? null,
          end_at: event.end?.dateTime ?? event.end?.date ?? null,
          is_all_day: Boolean(event.start?.date || event.end?.date),
          timezone: event.start?.timeZone ?? source.timezone,
          organizer: event.organizer ? JSON.parse(JSON.stringify(event.organizer)) : null,
          attendees: event.attendees ? JSON.parse(JSON.stringify(event.attendees)) : null,
          hangout_link: event.hangoutLink ?? null,
          raw: JSON.parse(JSON.stringify(event)),
          ignore: event.status === "cancelled",
          updated_at: new Date().toISOString(),
        };

        // Check if event exists
        const { data: existing } = await supabase
          .from("calendar_events")
          .select("id")
          .eq("user_source_id", source.id)
          .eq("event_id", event.id)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("calendar_events")
            .update(eventPayload)
            .eq("id", existing.id);
          totalUpdated++;
        } else {
          await supabase.from("calendar_events").insert(eventPayload);
          totalInserted++;
        }
      }

      // Update last synced timestamp
      await supabase
        .from("user_calendar_sources")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", source.id);

    } catch (err: any) {
      errors.push(`Failed to sync ${source.summary}: ${err?.message || "Unknown error"}`);
      console.error(`Failed to sync calendar ${source.id}:`, err);
    }
  }

  try {
    await recordAuditLog(supabase, {
      projectId: null,
      userId: user.id,
      action: "calendar.user_events.synced",
      entity: "calendar_events",
      metadata: {
        sourceCount: sources.length,
        processed: totalProcessed,
        inserted: totalInserted,
        updated: totalUpdated,
        errors: errors.length,
      },
    });
  } catch (err) {
    // ignore audit failures
  }

  return NextResponse.json({
    success: true,
    summary: {
      sourcesProcessed: sources.length,
      eventsProcessed: totalProcessed,
      inserted: totalInserted,
      updated: totalUpdated,
      errors,
    },
  });
}
