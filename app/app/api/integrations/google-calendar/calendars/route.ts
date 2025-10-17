import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  getCalendarAccount,
  ensureCalendarOAuthClient,
  createCalendarClient,
  listCalendars,
} from "@/lib/googleCalendarClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let account;
  try {
    account = await getCalendarAccount(supabase, { userId: user.id });
  } catch (err: any) {
    return formatError(err?.message || "Failed to load Google account", 500);
  }

  if (!account) {
    return formatError("Connect Google Calendar first", 404);
  }

  let authClient;
  try {
    authClient = await ensureCalendarOAuthClient(supabase, account);
  } catch (err: any) {
    return formatError(err?.message || "Calendar authentication failed", 500);
  }

  const calendar = createCalendarClient(authClient);

  try {
    const calendars = await listCalendars(calendar);
    return NextResponse.json({ calendars, accountEmail: account.accountEmail });
  } catch (err: any) {
    return formatError(err?.message || "Failed to list calendars", 500);
  }
}
