import { google, calendar_v3 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthAccountRecord } from "@kazador/shared";
import {
  ensureGoogleOAuthClient,
  getGoogleAccount,
  getGoogleAccountById,
  mapGoogleOAuthAccountRow,
  deleteGoogleAccount,
} from "./googleAccount";
import { CALENDAR_SCOPES } from "./googleOAuth";
import type { OAuth2Client } from "google-auth-library";

const REQUIRED_CALENDAR_SCOPES = new Set(CALENDAR_SCOPES);

export function hasCalendarScopes(account: OAuthAccountRecord | null): account is OAuthAccountRecord {
  if (!account) return false;
  const scopes = Array.isArray(account.scopes) ? account.scopes : [];
  return Array.from(REQUIRED_CALENDAR_SCOPES).every((scope) => scopes.includes(scope));
}

export async function getCalendarAccount(
  supabase: SupabaseClient,
  options: { userId: string; accountId?: string }
): Promise<OAuthAccountRecord | null> {
  const account = await getGoogleAccount(supabase, options);
  if (!hasCalendarScopes(account)) {
    return null;
  }
  return account;
}

export async function getCalendarAccountById(
  supabase: SupabaseClient,
  accountId: string
): Promise<OAuthAccountRecord | null> {
  const account = await getGoogleAccountById(supabase, accountId);
  if (!hasCalendarScopes(account)) {
    return null;
  }
  return account;
}

export async function ensureCalendarOAuthClient(
  supabase: SupabaseClient,
  account: OAuthAccountRecord
) {
  if (!hasCalendarScopes(account)) {
    throw new Error("Google account does not include Calendar scopes");
  }
  return ensureGoogleOAuthClient(supabase, account);
}

export function createCalendarClient(auth: OAuth2Client) {
  return google.calendar({ version: "v3", auth });
}

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
  timeZone: string | null;
  accessRole: string | null;
}

export async function listCalendars(calendar: calendar_v3.Calendar): Promise<GoogleCalendarSummary[]> {
  const calendars: GoogleCalendarSummary[] = [];
  let pageToken: string | undefined;
  do {
    const response = await calendar.calendarList.list({
      pageToken,
      maxResults: 100,
      minAccessRole: "writer",
      showHidden: false,
    });
    for (const entry of response.data.items ?? []) {
      if (!entry.id) continue;
      calendars.push({
        id: entry.id,
        summary: entry.summary ?? entry.id,
        primary: Boolean(entry.primary),
        timeZone: entry.timeZone ?? null,
        accessRole: entry.accessRole ?? null,
      });
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return calendars;
}

export interface CalendarEventListOptions {
  timeMin?: string | null;
  timeMax?: string | null;
  maxResults?: number;
  singleEvents?: boolean;
}

export async function listCalendarEvents(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  options: CalendarEventListOptions = {}
): Promise<calendar_v3.Schema$Event[]> {
  const events: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  const { timeMin, timeMax, maxResults = 200, singleEvents = true } = options;

  do {
    const response = await calendar.events.list({
      calendarId,
      pageToken,
      timeMin: timeMin ?? undefined,
      timeMax: timeMax ?? undefined,
      maxResults,
      singleEvents,
      orderBy: "startTime",
      showDeleted: true,
    });

    for (const event of response.data.items ?? []) {
      events.push(event);
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return events;
}

export async function disconnectCalendarAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("oauth_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return;
  }

  const account = mapGoogleOAuthAccountRow(data as any);
  const remainingScopes = (account.scopes ?? []).filter((scope) => !REQUIRED_CALENDAR_SCOPES.has(scope));

  if (remainingScopes.length === 0) {
    await deleteGoogleAccount(supabase, accountId);
    return;
  }

  const metadata = (account.tokenMetadata ?? {}) as Record<string, unknown>;
  const features = (metadata.features as Record<string, unknown> | undefined) ?? {};

  metadata.features = {
    ...features,
    calendar: false,
  };
  metadata.lastCalendarDisconnectedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("oauth_accounts")
    .update({
      scopes: remainingScopes,
      token_metadata: metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);

  if (updateError) {
    throw updateError;
  }
}

export async function createCalendarEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  event: calendar_v3.Schema$Event
): Promise<calendar_v3.Schema$Event> {
  const response = await calendar.events.insert({
    calendarId,
    requestBody: event,
    sendUpdates: "all",
    conferenceDataVersion: event.conferenceData ? 1 : undefined,
    supportsAttachments: false,
  });
  if (!response.data) {
    throw new Error("Google Calendar did not return a created event");
  }
  return response.data;
}

export async function updateCalendarEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
  event: calendar_v3.Schema$Event
): Promise<calendar_v3.Schema$Event> {
  const response = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: event,
    sendUpdates: "all",
    conferenceDataVersion: event.conferenceData ? 1 : undefined,
    supportsAttachments: false,
  });
  if (!response.data) {
    throw new Error("Google Calendar did not return the updated event");
  }
  return response.data;
}
