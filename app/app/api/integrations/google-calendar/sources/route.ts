import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  getCalendarAccount,
  ensureCalendarOAuthClient,
  createCalendarClient,
  listCalendars,
} from "@/lib/googleCalendarClient";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/integrations/google-calendar/sources
 * List all user-level calendar sources
 */
export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { data, error } = await supabase
    .from("user_calendar_sources")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return formatError(error.message, 500);
  }

  const sources = (data ?? []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    calendarId: row.calendar_id,
    accountId: row.account_id,
    summary: row.summary,
    timezone: row.timezone,
    primaryCalendar: row.primary_calendar,
    accessRole: row.access_role,
    metadata: row.metadata,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({ sources });
}

/**
 * POST /api/integrations/google-calendar/sources
 * Connect a user-level calendar source
 */
export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let payload: {
    calendarId: string;
    summary?: string;
    timezone?: string;
    primaryCalendar?: boolean;
    accessRole?: string;
  };

  try {
    payload = await request.json();
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.calendarId) {
    return formatError("calendarId is required", 400);
  }

  // Get user's Google Calendar account
  let account;
  try {
    account = await getCalendarAccount(supabase, { userId: user.id });
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Google account", 500);
  }

  if (!account) {
    return formatError("Connect Google Calendar first", 404);
  }

  // Verify calendar access
  let calendarSummary = payload.summary ?? null;
  let calendarTimezone = payload.timezone ?? null;
  let calendarPrimary = payload.primaryCalendar ?? false;
  let accessRole = payload.accessRole ?? null;

  try {
    const authClient = await ensureCalendarOAuthClient(supabase, account);
    const calendar = createCalendarClient(authClient);

    if (!calendarSummary || !calendarTimezone) {
      const { data } = await calendar.calendars.get({ calendarId: payload.calendarId });
      calendarSummary = calendarSummary ?? data.summary ?? payload.calendarId;
      calendarTimezone = calendarTimezone ?? data.timeZone ?? null;
    }
  } catch (err: any) {
    return formatError(err?.message || "Failed to verify calendar access", 500);
  }

  // Insert or update user calendar source
  const insertPayload = {
    user_id: user.id,
    calendar_id: payload.calendarId,
    account_id: account.id,
    summary: calendarSummary ?? payload.calendarId,
    timezone: calendarTimezone,
    primary_calendar: calendarPrimary,
    access_role: accessRole,
    metadata: {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("user_calendar_sources")
    .upsert(insertPayload, { onConflict: "user_id,calendar_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 500);
  }

  if (!data) {
    return formatError("Failed to connect calendar", 500);
  }

  try {
    await recordAuditLog(supabase, {
      projectId: null,
      userId: user.id,
      action: "calendar.user_source.connected",
      entity: "user_calendar_source",
      refId: data.id,
      metadata: {
        calendarId: payload.calendarId,
        summary: calendarSummary,
      },
    });
  } catch (err) {
    // ignore audit failures
  }

  const source = {
    id: data.id,
    userId: data.user_id,
    calendarId: data.calendar_id,
    accountId: data.account_id,
    summary: data.summary,
    timezone: data.timezone,
    primaryCalendar: data.primary_calendar,
    accessRole: data.access_role,
    metadata: data.metadata,
    lastSyncedAt: data.last_synced_at,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };

  return NextResponse.json({ source });
}

/**
 * DELETE /api/integrations/google-calendar/sources/:sourceId
 * Disconnect a user-level calendar source
 */
export async function DELETE(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;
  const url = new URL(request.url);
  const sourceId = url.searchParams.get("sourceId");

  if (!sourceId) {
    return formatError("sourceId is required", 400);
  }

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from("user_calendar_sources")
    .select("*")
    .eq("id", sourceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    return formatError(fetchError.message, 500);
  }

  if (!existing) {
    return formatError("Calendar source not found", 404);
  }

  const { error } = await supabase
    .from("user_calendar_sources")
    .delete()
    .eq("id", sourceId)
    .eq("user_id", user.id);

  if (error) {
    return formatError(error.message, 500);
  }

  try {
    await recordAuditLog(supabase, {
      projectId: null,
      userId: user.id,
      action: "calendar.user_source.disconnected",
      entity: "user_calendar_source",
      refId: sourceId,
      metadata: {
        calendarId: existing.calendar_id,
      },
    });
  } catch (err) {
    // ignore audit failures
  }

  return NextResponse.json({ success: true });
}
