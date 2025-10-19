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

const HOURS = Array.from({ length: 24 }, (_, index) => index);

function formatHourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour, 0, 0).toLocaleTimeString(undefined, {
    hour: "numeric",
  });
}

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


function addMinutes(date: Date, amount: number): Date {
  const clone = new Date(date);
  clone.setMinutes(clone.getMinutes() + amount);
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
    const startLabel = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const endLabel = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `${startLabel} – ${endLabel}`;
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

function formatEventDateRange(event: CalendarEventRecord): string {
  const start = parseDate(event.startAt);
  const end = parseDate(event.endAt);

  if (event.isAllDay && start && end) {
    const adjustedEnd = addDays(end, -1);
    if (isSameDay(start, adjustedEnd)) {
      return start.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
    const startLabel = start.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const endLabel = adjustedEnd.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startLabel} – ${endLabel}`;
  }

  if (start && end) {
    const sameDay = isSameDay(start, end);
    const startLabel = start.toLocaleDateString(undefined, {
      weekday: sameDay ? undefined : "short",
      month: "short",
      day: "numeric",
      year: !sameDay ? "numeric" : undefined,
    });
    const endLabel = end.toLocaleDateString(undefined, {
      weekday: sameDay ? undefined : "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const timeRange = `${start.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;

    return sameDay ? `${startLabel} • ${timeRange}` : `${startLabel} ${timeRange} → ${endLabel}`;
  }

  if (start) {
    return `${start.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })} • ${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }

  if (end) {
    return `${end.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })} • ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }

  return "Schedule unknown";
}

function isEventAllDay(event: CalendarEventRecord): boolean {
  if (event.isAllDay) return true;
  const start = parseDate(event.startAt);
  const end = parseDate(event.endAt);
  if (!start || !end) return false;
  const durationMs = end.getTime() - start.getTime();
  return durationMs >= 24 * 60 * 60 * 1000 && start.getHours() === 0 && end.getHours() === 0;
}

