"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchCalendarEvents,
  fetchCalendarSources,
  type CalendarEventsResponse,
} from "@/lib/supabaseClient";
import type { CalendarEventRecord, UserCalendarSourceRecord } from "@kazador/shared";

const VIEW_OPTIONS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "today", label: "Today" },
  { value: "week", label: "Next 7 days" },
  { value: "month", label: "Next 30 days" },
] as const;

type ViewOption = (typeof VIEW_OPTIONS)[number]["value"];

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinView(date: Date, view: ViewOption): boolean {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  if (view === "today") {
    return date >= startOfToday && date < endOfToday;
  }
  if (view === "week") {
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    return date >= now && date <= end;
  }
  if (view === "month") {
    const end = new Date(now);
    end.setDate(end.getDate() + 30);
    return date >= now && date <= end;
  }
  // Upcoming view shows everything from now onward.
  return date >= now;
}

function formatDateHeading(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeRange(event: CalendarEventRecord): string {
  if (event.isAllDay) {
    return "All day";
  }
  const start = parseDate(event.startAt);
  const end = parseDate(event.endAt);
  if (!start && !end) {
    return "—";
  }
  if (start && !end) {
    return start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (!start && end) {
    return end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (start && end) {
    const startLabel = start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const endLabel = end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${startLabel} → ${endLabel}`;
  }
  return "—";
}

function getEventLink(event: CalendarEventRecord): string | null {
  const raw = event.raw as Record<string, unknown>;
  if (typeof raw?.htmlLink === "string") {
    return raw.htmlLink as string;
  }
  return null;
}

interface GroupedEvents {
  date: Date;
  events: CalendarEventRecord[];
}

export default function CalendarPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [viewMode, setViewMode] = useState<ViewOption>("upcoming");
  const [sourceId, setSourceId] = useState<string>("all");
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [sources, setSources] = useState<UserCalendarSourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    fetchCalendarSources(accessToken)
      .then((list) => {
        if (!cancelled) setSources(list);
      })
      .catch((err: any) => {
        if (!cancelled) {
          console.error("Failed to load calendar sources", err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const reloadEvents = useCallback(async () => {
    if (!accessToken) {
      setEvents([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response: CalendarEventsResponse = await fetchCalendarEvents({
        accessToken,
        sourceId: sourceId !== "all" ? sourceId : undefined,
        assigned: "all",
        includeIgnored: true,
        limit: 500,
      });
      setEvents(response.events);
      setTotalCount(response.count);
    } catch (err: any) {
      setError(err?.message || "Failed to load events");
      setEvents([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [accessToken, sourceId]);

  useEffect(() => {
    void reloadEvents();
  }, [reloadEvents]);

  const handleSyncAll = useCallback(async () => {
    if (!accessToken) return;
    if (sources.length === 0) {
      setError("No calendars are connected yet. Connect Google Calendar from Settings → Integrations.");
      return;
    }

    setSyncing(true);
    setSyncMessage(null);
    setError(null);

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
      setSyncMessage(
        `Calendars synced: ${summary.inserted || 0} new, ${summary.updated || 0} updated`
      );
    } catch (err: any) {
      setError(err?.message || "Failed to sync calendars");
    } finally {
      setSyncing(false);
    }
  }, [accessToken, reloadEvents, sources.length]);

  const calendarOptions = useMemo(() => {
    return sources.map((source) => ({
      id: source.id,
      name: source.summary ?? source.calendarId ?? "Calendar",
    }));
  }, [sources]);

  const groupedEvents = useMemo<GroupedEvents[]>(() => {
    if (events.length === 0) return [];
    const groups = new Map<string, GroupedEvents>();

    for (const event of events) {
      const start = parseDate(event.startAt) ?? parseDate(event.endAt);
      if (!start) continue;
      if (!isWithinView(start, viewMode)) continue;

      const key = start.toISOString().slice(0, 10);
      if (!groups.has(key)) {
        groups.set(key, { date: new Date(start), events: [] });
      }
      groups.get(key)!.events.push(event);
    }

    return Array.from(groups.values())
      .map((group) => ({
        date: group.date,
        events: group.events.sort((a, b) => {
          const aStart = parseDate(a.startAt) ?? parseDate(a.endAt) ?? new Date(0);
          const bStart = parseDate(b.startAt) ?? parseDate(b.endAt) ?? new Date(0);
          return aStart.getTime() - bStart.getTime();
        }),
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [events, viewMode]);

  const visibleCount = groupedEvents.reduce((sum, group) => sum + group.events.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">Calendar</h1>
        <p className="text-sm text-gray-600">
          Browse your Google Calendar events exactly as they sync into Kazador. Use the filters to focus on a specific
          time range or calendar and click any event to open it in Google Calendar.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          View
          <select
            value={viewMode}
            onChange={(event) => setViewMode(event.target.value as ViewOption)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            {VIEW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          Calendar
          <select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="all">All calendars</option>
            {calendarOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <div className="text-sm text-gray-500">
          Showing {visibleCount} of {totalCount} synced events
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
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {syncMessage}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="rounded border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 shadow-sm">Loading events…</p>
      ) : visibleCount === 0 ? (
        <p className="rounded border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 shadow-sm">
          No events match the current filters.
        </p>
      ) : (
        <div className="space-y-6">
          {groupedEvents.map((group) => (
            <section key={group.date.toISOString()} className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <header className="border-b border-gray-200 px-4 py-3">
                <h2 className="text-lg font-semibold text-gray-900">{formatDateHeading(group.date)}</h2>
              </header>
              <ul className="divide-y divide-gray-200">
                {group.events.map((event) => {
                  const link = getEventLink(event);
                  const timeRange = formatTimeRange(event);
                  const calendarName = event.source
                    ? ((event.source.metadata as Record<string, unknown> | null)?.calendarSummary as string | undefined) ??
                      event.source.title ??
                      event.source.externalId
                    : sources.find((source) => source.id === event.userSourceId)?.summary ?? "Calendar";
                  return (
                    <li key={event.id} className="flex flex-col gap-2 px-4 py-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-base font-semibold text-gray-900">{event.summary ?? "Untitled event"}</div>
                        {event.location ? <div className="text-sm text-gray-500">{event.location}</div> : null}
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex text-sm text-sky-600 hover:underline"
                          >
                            Open in Google Calendar
                          </a>
                        ) : null}
                      </div>
                      <div className="text-sm text-gray-600">
                        <div className="font-medium text-gray-900">{timeRange}</div>
                        <div>{calendarName}</div>
                        <div className="capitalize">{event.status ?? "status unknown"}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
