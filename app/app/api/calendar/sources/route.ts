import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/calendar/sources
 * Returns user-level calendar sources
 */
export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return formatError(auth.error, auth.status);
  }

  const { supabase, user } = auth;

  const { data: sourceRows, error } = await supabase
    .from("user_calendar_sources")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    return formatError(error.message, 500);
  }

  const sources = (sourceRows ?? []).map((row: any) => ({
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
