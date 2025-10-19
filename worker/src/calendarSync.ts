import { randomUUID } from "crypto";
import { google, calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CalendarEventOrigin,
  CalendarSyncStatus,
} from "@kazador/shared";

const REQUIRED_CALENDAR_SCOPES = new Set<
  | "https://www.googleapis.com/auth/calendar.events"
  | "https://www.googleapis.com/auth/calendar.readonly"
>([
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
]);

const INITIAL_PAST_WINDOW_MS = 45 * 24 * 60 * 60 * 1000; // 45 days
const INITIAL_FUTURE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const WATCH_RENEWAL_BUFFER_MS = 6 * 60 * 60 * 1000; // 6 hours
const WATCH_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours fallback

interface OAuthAccountRow {
  id: string;
  user_id: string;
  account_email: string;
  scopes: string[];
  access_token: string;
  refresh_token: string;
  expires_at: string;
  token_metadata: Record<string, unknown> | null;
}

interface UserCalendarSourceRow {
  id: string;
  user_id: string;
  calendar_id: string;
  account_id: string;
  summary: string;
  timezone: string | null;
  metadata: Record<string, unknown> | null;
  last_synced_at: string | null;
}

interface CalendarEventRow {
  id: string;
  user_source_id: string;
  calendar_id: string;
  event_id: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  status: string | null;
  start_at: string | null;
  end_at: string | null;
  is_all_day: boolean;
  timezone: string | null;
  organizer: Record<string, unknown> | null;
  attendees: Array<Record<string, unknown>> | null;
  hangout_link: string | null;
  raw: Record<string, unknown> | null;
  sync_status: CalendarSyncStatus;
  origin: CalendarEventOrigin;
  pending_action: "create" | "update" | "delete" | null;
  last_google_updated_at: string | null;
  last_kazador_updated_at: string | null;
  google_etag: string | null;
  ignore: boolean;
}

export interface CalendarSyncJobSummary {
  sourcesProcessed: number;
  pushedCreated: number;
  pushedUpdated: number;
  pushedDeleted: number;
  pulledInserted: number;
  pulledUpdated: number;
  pulledDeleted: number;
  skippedDueToConflicts: number;
  errors: Array<{ sourceId: string; message: string }>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function hasCalendarScopes(account: OAuthAccountRow): boolean {
  const scopes = Array.isArray(account.scopes) ? account.scopes : [];
  return Array.from(REQUIRED_CALENDAR_SCOPES).every((scope) => scopes.includes(scope));
}

function normaliseJson<T>(value: T): T {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normaliseTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function ensureOAuthClient(
  supabase: SupabaseClient,
  account: OAuthAccountRow,
): Promise<OAuth2Client> {
  if (!hasCalendarScopes(account)) {
    throw new Error(`Account ${account.account_email} is missing Google Calendar scopes`);
  }

  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  const oauthClient = redirectUri
    ? new google.auth.OAuth2(clientId, clientSecret, redirectUri)
    : new google.auth.OAuth2(clientId, clientSecret);

  const expiryDate = new Date(account.expires_at).getTime();
  oauthClient.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: expiryDate,
    scope: Array.isArray(account.scopes) ? account.scopes.join(" ") : undefined,
  });