function getEventPositionWithinDay(
  event: CalendarEventRecord,
  dayStart: Date
): { topPercent: number; heightPercent: number; startsBeforeDay: boolean; endsAfterDay: boolean } {
  const start = parseDate(event.startAt);
  const end = parseDate(event.endAt);
  const dayEnd = addDays(dayStart, 1);

  const effectiveStart = start ? (start < dayStart ? dayStart : start) : dayStart;
  const effectiveEnd = end ? (end > dayEnd ? dayEnd : end) : addMinutes(effectiveStart, 30);

  const startOffsetMs = effectiveStart.getTime() - dayStart.getTime();
  const endOffsetMs = effectiveEnd.getTime() - dayStart.getTime();
  const millisecondsInDay = 24 * 60 * 60 * 1000;
  const topPercent = Math.max(0, (startOffsetMs / millisecondsInDay) * 100);
  const heightPercent = Math.max(6, ((endOffsetMs - startOffsetMs) / millisecondsInDay) * 100);

  return {
    topPercent,
    heightPercent,
    startsBeforeDay: !!start && start < dayStart,
    endsAfterDay: !!end && end > dayEnd,
  };
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
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRecord | null>(null);

  useEffect(() => {
    if (!selectedEvent) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedEvent(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [selectedEvent]);

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

  const eventsByDay = useMemo(() => {
    const map = new Map<string, { allDay: CalendarEventRecord[]; timed: CalendarEventRecord[] }>();

    const lastVisibleDay = addDays(gridRange.end, -1);

    for (const event of filteredEvents) {
      const startRaw = parseDate(event.startAt) ?? parseDate(event.endAt);
      const endRaw = parseDate(event.endAt) ?? parseDate(event.startAt) ?? startRaw;
      if (!startRaw && !endRaw) continue;

      const eventStart = startOfDay(startRaw ?? gridRange.start);
      const eventEnd = startOfDay(endRaw ?? gridRange.start);



  const eventsByDay = useMemo(() => {
    const map = new Map<string, { allDay: CalendarEventRecord[]; timed: CalendarEventRecord[] }>();
    const lastVisibleDay = addDays(gridRange.end, -1);



  const eventsByDay = useMemo(() => {
    const map = new Map<string, { allDay: CalendarEventRecord[]; timed: CalendarEventRecord[] }>();
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

          map.set(key, { allDay: [], timed: [] });
        }
        const bucket = map.get(key)!;
        if (isEventAllDay(event)) {
          bucket.allDay.push(event);
        } else {
          bucket.timed.push(event);
        }

      }
    }

    for (const dayEvents of map.values()) {

      dayEvents.sort((a, b) => {

      dayEvents.allDay.sort((a, b) => {
        const aStart = parseDate(a.startAt) ?? parseDate(a.endAt) ?? new Date(0);
        const bStart = parseDate(b.startAt) ?? parseDate(b.endAt) ?? new Date(0);
        return aStart.getTime() - bStart.getTime();
      });
      dayEvents.timed.sort((a, b) => {

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


    return map;
  }, [filteredEvents, gridRange]);

  const visibleEventCount = filteredEvents.length;
  const today = useMemo(() => startOfDay(new Date()), []);
  const rangeLabel = useMemo(() => formatViewRangeLabel(currentDate, viewMode), [currentDate, viewMode]);
  const selectedEventCalendarName = selectedEvent ? resolveCalendarName(selectedEvent, sources) : null;
  const selectedEventLink = selectedEvent ? getEventLink(selectedEvent) : null;
  const selectedEventRangeLabel = selectedEvent ? formatEventDateRange(selectedEvent) : null;
  const selectedEventStatus = selectedEvent?.status ? selectedEvent.status.replace(/_/g, " ") : null;
  const selectedEventDescription = selectedEvent?.description?.trim() || null;


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


    return map;
  }, [filteredEvents, gridRange]);

  const visibleEventCount = filteredEvents.length;
  const today = useMemo(() => startOfDay(new Date()), []);
  const rangeLabel = useMemo(() => formatViewRangeLabel(currentDate, viewMode), [currentDate, viewMode]);
  const selectedEventCalendarName = selectedEvent ? resolveCalendarName(selectedEvent, sources) : null;
  const selectedEventLink = selectedEvent ? getEventLink(selectedEvent) : null;
  const selectedEventRangeLabel = selectedEvent ? formatEventDateRange(selectedEvent) : null;
  const selectedEventStatus = selectedEvent?.status ? selectedEvent.status.replace(/_/g, " ") : null;
  const selectedEventDescription = selectedEvent?.description?.trim() || null;

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

  const handleEventSelect = useCallback((event: CalendarEventRecord) => {
    setSelectedEvent(event);
  }, []);

  const renderAllDayEvent = useCallback(
    (event: CalendarEventRecord, muted: boolean, dayKey: string) => {
      const key = `${event.id}-${dayKey}-all-day`;
      return (
        <button
          key={key}
          type="button"
          onClick={() => handleEventSelect(event)}
          className={`group inline-flex min-w-0 items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-left text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-sky-400 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${muted ? "opacity-70" : ""}`}
        >
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" />
          <span className="truncate">{event.summary ?? "Untitled event"}</span>
        </button>
      );
    },
    [handleEventSelect]
  );

  const renderTimedListEvent = useCallback(
    (event: CalendarEventRecord, muted: boolean, dayKey: string) => {
      const key = `${event.id}-${dayKey}-timed`;
      const timeRange = formatTimeRange(event);
      return (
        <button
          key={key}
          type="button"
          onClick={() => handleEventSelect(event)}
          className={`group flex w-full items-start gap-2 rounded-md border border-slate-200/70 bg-white px-2 py-1 text-left text-[11px] transition hover:border-sky-400 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${muted ? "opacity-70" : ""}`}
        >
          <span className="mt-0.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {timeRange}
          </span>
          <span className="flex-1 truncate text-[12px] font-semibold text-slate-800">{event.summary ?? "Untitled event"}</span>
        </button>
      );
    },
    [handleEventSelect]
  );


  const handleEventSelect = useCallback((event: CalendarEventRecord) => {
    setSelectedEvent(event);
  }, []);

  const renderAllDayEvent = useCallback(
    (event: CalendarEventRecord, muted: boolean, dayKey: string) => {
      const key = `${event.id}-${dayKey}-all-day`;
      return (
        <button
          key={key}
          type="button"
          onClick={() => handleEventSelect(event)}
          className={`group inline-flex min-w-0 items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-left text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-sky-400 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${muted ? "opacity-70" : ""}`}
        >
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" />
          <span className="truncate">{event.summary ?? "Untitled event"}</span>
        </button>
      );
    },
    [handleEventSelect]
  );

  const renderTimedListEvent = useCallback(
    (event: CalendarEventRecord, muted: boolean, dayKey: string) => {
      const key = `${event.id}-${dayKey}-timed`;
      const timeRange = formatTimeRange(event);
      return (
        <button
          key={key}
          type="button"
          onClick={() => handleEventSelect(event)}
          className={`group flex w-full items-start gap-2 rounded-md border border-slate-200/70 bg-white px-2 py-1 text-left text-[11px] transition hover:border-sky-400 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${muted ? "opacity-70" : ""}`}
        >
          <span className="mt-0.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {timeRange}
          </span>
          <span className="flex-1 truncate text-[12px] font-semibold text-slate-800">{event.summary ?? "Untitled event"}</span>
        </button>
      );
    },
    [handleEventSelect]
  );


    return map;
  }, [filteredEvents, gridRange]);

  const visibleEventCount = filteredEvents.length;
  const today = useMemo(() => startOfDay(new Date()), []);
  const rangeLabel = useMemo(() => formatViewRangeLabel(currentDate, viewMode), [currentDate, viewMode]);
  const selectedEventCalendarName = selectedEvent ? resolveCalendarName(selectedEvent, sources) : null;
  const selectedEventLink = selectedEvent ? getEventLink(selectedEvent) : null;
  const selectedEventRangeLabel = selectedEvent ? formatEventDateRange(selectedEvent) : null;
  const selectedEventStatus = selectedEvent?.status ? selectedEvent.status.replace(/_/g, " ") : null;
  const selectedEventDescription = selectedEvent?.description?.trim() || null;

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

  const handleEventSelect = useCallback((event: CalendarEventRecord) => {
    setSelectedEvent(event);
  }, []);

  const renderAllDayEvent = useCallback(
    (event: CalendarEventRecord, muted: boolean, dayKey: string) => {
      const key = `${event.id}-${dayKey}-all-day`;
      return (
        <button
          key={key}
          type="button"
          onClick={() => handleEventSelect(event)}
          className={`group inline-flex min-w-0 items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-left text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-sky-400 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${muted ? "opacity-70" : ""}`}
        >
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" />
          <span className="truncate">{event.summary ?? "Untitled event"}</span>
        </button>
      );
    },
    [handleEventSelect]
  );

  const renderTimedListEvent = useCallback(
    (event: CalendarEventRecord, muted: boolean, dayKey: string) => {
      const key = `${event.id}-${dayKey}-timed`;
      const timeRange = formatTimeRange(event);
      return (
        <button
          key={key}
          type="button"
          onClick={() => handleEventSelect(event)}
          className={`group flex w-full items-start gap-2 rounded-md border border-slate-200/70 bg-white px-2 py-1 text-left text-[11px] transition hover:border-sky-400 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${muted ? "opacity-70" : ""}`}
        >
          <span className="mt-0.5 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {timeRange}
          </span>
          <span className="flex-1 truncate text-[12px] font-semibold text-slate-800">{event.summary ?? "Untitled event"}</span>
        </button>
      );
    },
    [handleEventSelect]
  );

  const renderTimedBlock = useCallback(
    (event: CalendarEventRecord, day: Date, dayKey: string) => {
      const key = `${event.id}-${dayKey}-block`;
      const { heightPercent, topPercent, startsBeforeDay, endsAfterDay } = getEventPositionWithinDay(
        event,
        startOfDay(day)
      );
      const timeRange = formatTimeRange(event);


      return (
        <button
          key={key}
          type="button"
          onClick={() => handleEventSelect(event)}
          style={{ top: `${topPercent}%`, height: `${heightPercent}%` }}
          className="absolute left-1 right-1 flex flex-col gap-1 overflow-hidden rounded-md border border-sky-200 bg-sky-50/90 px-2 py-1 text-left text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-sky-400 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{timeRange}</span>
          <span className="truncate text-[12px] font-semibold text-slate-800">{event.summary ?? "Untitled event"}</span>
          {(startsBeforeDay || endsAfterDay) && (
            <span className="text-[9px] uppercase tracking-wide text-slate-400">Continues</span>
          )}
        </button>
      );
    },
    [handleEventSelect]
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
          const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };
          const isToday = isSameDay(day, today);
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const muted = !isCurrentMonth;

          return (
            <div key={key} className="bg-white">
              <div
                className={`grid h-full grid-rows-[auto,1fr] gap-2 rounded-2xl border border-slate-200/60 p-2 transition-shadow duration-150 ${
                  isToday ? "shadow-lg ring-2 ring-sky-500/70" : "hover:shadow-md"
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
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1">
                    {bucket.allDay.length > 0 ? (
                      bucket.allDay.map((event) => renderAllDayEvent(event, muted, key))
                    ) : (
                      <span className={`text-[10px] uppercase tracking-wide ${muted ? "text-slate-300" : "text-slate-300"}`}>
                        All-day free
                      </span>
                    )}
                  </div>
                  <div className="flex min-h-[80px] flex-1 flex-col gap-1 overflow-y-auto pr-1">
                    {bucket.timed.length > 0 ? (
                      bucket.timed.map((event) => renderTimedListEvent(event, muted, key))
                    ) : (
                      <span className={`text-[11px] ${muted ? "text-slate-300" : "text-slate-400"}`}>No timed events</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const weekView = (
    <div className="overflow-hidden rounded-3xl border border-sky-200/70 bg-white shadow-xl">
      <div className="grid grid-cols-[100px,repeat(7,minmax(0,1fr))] border-b border-sky-200/80 bg-sky-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <div className="px-3 py-3" />
        {visibleDays.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={`head-${day.toISOString()}`}
              className={`px-3 py-3 text-center font-semibold ${isToday ? "text-sky-600" : "text-slate-500"}`}
            >
              <div>{WEEKDAY_LABELS[day.getDay()]}</div>
              <div className="text-base font-bold text-slate-700">{day.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[100px,repeat(7,minmax(0,1fr))] border-b border-sky-200/80 bg-sky-100/70 text-xs font-semibold uppercase tracking-wide text-sky-700">
        <div className="px-3 py-3 text-left text-slate-500">All-day</div>
        {visibleDays.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };
          const isToday = isSameDay(day, today);
          return (
            <div
              key={`all-${key}`}
              className={`flex min-h-[62px] flex-wrap items-start gap-1 px-3 py-3 ${
                isToday ? "bg-white" : "bg-sky-50/60"
              }`}
            >
              {bucket.allDay.length > 0 ? (
                bucket.allDay.map((event) => renderAllDayEvent(event, false, key))
              ) : (
                <span className="text-[10px] uppercase tracking-wide text-slate-300">Free</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[100px,repeat(7,minmax(0,1fr))]">
        <div className="relative h-[720px] border-r border-slate-200 bg-slate-50/60">
          {HOURS.map((hour) => (
            <div
              key={`label-${hour}`}
              style={{ top: `${(hour / 24) * 100}%` }}
              className="absolute left-0 right-0 -mt-3 flex items-center justify-end pr-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              {formatHourLabel(hour)}
            </div>
          ))}

        </div>
        {visibleDays.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };
          const isToday = isSameDay(day, today);

          return (
            <div key={key} className={`relative h-[720px] border-l border-slate-200 ${isToday ? "bg-sky-50" : "bg-white"}`}>
              {HOURS.map((hour) => (
                <div
                  key={`grid-${key}-${hour}`}
                  style={{ top: `${(hour / 24) * 100}%` }}
                  className="absolute left-0 right-0 -mt-px border-t border-dashed border-slate-200/70"
                />
              ))}
              {bucket.timed.length === 0 ? (
                <span className="absolute left-1 right-1 top-1 text-[11px] text-slate-300">No scheduled events</span>
              ) : null}
              {bucket.timed.map((event) => renderTimedBlock(event, day, key))}
            </div>
          );
        })}
      </div>
    </div>
  );


  const dayView = (() => {
    const key = currentDate.toISOString().slice(0, 10);
    const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };

    return (
      <div className="overflow-hidden rounded-3xl border border-sky-200/70 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-sky-200/70 bg-sky-50/70 px-6 py-5">
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
        <div className="border-b border-slate-200/70 px-6 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">All-day</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {bucket.allDay.length > 0 ? (
              bucket.allDay.map((event) => renderAllDayEvent(event, false, key))
            ) : (
              <span className="text-xs uppercase tracking-wide text-slate-300">No all-day events</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[80px,1fr]">
          <div className="relative h-[720px] border-r border-slate-200 bg-slate-50/60">
            {HOURS.map((hour) => (
              <div
                key={`day-label-${hour}`}
                style={{ top: `${(hour / 24) * 100}%` }}
                className="absolute left-0 right-0 -mt-3 flex justify-end pr-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>
          <div className="relative h-[720px]">
            {HOURS.map((hour) => (
              <div
                key={`day-grid-${hour}`}
                style={{ top: `${(hour / 24) * 100}%` }}
                className="absolute left-0 right-0 -mt-px border-t border-dashed border-slate-200/70"
              />
            ))}
            {bucket.timed.length === 0 ? (
              <span className="absolute left-3 right-3 top-3 text-sm text-slate-300">No timed events scheduled</span>
            ) : null}
            {bucket.timed.map((event) => renderTimedBlock(event, currentDate, key))}
          </div>
        </div>
      </div>
    );
  })();


        </div>
        {visibleDays.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };
          const isToday = isSameDay(day, today);

          return (
            <div key={key} className={`relative h-[720px] border-l border-slate-200 ${isToday ? "bg-sky-50" : "bg-white"}`}>
              {HOURS.map((hour) => (
                <div
                  key={`grid-${key}-${hour}`}
                  style={{ top: `${(hour / 24) * 100}%` }}
                  className="absolute left-0 right-0 -mt-px border-t border-dashed border-slate-200/70"
                />
              ))}
              {bucket.timed.length === 0 ? (
                <span className="absolute left-1 right-1 top-1 text-[11px] text-slate-300">No scheduled events</span>
              ) : null}
              {bucket.timed.map((event) => renderTimedBlock(event, day, key))}
            </div>
          );
        })}
      </div>
    </div>
  );

  const dayView = (() => {
    const key = currentDate.toISOString().slice(0, 10);
    const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };

    return (
      <div className="overflow-hidden rounded-3xl border border-sky-200/70 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-sky-200/70 bg-sky-50/70 px-6 py-5">
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
        <div className="border-b border-slate-200/70 px-6 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">All-day</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {bucket.allDay.length > 0 ? (
              bucket.allDay.map((event) => renderAllDayEvent(event, false, key))
            ) : (
              <span className="text-xs uppercase tracking-wide text-slate-300">No all-day events</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[80px,1fr]">
          <div className="relative h-[720px] border-r border-slate-200 bg-slate-50/60">
            {HOURS.map((hour) => (
              <div
                key={`day-label-${hour}`}
                style={{ top: `${(hour / 24) * 100}%` }}
                className="absolute left-0 right-0 -mt-3 flex justify-end pr-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>
          <div className="relative h-[720px]">
            {HOURS.map((hour) => (
              <div
                key={`day-grid-${hour}`}
                style={{ top: `${(hour / 24) * 100}%` }}
                className="absolute left-0 right-0 -mt-px border-t border-dashed border-slate-200/70"
              />
            ))}
            {bucket.timed.length === 0 ? (
              <span className="absolute left-3 right-3 top-3 text-sm text-slate-300">No timed events scheduled</span>
            ) : null}
            {bucket.timed.map((event) => renderTimedBlock(event, currentDate, key))}
          </div>
        </div>
      </div>
    );
  })();


      return (
        <button
          key={key}
          type="button"
          onClick={() => handleEventSelect(event)}
          style={{ top: `${topPercent}%`, height: `${heightPercent}%` }}
          className="absolute left-1 right-1 flex flex-col gap-1 overflow-hidden rounded-md border border-sky-200 bg-sky-50/90 px-2 py-1 text-left text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-sky-400 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{timeRange}</span>
          <span className="truncate text-[12px] font-semibold text-slate-800">{event.summary ?? "Untitled event"}</span>
          {(startsBeforeDay || endsAfterDay) && (
            <span className="text-[9px] uppercase tracking-wide text-slate-400">Continues</span>
          )}
        </button>
      );
    },
    [handleEventSelect]
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
          const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };
          const isToday = isSameDay(day, today);
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const muted = !isCurrentMonth;

          return (
            <div key={key} className="bg-white">
              <div
                className={`grid h-full grid-rows-[auto,1fr] gap-2 rounded-2xl border border-slate-200/60 p-2 transition-shadow duration-150 ${
                  isToday ? "shadow-lg ring-2 ring-sky-500/70" : "hover:shadow-md"
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
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1">
                    {bucket.allDay.length > 0 ? (
                      bucket.allDay.map((event) => renderAllDayEvent(event, muted, key))
                    ) : (
                      <span className={`text-[10px] uppercase tracking-wide ${muted ? "text-slate-300" : "text-slate-300"}`}>
                        All-day free
                      </span>
                    )}
                  </div>
                  <div className="flex min-h-[80px] flex-1 flex-col gap-1 overflow-y-auto pr-1">
                    {bucket.timed.length > 0 ? (
                      bucket.timed.map((event) => renderTimedListEvent(event, muted, key))
                    ) : (
                      <span className={`text-[11px] ${muted ? "text-slate-300" : "text-slate-400"}`}>No timed events</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const weekView = (
    <div className="overflow-hidden rounded-3xl border border-sky-200/70 bg-white shadow-xl">
      <div className="grid grid-cols-[100px,repeat(7,minmax(0,1fr))] border-b border-sky-200/80 bg-sky-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <div className="px-3 py-3" />
        {visibleDays.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={`head-${day.toISOString()}`}
              className={`px-3 py-3 text-center font-semibold ${isToday ? "text-sky-600" : "text-slate-500"}`}
            >
              <div>{WEEKDAY_LABELS[day.getDay()]}</div>
              <div className="text-base font-bold text-slate-700">{day.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[100px,repeat(7,minmax(0,1fr))] border-b border-sky-200/80 bg-sky-100/70 text-xs font-semibold uppercase tracking-wide text-sky-700">
        <div className="px-3 py-3 text-left text-slate-500">All-day</div>
        {visibleDays.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };
          const isToday = isSameDay(day, today);
          return (
            <div
              key={`all-${key}`}
              className={`flex min-h-[62px] flex-wrap items-start gap-1 px-3 py-3 ${
                isToday ? "bg-white" : "bg-sky-50/60"
              }`}
            >
              {bucket.allDay.length > 0 ? (
                bucket.allDay.map((event) => renderAllDayEvent(event, false, key))
              ) : (
                <span className="text-[10px] uppercase tracking-wide text-slate-300">Free</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[100px,repeat(7,minmax(0,1fr))]">
        <div className="relative h-[720px] border-r border-slate-200 bg-slate-50/60">
          {HOURS.map((hour) => (
            <div
              key={`label-${hour}`}
              style={{ top: `${(hour / 24) * 100}%` }}
              className="absolute left-0 right-0 -mt-3 flex items-center justify-end pr-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              {formatHourLabel(hour)}
            </div>
          ))}
        </div>
        {visibleDays.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };
          const isToday = isSameDay(day, today);

          return (
            <div key={key} className={`relative h-[720px] border-l border-slate-200 ${isToday ? "bg-sky-50" : "bg-white"}`}>
              {HOURS.map((hour) => (
                <div
                  key={`grid-${key}-${hour}`}
                  style={{ top: `${(hour / 24) * 100}%` }}
                  className="absolute left-0 right-0 -mt-px border-t border-dashed border-slate-200/70"
                />
              ))}
              {bucket.timed.length === 0 ? (
                <span className="absolute left-1 right-1 top-1 text-[11px] text-slate-300">No scheduled events</span>
              ) : null}
              {bucket.timed.map((event) => renderTimedBlock(event, day, key))}
            </div>
          );
        })}
      </div>
    </div>
  );

  const dayView = (() => {
    const key = currentDate.toISOString().slice(0, 10);
    const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };

    return (
      <div className="overflow-hidden rounded-3xl border border-sky-200/70 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-sky-200/70 bg-sky-50/70 px-6 py-5">
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
        <div className="border-b border-slate-200/70 px-6 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">All-day</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {bucket.allDay.length > 0 ? (
              bucket.allDay.map((event) => renderAllDayEvent(event, false, key))
            ) : (
              <span className="text-xs uppercase tracking-wide text-slate-300">No all-day events</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[80px,1fr]">
          <div className="relative h-[720px] border-r border-slate-200 bg-slate-50/60">
            {HOURS.map((hour) => (
              <div
                key={`day-label-${hour}`}
                style={{ top: `${(hour / 24) * 100}%` }}
                className="absolute left-0 right-0 -mt-3 flex justify-end pr-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>
          <div className="relative h-[720px]">
            {HOURS.map((hour) => (
              <div
                key={`day-grid-${hour}`}
                style={{ top: `${(hour / 24) * 100}%` }}
                className="absolute left-0 right-0 -mt-px border-t border-dashed border-slate-200/70"
              />
            ))}
            {bucket.timed.length === 0 ? (
              <span className="absolute left-3 right-3 top-3 text-sm text-slate-300">No timed events scheduled</span>
            ) : null}
            {bucket.timed.map((event) => renderTimedBlock(event, currentDate, key))}
          </div>
        </div>
      </div>
    );
  })();


  const eventModal = selectedEvent ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={() => setSelectedEvent(null)}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setSelectedEvent(null)}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
          aria-label="Close event details"
        >
          ✕
        </button>
        <div className="space-y-5 px-6 py-7">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Event details</p>
            <h3 className="text-2xl font-semibold text-slate-900">
              {selectedEvent.summary ?? "Untitled event"}
            </h3>
            {selectedEventRangeLabel ? (
              <p className="text-sm text-slate-500">{selectedEventRangeLabel}</p>
            ) : null}
            {selectedEvent?.isAllDay ? (
              <p className="text-sm font-semibold text-slate-700">All day</p>
            ) : null}
          </div>
          <div className="space-y-3 text-sm text-slate-600">
            {selectedEventCalendarName ? (
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Calendar</span>
                <span className="font-medium text-slate-700">{selectedEventCalendarName}</span>
              </div>
            ) : null}
            {selectedEvent.location ? (
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Location</span>
                <span className="font-medium text-slate-700">{selectedEvent.location}</span>
              </div>
            ) : null}
            {selectedEventStatus ? (
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Status</span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {selectedEventStatus}
                </span>
              </div>
            ) : null}
            {selectedEventDescription ? (
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</span>
                <p className="whitespace-pre-wrap text-sm text-slate-600">{selectedEventDescription}</p>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {selectedEventLink ? (
              <a
                href={selectedEventLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700"
              >
                Open in Google Calendar ↗
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => setSelectedEvent(null)}
              className="inline-flex items-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
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
      {eventModal}
    </>
  );
}
