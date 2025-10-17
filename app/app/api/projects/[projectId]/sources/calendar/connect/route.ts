import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  getCalendarAccount,
  ensureCalendarOAuthClient,
  createCalendarClient,
} from "@/lib/googleCalendarClient";
import { recordAuditLog } from "@/lib/auditLog";
import { mapProjectSourceRow } from "@/lib/projectMappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConnectCalendarPayload {
  calendarId: string;
  calendarSummary?: string | null;
  calendarTimezone?: string | null;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, { params }: { params: { projectId: string } }) {
  const { projectId } = params;
  if (!projectId) {
    return formatError("Project id is required", 400);
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

  let payload: ConnectCalendarPayload;
  try {
    payload = (await request.json()) as ConnectCalendarPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.calendarId) {
    return formatError("calendarId is required", 400);
  }

  let account;
  try {
    account = await getCalendarAccount(supabase, { userId: user.id });
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Google account", 500);
  }

  if (!account) {
    return formatError("Connect Google Calendar first", 404);
  }

  // Touch the Calendar API to confirm access and fetch metadata if needed.
  let calendarSummary = payload.calendarSummary ?? null;
  let calendarTimezone = payload.calendarTimezone ?? null;

  try {
    const authClient = await ensureCalendarOAuthClient(supabase, account);
    const calendar = createCalendarClient(authClient);
    if (!calendarSummary || !calendarTimezone) {
      const { data } = await calendar.calendars.get({ calendarId: payload.calendarId });
      calendarSummary = calendarSummary ?? data.summary ?? payload.calendarId;
      calendarTimezone = calendarTimezone ?? data.timeZone ?? null;
    }
  } catch (err: any) {
    return formatError(err?.message || "Failed to verify calendar", 500);
  }

  const insertPayload = {
    project_id: projectId,
    kind: "calendar",
    external_id: payload.calendarId,
    title: calendarSummary ?? payload.calendarId,
    watch: false,
    scope: null,
    metadata: {
      calendarId: payload.calendarId,
      calendarSummary: calendarSummary ?? payload.calendarId,
      calendarTimezone: calendarTimezone ?? null,
      accountId: account.id,
      accountEmail: account.accountEmail,
      connectedBy: user.id,
    },
  } satisfies Record<string, unknown>;

  const { data, error } = await supabase
    .from("project_sources")
    .upsert(insertPayload, { onConflict: "project_id,kind,external_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 500);
  }

  if (!data) {
    return formatError("Failed to connect calendar", 500);
  }

  const source = mapProjectSourceRow(data);

  try {
    await recordAuditLog(supabase, {
      projectId,
      userId: user.id,
      action: "calendar.source.connected",
      entity: "project_source",
      refId: source.id,
      metadata: {
        calendarId: payload.calendarId,
        calendarSummary,
      },
    });
  } catch (err) {
    // ignore audit failures
  }

  return NextResponse.json({ source });
}