  const now = Date.now();
  if (!account.access_token || !expiryDate || expiryDate - now < 60_000) {
    const refreshed = await oauthClient.refreshAccessToken();
    const credentials = refreshed.credentials;
    if (!credentials.access_token || !credentials.expiry_date) {
      throw new Error("Failed to refresh Google access token");
    }

    const metadata = (account.token_metadata ?? {}) as Record<string, unknown>;
    metadata.lastCalendarTokenRefreshAt = new Date().toISOString();

    const updatePayload = {
      access_token: credentials.access_token,
      expires_at: new Date(credentials.expiry_date).toISOString(),
      token_metadata: metadata,
      updated_at: new Date().toISOString(),
    } satisfies Partial<OAuthAccountRow> & Record<string, unknown>;

    const { error: updateError } = await supabase
      .from("oauth_accounts")
      .update(updatePayload)
      .eq("id", account.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    oauthClient.setCredentials({
      access_token: credentials.access_token,
      refresh_token: account.refresh_token,
      expiry_date: credentials.expiry_date,
      scope: Array.isArray(account.scopes) ? account.scopes.join(" ") : undefined,
    });
  }

  return oauthClient;
}

function buildGoogleEventPayload(row: CalendarEventRow): calendar_v3.Schema$Event {
  const startIsDate = row.is_all_day || (!!row.start_at && !row.start_at.includes("T"));
  const endIsDate = row.is_all_day || (!!row.end_at && !row.end_at.includes("T"));
  const timeZone = row.timezone ?? undefined;

  const start: calendar_v3.Schema$EventDateTime | undefined = row.start_at
    ? startIsDate
      ? { date: row.start_at.substring(0, 10), timeZone }
      : { dateTime: row.start_at, timeZone }
    : undefined;

  const end: calendar_v3.Schema$EventDateTime | undefined = row.end_at
    ? endIsDate
      ? { date: row.end_at.substring(0, 10), timeZone }
      : { dateTime: row.end_at, timeZone }
    : undefined;

  const payload: calendar_v3.Schema$Event = {
    summary: row.summary ?? undefined,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    status: row.status ?? undefined,
    start,
    end,
    attendees: row.attendees ?? undefined,
  };

  if (row.organizer) {
    payload.organizer = row.organizer;
  }

  return payload;
}

function mapGoogleEventToRow(
  event: calendar_v3.Schema$Event,
  options: { source: UserCalendarSourceRow; nowIso: string },
) {
  const startDate = event.start?.dateTime ?? event.start?.date ?? null;
  const endDate = event.end?.dateTime ?? event.end?.date ?? null;
  const timeZone =
    event.start?.timeZone ||
    event.end?.timeZone ||
    event.originalStartTime?.timeZone ||
    options.source.timezone ||
    null;

  return {
    user_source_id: options.source.id,
    calendar_id: options.source.calendar_id,
    event_id: event.id!,
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    status: event.status ?? null,
    start_at: startDate,
    end_at: endDate,
    is_all_day: Boolean(event.start?.date && !event.start?.dateTime),
    timezone: timeZone,
    organizer: event.organizer ? normaliseJson(event.organizer) : null,
    attendees: event.attendees ? normaliseJson(event.attendees) : null,
    hangout_link: event.hangoutLink ?? null,
    raw: normaliseJson(event),
    sync_status: (event.status === "cancelled" ? "deleted" : "synced") as CalendarSyncStatus,
    sync_error: null,
    last_synced_at: options.nowIso,
    last_google_updated_at: normaliseTimestamp(event.updated ?? event.created ?? options.nowIso),
    google_etag: event.etag ?? null,
    pending_action: null,
    origin: "google" as CalendarEventOrigin,
    last_kazador_updated_at: null,
    ignore: event.status === "cancelled",
  } as Record<string, unknown>;
}

async function pushPendingLocalChanges(
  supabase: SupabaseClient,
  calendar: calendar_v3.Calendar,
  source: UserCalendarSourceRow,
  nowIso: string,
): Promise<{ created: number; updated: number; deleted: number; failed: number }> {
  const { data: pendingRows, error: pendingError } = await supabase
    .from("calendar_events")
    .select(
      "id, user_source_id, calendar_id, event_id, summary, description, location, status, start_at, end_at, is_all_day, timezone, organizer, attendees, hangout_link, raw, sync_status, origin, pending_action, last_google_updated_at, last_kazador_updated_at, google_etag, ignore",
    )
    .eq("user_source_id", source.id)
    .or(
      [
        "pending_action.not.is.null",
        "sync_status.eq.pending",
        "sync_status.eq.needs_update",
        "sync_status.eq.delete_pending",
      ].join(","),
    );

  if (pendingError) {
    throw new Error(pendingError.message);
  }

  if (!pendingRows || pendingRows.length === 0) {
    return { created: 0, updated: 0, deleted: 0, failed: 0 };
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let failed = 0;

  for (const row of pendingRows as unknown as CalendarEventRow[]) {
    const action =
      row.pending_action ??
      (row.sync_status === "delete_pending"
        ? "delete"
        : row.sync_status === "pending"
        ? "create"
        : row.sync_status === "needs_update"
        ? "update"
        : null);

    if (!action) {
      continue;
    }

    try {
      if (action === "delete") {
        if (row.event_id) {
          try {
            await calendar.events.delete({ calendarId: row.calendar_id, eventId: row.event_id, sendUpdates: "all" });
          } catch (err: any) {
            const status = err?.code || err?.response?.status;
            if (status !== 404) {
              throw err;
            }
          }
        }

        const { error: updateError } = await supabase
          .from("calendar_events")
          .update({
            sync_status: "deleted",
            pending_action: null,
            sync_error: null,
            last_synced_at: nowIso,
            last_google_updated_at: nowIso,
          })
          .eq("id", row.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        deleted += 1;
        continue;
      }

      const eventPayload = buildGoogleEventPayload(row);
      let response: calendar_v3.Schema$Event | null = null;

      if (action === "create" || !row.event_id) {
        const insertResponse = await calendar.events.insert({
          calendarId: row.calendar_id,
          requestBody: eventPayload,
          sendUpdates: "all",
          conferenceDataVersion: eventPayload.conferenceData ? 1 : undefined,
          supportsAttachments: false,
        });
        response = insertResponse.data ?? null;
        created += 1;
      } else {
        const patchResponse = await calendar.events.patch({
          calendarId: row.calendar_id,
          eventId: row.event_id!,
          requestBody: eventPayload,
          sendUpdates: "all",
          conferenceDataVersion: eventPayload.conferenceData ? 1 : undefined,
          supportsAttachments: false,
        });
        response = patchResponse.data ?? null;
        updated += 1;
      }

      if (!response || !response.id) {
        throw new Error("Google Calendar did not return an event payload");
      }

      const mapped = mapGoogleEventToRow(response, { source, nowIso });
      mapped.origin = row.origin ?? "kazador";
      mapped.last_kazador_updated_at = row.last_kazador_updated_at ?? nowIso;
      mapped.pending_action = null;
      mapped.sync_error = null;

      const { error: updateRowError } = await supabase
        .from("calendar_events")
        .update(mapped)
        .eq("id", row.id);

      if (updateRowError) {
        throw new Error(updateRowError.message);
      }
    } catch (err: any) {
      failed += 1;
      const { error: failureUpdateError } = await supabase
        .from("calendar_events")
        .update({
          sync_status: "failed",
          sync_error: err?.message || "Failed to sync with Google Calendar",
          last_synced_at: nowIso,
        })
        .eq("id", row.id);

      if (failureUpdateError) {
        throw new Error(failureUpdateError.message);
      }
    }
  }

  return { created, updated, deleted, failed };
}

async function loadExistingEvents(
  supabase: SupabaseClient,
  source: UserCalendarSourceRow,
): Promise<Map<string, CalendarEventRow>> {
  const { data, error } = await supabase
    .from("calendar_events")
    .select(
      "id, user_source_id, calendar_id, event_id, summary, description, location, status, start_at, end_at, is_all_day, timezone, organizer, attendees, hangout_link, raw, sync_status, origin, pending_action, last_google_updated_at, last_kazador_updated_at, google_etag, ignore",
    )
    .eq("user_source_id", source.id);

  if (error) {
    throw new Error(error.message);
  }

  const map = new Map<string, CalendarEventRow>();
  for (const row of (data ?? []) as unknown as CalendarEventRow[]) {
    if (row.event_id) {
      map.set(row.event_id, row);
    }
  }
  return map;
}

async function upsertCalendarSyncState(
  supabase: SupabaseClient,
  source: UserCalendarSourceRow,
  syncToken: string | null,
  nowIso: string,
  lastError: string | null,
) {
  const { data: existing, error: loadError } = await supabase
    .from("calendar_sync_states")
    .select("id")
    .eq("user_source_id", source.id)
    .maybeSingle();

  if (loadError) {
    throw new Error(loadError.message);
  }

  const payload = {
    user_source_id: source.id,
    sync_token: syncToken,
    last_polled_at: nowIso,
    last_error: lastError,
    updated_at: nowIso,
  } as Record<string, unknown>;

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("calendar_sync_states")
      .update(payload)
      .eq("id", existing.id);
    if (updateError) {
      throw new Error(updateError.message);
    }
  } else {
    payload.created_at = nowIso;
    const { error: insertError } = await supabase
      .from("calendar_sync_states")
      .insert(payload);
    if (insertError) {
      throw new Error(insertError.message);
    }
  }
}

async function pullGoogleChanges(
  supabase: SupabaseClient,
  calendar: calendar_v3.Calendar,
  source: UserCalendarSourceRow,
  now: Date,
): Promise<{ inserted: number; updated: number; deleted: number; skippedConflicts: number }> {
  const nowIso = now.toISOString();
  const { data: syncStateRow } = await supabase
    .from("calendar_sync_states")
    .select("id, user_source_id, sync_token")
    .eq("user_source_id", source.id)
    .maybeSingle();

  let syncToken = syncStateRow?.sync_token ?? null;
  const existingEvents = await loadExistingEvents(supabase, source);

  let pageToken: string | undefined;
  let fetchedEvents: calendar_v3.Schema$Event[] = [];
  let nextSyncToken: string | null = null;
  let requestError: Error | null = null;

  try {
    do {
      const request: calendar_v3.Params$Resource$Events$List = {
        calendarId: source.calendar_id,
        maxResults: 250,
        showDeleted: true,
        singleEvents: syncToken ? undefined : true,
        orderBy: syncToken ? undefined : "updated",
        pageToken,
      };

      if (syncToken) {
        request.syncToken = syncToken;
      } else {
        request.timeMin = new Date(now.getTime() - INITIAL_PAST_WINDOW_MS).toISOString();
        request.timeMax = new Date(now.getTime() + INITIAL_FUTURE_WINDOW_MS).toISOString();
      }

      const response = await calendar.events.list(request);
      fetchedEvents.push(...(response.data.items ?? []).filter((event): event is calendar_v3.Schema$Event & { id: string } => Boolean(event && event.id)));
      pageToken = response.data.nextPageToken ?? undefined;
      if (response.data.nextSyncToken) {
        nextSyncToken = response.data.nextSyncToken;
      }
    } while (pageToken);
  } catch (err: any) {
    const status = err?.code || err?.response?.status;
    if (status === 410 && syncToken) {
      // Sync token expired, reset and perform a full reload
      await upsertCalendarSyncState(supabase, source, null, nowIso, null);
      return pullGoogleChanges(supabase, calendar, source, now);
    }
    requestError = err instanceof Error ? err : new Error(err?.message || "Google Calendar sync failed");
  }

  if (requestError) {
    await upsertCalendarSyncState(supabase, source, syncToken, nowIso, requestError.message);
    throw requestError;
  }

  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  let skippedConflicts = 0;

  for (const event of fetchedEvents) {
    if (!event.id) continue;
    const existing = existingEvents.get(event.id);
    if (existing && existing.pending_action) {
      skippedConflicts += 1;
      continue;
    }

    const eventUpdatedAt = normaliseTimestamp(event.updated ?? event.created ?? nowIso);
    if (existing && existing.origin === "kazador" && existing.last_kazador_updated_at) {
      const localUpdated = new Date(existing.last_kazador_updated_at).getTime();
      const googleUpdated = eventUpdatedAt ? new Date(eventUpdatedAt).getTime() : 0;
      if (localUpdated > googleUpdated) {
        skippedConflicts += 1;
        continue;
      }
    }

    const payload = mapGoogleEventToRow(event, { source, nowIso });
    payload.origin = existing?.origin ?? "google";
    payload.last_kazador_updated_at = existing?.last_kazador_updated_at ?? null;

    if (existing) {
      const { error: updateError } = await supabase
        .from("calendar_events")
        .update(payload)
        .eq("id", existing.id);
      if (updateError) {
        throw new Error(updateError.message);
      }
      existingEvents.set(event.id, {
        ...existing,
        ...payload,
        event_id: event.id,
      } as CalendarEventRow);
      if (payload.sync_status === "deleted") {
        deleted += 1;
      } else {
        updated += 1;
      }
    } else {
      payload.created_at = nowIso;
      const insertPayload = {
        ...payload,
        created_at: nowIso,
      } as Record<string, unknown>;
      const { error: insertError } = await supabase
        .from("calendar_events")
        .insert(insertPayload);
      if (insertError) {
        throw new Error(insertError.message);
      }
      if (payload.sync_status === "deleted") {
        deleted += 1;
      } else {
        inserted += 1;
      }
    }
  }

  await upsertCalendarSyncState(supabase, source, nextSyncToken ?? syncToken, nowIso, null);

  const { error: touchSourceError } = await supabase
    .from("user_calendar_sources")
    .update({ last_synced_at: nowIso })
    .eq("id", source.id);
  if (touchSourceError) {
    throw new Error(touchSourceError.message);
  }

  return { inserted, updated, deleted, skippedConflicts };
}

async function ensureWatchChannel(
  supabase: SupabaseClient,
  calendar: calendar_v3.Calendar,
  source: UserCalendarSourceRow,
  now: Date,
): Promise<void> {
  const webhookUrl = process.env.GOOGLE_CALENDAR_WEBHOOK_URL;
  if (!webhookUrl) {
    return;
  }

  const { data: existingRow, error: loadError } = await supabase
    .from("calendar_watch_channels")
    .select("id, user_source_id, resource_id, channel_id, expiration_at")
    .eq("user_source_id", source.id)
    .maybeSingle();

  if (loadError) {
    throw new Error(loadError.message);
  }

  const nowMs = now.getTime();
  if (existingRow?.expiration_at) {
    const expirationMs = new Date(existingRow.expiration_at).getTime();
    if (!Number.isNaN(expirationMs) && expirationMs - nowMs > WATCH_RENEWAL_BUFFER_MS) {
      return;
    }

    try {
      await calendar.channels.stop({
        requestBody: {
          id: existingRow.channel_id,
          resourceId: existingRow.resource_id,
        },
      });
    } catch (err) {
      // Ignore failures when stopping channels; channel may have expired already
    }

    await supabase.from("calendar_watch_channels").delete().eq("id", existingRow.id);
  }

  const channelId = randomUUID();
  const watchResponse = await calendar.events.watch({
    calendarId: source.calendar_id,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: webhookUrl,
      token: JSON.stringify({ userSourceId: source.id, userId: source.user_id }),
    },
  });

  if (!watchResponse.data || !watchResponse.data.resourceId) {
    throw new Error("Google Calendar did not return a watch channel resource id");
  }

  const expirationMs = watchResponse.data.expiration ? Number(watchResponse.data.expiration) : nowMs + WATCH_DEFAULT_TTL_MS;
  const payload = {
    user_source_id: source.id,
    resource_id: watchResponse.data.resourceId,
    channel_id: channelId,
    expiration_at: new Date(expirationMs).toISOString(),
    last_renewed_at: now.toISOString(),
    metadata: { webhookUrl },
  } as Record<string, unknown>;

  const { error: upsertError } = await supabase
    .from("calendar_watch_channels")
    .upsert(payload, { onConflict: "user_source_id" });

  if (upsertError) {
    throw new Error(upsertError.message);
  }
}

function createCalendarClient(auth: OAuth2Client) {
  return google.calendar({ version: "v3", auth });
}

export async function runCalendarSyncJob(options: {
  supabase: SupabaseClient;
  now?: Date;
}): Promise<CalendarSyncJobSummary> {
  const { supabase, now = new Date() } = options;

  const { data: sources, error: sourcesError } = await supabase
    .from("user_calendar_sources")
    .select(
      "id, user_id, calendar_id, account_id, summary, timezone, metadata, last_synced_at, oauth_accounts:oauth_accounts(*)",
    );

  if (sourcesError) {
    throw new Error(sourcesError.message);
  }

  const summary: CalendarSyncJobSummary = {
    sourcesProcessed: 0,
    pushedCreated: 0,
    pushedUpdated: 0,
    pushedDeleted: 0,
    pulledInserted: 0,
    pulledUpdated: 0,
    pulledDeleted: 0,
    skippedDueToConflicts: 0,
    errors: [],
  };

  for (const sourceRow of sources ?? []) {
    const source = {
      id: sourceRow.id as string,
      user_id: sourceRow.user_id as string,
      calendar_id: sourceRow.calendar_id as string,
      account_id: sourceRow.account_id as string,
      summary: sourceRow.summary as string,
      timezone: sourceRow.timezone ?? null,
      metadata: (sourceRow.metadata as Record<string, unknown> | null) ?? null,
      last_synced_at: sourceRow.last_synced_at ?? null,
    } satisfies UserCalendarSourceRow;

    summary.sourcesProcessed += 1;

    const accountPayload = sourceRow.oauth_accounts as any;
    const accountRow: OAuthAccountRow | undefined = accountPayload
      ? Array.isArray(accountPayload)
        ? (accountPayload[0] as OAuthAccountRow | undefined)
        : (accountPayload as OAuthAccountRow)
      : undefined;

    if (!accountRow) {
      summary.errors.push({ sourceId: source.id, message: "Google account not found" });
      continue;
    }

    try {
      const oauthClient = await ensureOAuthClient(supabase, {
        id: accountRow.id,
        user_id: accountRow.user_id,
        account_email: accountRow.account_email,
        scopes: accountRow.scopes ?? [],
        access_token: accountRow.access_token,
        refresh_token: accountRow.refresh_token,
        expires_at: accountRow.expires_at,
        token_metadata: accountRow.token_metadata ?? {},
      });

      const calendar = createCalendarClient(oauthClient);
      const nowIso = now.toISOString();

      const pushResult = await pushPendingLocalChanges(supabase, calendar, source, nowIso);
      summary.pushedCreated += pushResult.created;
      summary.pushedUpdated += pushResult.updated;
      summary.pushedDeleted += pushResult.deleted;

      const pullResult = await pullGoogleChanges(supabase, calendar, source, now);
      summary.pulledInserted += pullResult.inserted;
      summary.pulledUpdated += pullResult.updated;
      summary.pulledDeleted += pullResult.deleted;
      summary.skippedDueToConflicts += pullResult.skippedConflicts;

      await ensureWatchChannel(supabase, calendar, source, now);
    } catch (err: any) {
      summary.errors.push({
        sourceId: source.id,
        message: err?.message || "Unknown Google Calendar sync error",
      });
    }
  }

  return summary;
}
