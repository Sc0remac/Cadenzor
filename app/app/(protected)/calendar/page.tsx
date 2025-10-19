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
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

type CalendarViewMode = (typeof VIEW_OPTIONS)[number]["value"];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, amount: number): Date {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + amount);
  return clone;
}

function addMonths(date: Date, amount: number): Date {
  const clone = new Date(date);
  clone.setMonth(clone.getMonth() + amount);
  return clone;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getStartOfWeek(date: Date): Date {
  const start = startOfDay(date);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  return start;
}

function getEndOfWeek(date: Date): Date {
  return addDays(getStartOfWeek(date), 7);
}

function computeGridRange(date: Date, view: CalendarViewMode): { start: Date; end: Date } {
  if (view === "day") {
    const start = startOfDay(date);
    return { start, end: addDays(start, 1) };
  }
  if (view === "week") {
    const start = getStartOfWeek(date);
    return { start, end: addDays(start, 7) };
  }

  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const start = getStartOfWeek(startOfMonth);
  const end = getEndOfWeek(endOfMonth);
  return { start, end };
}

function formatViewRangeLabel(date: Date, view: CalendarViewMode): string {
  if (view === "day") {
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  if (view === "week") {
    const start = getStartOfWeek(date);
    const end = addDays(start, 6);
    const includeStartYear = start.getFullYear() !== end.getFullYear();
    const startLabel = start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: includeStartYear ? "numeric" : undefined,
    });
    const endLabel = end.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startLabel} – ${endLabel}`;
  }

  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function eventIntersectsRange(event: CalendarEventRecord, rangeStart: Date, rangeEnd: Date): boolean {
  const start = parseDate(event.startAt) ?? parseDate(event.endAt);
  const end = parseDate(event.endAt) ?? parseDate(event.startAt);
  if (!start && !end) return false;
  const normalizedStart = start ?? end ?? null;
  const normalizedEnd = end ?? start ?? null;
  if (!normalizedStart || !normalizedEnd) return false;
  return normalizedEnd >= rangeStart && normalizedStart < rangeEnd;
}

function resolveCalendarName(
  event: CalendarEventRecord,
  sources: UserCalendarSourceRecord[]
): string {
  if (event.source) {
    const metadata = event.source.metadata as Record<string, unknown> | null;
    return (
      (metadata?.calendarSummary as string | undefined) ??
      event.source.title ??
      event.source.externalId ??
      "Calendar"
    );
  }

  const fallback = sources.find((source) => source.id === event.userSourceId);
  return fallback?.summary ?? fallback?.calendarId ?? "Calendar";
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

export default function CalendarPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [currentDate, setCurrentDate] = useState(() => startOfDay(new Date()));
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

  const gridRange = useMemo(() => computeGridRange(currentDate, viewMode), [currentDate, viewMode]);

  const visibleDays = useMemo(() => {
    const days: Date[] = [];
    for (let cursor = new Date(gridRange.start); cursor < gridRange.end; cursor = addDays(cursor, 1)) {
      days.push(new Date(cursor));
    }
    return days;
  }, [gridRange]);

  const filteredEvents = useMemo(() => {
    return events.filter((event) => eventIntersectsRange(event, gridRange.start, gridRange.end));
  }, [events, gridRange]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventRecord[]>();
    const lastVisibleDay = addDays(gridRange.end, -1);

    for (const event of filteredEvents) {
      const startRaw = parseDate(event.startAt) ?? parseDate(event.endAt);
      const endRaw = parseDate(event.endAt) ?? parseDate(event.startAt) ?? startRaw;
      if (!startRaw && !endRaw) continue;

      const eventStart = startOfDay(startRaw ?? gridRange.start);
      const eventEnd = startOfDay(endRaw ?? gridRange.start);

      const firstVisibleDay = startOfDay(eventStart < gridRange.start ? gridRange.start : eventStart);
      const finalVisibleDay = startOfDay(eventEnd > lastVisibleDay ? lastVisibleDay : eventEnd);

      for (let cursor = new Date(firstVisibleDay); cursor <= finalVisibleDay; cursor = addDays(cursor, 1)) {
        const key = cursor.toISOString().slice(0, 10);
        if (!map.has(key)) {
          map.set(key, []);
        }
        map.get(key)!.push(event);
      }
    }

    for (const dayEvents of map.values()) {
      dayEvents.sort((a, b) => {
        const aStart = parseDate(a.startAt) ?? parseDate(a.endAt) ?? new Date(0);
        const bStart = parseDate(b.startAt) ?? parseDate(b.endAt) ?? new Date(0);
        return aStart.getTime() - bStart.getTime();
      });
    }

    return map;
  }, [filteredEvents, gridRange]);

  const visibleEventCount = filteredEvents.length;
  const today = useMemo(() => startOfDay(new Date()), []);
  const rangeLabel = useMemo(() => formatViewRangeLabel(currentDate, viewMode), [currentDate, viewMode]);

  const handlePrev = useCallback(() => {
    setCurrentDate((previous) => {
      if (viewMode === "day") return addDays(previous, -1);
      if (viewMode === "week") return addDays(previous, -7);
      return addMonths(previous, -1);
    });
  }, [viewMode]);

  const handleNext = useCallback(() => {
    setCurrentDate((previous) => {
      if (viewMode === "day") return addDays(previous, 1);
      if (viewMode === "week") return addDays(previous, 7);
      return addMonths(previous, 1);
    });
  }, [viewMode]);

  const handleToday = useCallback(() => {
    setCurrentDate(startOfDay(new Date()));
  }, []);

  const renderEventChip = useCallback(
    (event: CalendarEventRecord, muted: boolean, dayKey: string) => {
      const link = getEventLink(event);
      const timeRange = formatTimeRange(event);
      const calendarName = resolveCalendarName(event, sources);
      const statusLabel = event.status ? event.status.replace(/_/g, " ") : "status unknown";
      const baseClassName =
        "group relative flex flex-col gap-1 rounded-lg border border-sky-100/70 bg-gradient-to-br from-sky-50 via-white to-sky-100 px-3 py-2 text-xs text-slate-700 shadow-sm transition hover:border-sky-400 hover:shadow-md";
      const className = `${baseClassName} ${muted ? "opacity-60" : ""} ${link ? "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500" : ""}`;

      const content = (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{event.summary ?? "Untitled event"}</span>
            <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-sky-600">{timeRange}</span>
          </div>
          {event.location ? <div className="truncate text-[11px] text-slate-500">{event.location}</div> : null}
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
            <span>{calendarName}</span>
            <span className="rounded-full bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-600">{statusLabel}</span>
            {link ? <span className="ml-auto text-sky-600">Open ↗</span> : null}
          </div>
        </>
      );

      const key = `${event.id}-${dayKey}-${muted ? "muted" : "normal"}`;

      if (link) {
        return (
          <a key={key} href={link} target="_blank" rel="noreferrer" className={`${className} cursor-pointer`}>
            {content}
          </a>
        );
      }

      return (
        <div key={key} className={className}>
          {content}
        </div>
      );
    },
    [sources]
  );

  const monthView = (
    <div className="overflow-hidden rounded-3xl border border-sky-200/70 bg-gradient-to-b from-white via-white to-sky-50 shadow-xl">
      <div className="grid grid-cols-7 gap-px border-b border-sky-200/80 bg-sky-100/80 text-xs font-semibold uppercase tracking-wide text-sky-700">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-3 py-2 text-center">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-sky-100/80">
        {visibleDays.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = isSameDay(day, today);
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const muted = !isCurrentMonth;

          return (
            <div key={key} className="bg-white">
              <div
                className={`flex h-full flex-col gap-2 rounded-2xl p-3 transition-shadow duration-150 ${
                  isToday
                    ? "ring-2 ring-sky-500/70 shadow-lg"
                    : "ring-1 ring-slate-200/60 hover:shadow-md"
                } ${muted ? "bg-slate-50" : "bg-white"}`}
              >
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span className={`${muted ? "text-slate-400" : "text-slate-600"}`}>
                    {day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  {isToday ? (
                    <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      Today
                    </span>
                  ) : null}
                </div>
                <div className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {dayEvents.length === 0 ? (
                    <p className={`text-[11px] ${muted ? "text-slate-300" : "text-slate-400"}`}>No events</p>
                  ) : (
                    dayEvents.map((event) => renderEventChip(event, muted, key))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const weekView = (
    <div className="overflow-hidden rounded-3xl border border-sky-200/70 bg-gradient-to-b from-white via-white to-sky-50 shadow-xl">
      <div className="grid grid-cols-7 gap-px border-b border-sky-200/80 bg-sky-100/80 text-xs font-semibold uppercase tracking-wide text-sky-700">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-3 py-2 text-center">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-sky-100/80">
        {visibleDays.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = isSameDay(day, today);

          return (
            <div key={key} className="bg-white">
              <div
                className={`flex h-full flex-col gap-3 rounded-3xl p-4 transition-shadow duration-150 ${
                  isToday
                    ? "ring-2 ring-sky-500/70 shadow-lg"
                    : "ring-1 ring-slate-200/60 hover:shadow-md"
                }`}
              >
                <div className="flex items-center justify-between text-sm font-semibold text-slate-600">
                  <span>{day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  {isToday ? (
                    <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      Today
                    </span>
                  ) : null}
                </div>
                <div className="flex min-h-[200px] flex-1 flex-col gap-2 overflow-y-auto pr-1">
                  {dayEvents.length === 0 ? (
                    <p className="text-[11px] text-slate-400">No events</p>
                  ) : (
                    dayEvents.map((event) => renderEventChip(event, false, key))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const dayView = (() => {
    const key = currentDate.toISOString().slice(0, 10);
    const dayEvents = eventsByDay.get(key) ?? [];

    return (
      <div className="rounded-3xl border border-sky-200/70 bg-gradient-to-br from-white via-white to-sky-50 shadow-xl">
        <div className="flex items-center justify-between rounded-t-3xl border-b border-sky-200/70 bg-sky-100/60 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Focused day</p>
            <h2 className="text-2xl font-semibold text-slate-900">
              {currentDate.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </h2>
          </div>
          {isSameDay(currentDate, today) ? (
            <span className="rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
              Today
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 px-6 py-6">
          {dayEvents.length === 0 ? (
            <p className="text-sm text-slate-500">No events scheduled for this day.</p>
          ) : (
            dayEvents.map((event) => (
              <div key={event.id} className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm transition hover:shadow-md">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">{event.summary ?? "Untitled event"}</h3>
                  <span className="rounded-full bg-sky-500/10 px-3 py-1 text-sm font-semibold text-sky-600">
                    {formatTimeRange(event)}
                  </span>
                </div>
                {event.location ? (
                  <p className="mt-2 text-sm text-slate-500">{event.location}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-slate-500">
                  <span>{resolveCalendarName(event, sources)}</span>
                  {event.status ? (
                    <span className="rounded-full bg-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600">
                      {event.status.replace(/_/g, " ")}
                    </span>
                  ) : null}
                  {(() => {
                    const link = getEventLink(event);
                    if (!link) return null;
                    return (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-600 hover:bg-sky-500/20"
                      >
                        Open in Google Calendar ↗
                      </a>
                    );
                  })()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  })();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-8 lg:px-8">
      <header className="mb-8 space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-sky-600">Synced schedules</p>
        <h1 className="text-3xl font-bold text-slate-900">Calendar</h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Explore everything that has been synced from your connected calendars. Switch between day, week, and month views,
          filter specific calendars, and open any event directly in Google Calendar.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-sky-200/70 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            View
            <select
              value={viewMode}
              onChange={(event) => setViewMode(event.target.value as CalendarViewMode)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              {VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
            Calendar
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="all">All calendars</option>
              {calendarOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700">
            <span>{rangeLabel}</span>
            <span className="text-slate-400">•</span>
            <span>
              {visibleEventCount} of {totalCount} events
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-1 py-1">
            <button
              type="button"
              onClick={handlePrev}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900"
            >
              ▶
            </button>
          </div>
          <button
            type="button"
            onClick={handleSyncAll}
            disabled={syncing || !accessToken}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
          >
            {syncing ? "Syncing…" : "Sync calendars"}
          </button>
        </div>
      </div>

      {syncMessage ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700 shadow-sm">
          {syncMessage}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-sm">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">
          Loading events…
        </div>
      ) : visibleEventCount === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">
          No events match the current filters.
        </div>
      ) : viewMode === "day" ? (
        dayView
      ) : viewMode === "week" ? (
        weekView
      ) : (
        monthView
      )}
    </div>
  );
}
