"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { fetchCalendarEvents, fetchCalendarSources, type CalendarEventsResponse } from "@/lib/supabaseClient";
import type { CalendarEventRecord, UserCalendarSourceRecord } from "@kazador/shared";

interface FilterState {
  sourceId: string;
}

function compactDateTime(value: string | null, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}

function getEventLink(event: CalendarEventRecord): string | null {
  const raw = event.raw as Record<string, unknown>;
  if (typeof raw?.htmlLink === "string") {
    return raw.htmlLink as string;
  }
  return null;
}

export default function CalendarInboxPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [filters, setFilters] = useState<FilterState>({
    sourceId: "all",
  });
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<UserCalendarSourceRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    fetchCalendarSources(accessToken)
      .then((list) => {
        if (cancelled) return;
        setSources(list);
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.error("Failed to load calendar sources", err);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const reloadEvents = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      setEvents([]);
      setTotalCount(0);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response: CalendarEventsResponse = await fetchCalendarEvents({
        sourceId: filters.sourceId !== "all" ? filters.sourceId : undefined,
        accessToken,
        limit: 500,
      });
      setEvents(response.events);
      setTotalCount(response.count);
    } catch (err: any) {
      setError(err?.message || "Failed to load calendar events");
      setEvents([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [accessToken, filters.sourceId]);

  useEffect(() => {
    void reloadEvents();
  }, [reloadEvents]);

  const calendarSourceOptions = useMemo(() => {
    return sources.map((source: any) => ({
      id: source.id,
      name: source.summary ?? source.calendarId ?? "Calendar",
      calendarId: source.calendarId,
    }));
  }, [sources]);

  const setFilterValue = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleSyncAll = async () => {
    if (!accessToken) return;
    if (sources.length === 0) {
      setError("No calendars are connected yet. Connect Google Calendar from Settings → Integrations.");
      return;
    }

    setSyncing(true);
    setError(null);
    setSyncMessage(null);

    try {
      const response = await fetch("/api/integrations/google-calendar/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to sync calendars");
      }

      await reloadEvents();

      const summary = data.summary || {};
      const message = `Calendars synced: ${summary.inserted || 0} new, ${summary.updated || 0} updated`;

      setSyncMessage(message);
    } catch (err: any) {
      setError(err?.message || "Failed to sync calendars");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-gray-900">Calendar inbox</h1>
        <p className="mt-1 text-sm text-gray-600">
          Review every Google Calendar event we've imported. Use sync to refresh and open events in Google for details.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Calendar
          <select
            value={filters.sourceId}
            onChange={(event) => setFilterValue("sourceId", event.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="all">All calendars</option>
            {calendarSourceOptions.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>

        <div className="text-sm text-gray-500">
          Showing {events.length} of {totalCount} events
        </div>
        <button
          type="button"
          onClick={handleSyncAll}
          disabled={syncing || !accessToken}
          className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-100"
        >
          {syncing ? "Syncing…" : "Sync calendars"}
        </button>
      </div>

      {syncMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {syncMessage}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="rounded border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 shadow-sm">Loading events…</p>
      ) : events.length === 0 ? (
        <p className="rounded border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 shadow-sm">
          No events match the current filters.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Calendar</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm text-gray-700">
              {events.map((event) => {
                const sourceName = event.source
                  ? ((event.source.metadata as Record<string, unknown> | null)?.calendarSummary as string | undefined) ??
                    event.source.title ??
                    event.source.externalId
                  : "Calendar";
                const htmlLink = getEventLink(event);
                return (
                  <tr key={event.id} className={event.ignore ? "bg-gray-100 text-gray-400" : ""}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{event.summary ?? "Untitled event"}</div>
                      <div className="text-xs text-gray-500">
                        {event.location ? <span>{event.location}</span> : null}
                        {event.hangoutLink ? (
                          <span className="ml-2 text-sky-600">
                            <a href={event.hangoutLink} target="_blank" rel="noreferrer">
                              Join
                            </a>
                          </span>
                        ) : null}
                        {htmlLink ? (
                          <span className="ml-2 text-sky-600">
                            <a href={htmlLink} target="_blank" rel="noreferrer">
                              Open in Google
                            </a>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div>{compactDateTime(event.startAt)}</div>
                      <div className="text-xs text-gray-500">→ {compactDateTime(event.endAt)}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div>{sourceName}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-gray-900">{event.status ?? "—"}</div>
                      {event.ignore ? <div className="text-xs text-gray-500">Ignored</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
