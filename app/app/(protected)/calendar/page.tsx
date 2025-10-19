"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  createCalendarEvent,
  fetchCalendarEvents,
  fetchCalendarSources,
  fetchProjects,
  fetchProjectSources,
  type CalendarEventsResponse,
  type CreateCalendarEventInput,
  type ProjectListItem,
} from "@/lib/supabaseClient";
import type { CalendarEventRecord, ProjectSourceRecord, UserCalendarSourceRecord } from "@kazador/shared";

const VIEW_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

type CalendarViewMode = (typeof VIEW_OPTIONS)[number]["value"];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, index) => index);

interface CreateEventFormState {
  summary: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  location: string;
  projectId: string;
  projectSourceId: string;
  userSourceId: string;
}

const INITIAL_CREATE_EVENT: CreateEventFormState = {
  summary: "",
  date: "",
  startTime: "",
  endTime: "",
  description: "",
  location: "",
  projectId: "",
  projectSourceId: "",
  userSourceId: "",
};

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
    return "–";
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
  return "–";
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
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateEventFormState>({ ...INITIAL_CREATE_EVENT });
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectCalendars, setProjectCalendars] = useState<Record<string, ProjectSourceRecord[]>>({});
  const [projectCalendarsLoading, setProjectCalendarsLoading] = useState(false);
  const [projectCalendarsError, setProjectCalendarsError] = useState<string | null>(null);

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
    if (!createModalOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateModalOpen(false);
        setCreateError(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [createModalOpen]);

  useEffect(() => {
    if (!createModalOpen) return;
    if (!accessToken) {
      setCreateError("Your session expired. Please sign in again.");
      return;
    }
    if (projects.length > 0) {
      return;
    }

    let ignore = false;
    const loadProjects = async () => {
      setProjectsLoading(true);
      setProjectsError(null);
      try {
        const list = await fetchProjects({ accessToken });
        if (!ignore) {
          setProjects(list);
        }
      } catch (err: any) {
        if (!ignore) {
          setProjectsError(err?.message || "Failed to load projects");
        }
      } finally {
        if (!ignore) {
          setProjectsLoading(false);
        }
      }
    };

    loadProjects();

    return () => {
      ignore = true;
    };
  }, [createModalOpen, accessToken, projects.length]);

  useEffect(() => {
    if (!createModalOpen) return;

    const projectId = createForm.projectId;
    if (!projectId) {
      setProjectCalendarsError(null);
      setProjectCalendarsLoading(false);
      setCreateForm((prev) => (prev.projectSourceId === "" ? prev : { ...prev, projectSourceId: "" }));
      return;
    }

    if (!accessToken) {
      setProjectCalendarsError("Your session expired. Please sign in again.");
      return;
    }

    const cached = projectCalendars[projectId];
    if (cached) {
      setCreateForm((prev) => {
        const nextSourceId = cached.some((source) => source.id === prev.projectSourceId)
          ? prev.projectSourceId
          : cached[0]?.id ?? "";
        const defaultUserSourceId = sources[0]?.id ?? "";
        const nextUserSourceId =
          cached.length === 0 ? prev.userSourceId || defaultUserSourceId : prev.userSourceId;

        if (nextSourceId === prev.projectSourceId && nextUserSourceId === prev.userSourceId) {
          return prev;
        }

        return {
          ...prev,
          projectSourceId: nextSourceId,
          userSourceId: cached.length === 0 ? nextUserSourceId : prev.userSourceId,
        };
      });
      return;
    }

    let cancelled = false;
    setProjectCalendarsLoading(true);
    setProjectCalendarsError(null);
    void fetchProjectSources(projectId, accessToken)
      .then((sourceList) => {
        if (cancelled) return;
        const calendars = sourceList.filter((source) => source.kind === "calendar");
        setProjectCalendars((prev) => ({ ...prev, [projectId]: calendars }));
        setCreateForm((prev) => {
          const defaultUserSourceId = sources[0]?.id ?? "";
          const nextUserSourceId =
            calendars.length === 0 ? prev.userSourceId || defaultUserSourceId : prev.userSourceId;
          return {
            ...prev,
            projectSourceId: calendars[0]?.id ?? "",
            userSourceId: calendars.length === 0 ? nextUserSourceId : prev.userSourceId,
          };
        });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setProjectCalendarsError(err?.message || "Failed to load project calendars");
        setCreateForm((prev) => ({ ...prev, projectSourceId: "" }));
      })
      .finally(() => {
        if (!cancelled) {
          setProjectCalendarsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [createModalOpen, createForm.projectId, accessToken, projectCalendars, sources]);

  useEffect(() => {
    if (!createModalOpen) return;
    if (createForm.userSourceId) return;
    if (sources.length === 0) return;

    const projectId = createForm.projectId;
    const projectHasCalendars = projectId ? (projectCalendars[projectId]?.length ?? 0) > 0 : false;
    if (projectId && projectHasCalendars) {
      return;
    }

    setCreateForm((prev) => {
      if (prev.userSourceId) {
        return prev;
      }
      return { ...prev, userSourceId: sources[0]!.id };
    });
  }, [createModalOpen, createForm.projectId, createForm.userSourceId, sources, projectCalendars]);

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

  const selectedProjectCalendars = useMemo(() => {
    if (!createForm.projectId) return [] as ProjectSourceRecord[];
    return projectCalendars[createForm.projectId] ?? [];
  }, [createForm.projectId, projectCalendars]);

  const isProjectSelected = createForm.projectId !== "";
  const projectHasCalendars = selectedProjectCalendars.length > 0;
  const shouldUsePersonalCalendars = !isProjectSelected || !projectHasCalendars;
  const missingProjectCalendarSelection =
    isProjectSelected && projectHasCalendars && createForm.projectSourceId === "";
  const missingPersonalCalendarSelection =
    shouldUsePersonalCalendars && (sources.length === 0 || createForm.userSourceId === "");
  const createButtonDisabled =
    createSubmitting || projectCalendarsLoading || missingProjectCalendarSelection || missingPersonalCalendarSelection;

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

  const handleOpenCreateModal = useCallback(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const defaultUserSourceId = sources[0]?.id ?? "";
    setCreateForm({
      ...INITIAL_CREATE_EVENT,
      date: todayIso,
      userSourceId: defaultUserSourceId,
    });
    setCreateError(null);
    setProjectCalendarsError(null);
    setProjectCalendarsLoading(false);
    setCreateModalOpen(true);
  }, [sources]);

  const handleCloseCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    setCreateError(null);
  }, []);

  const handleCreateInputChange = useCallback((field: keyof CreateEventFormState, value: string) => {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleProjectChange = useCallback(
    (value: string) => {
      setCreateForm((prev) => {
        if (value) {
          const defaultUserSourceId = sources[0]?.id ?? "";
          const nextUserSourceId = prev.userSourceId || defaultUserSourceId;
          if (
            prev.projectId === value &&
            prev.projectSourceId === "" &&
            prev.userSourceId === nextUserSourceId
          ) {
            return prev;
          }
          return {
            ...prev,
            projectId: value,
            projectSourceId: "",
            userSourceId: nextUserSourceId,
          };
        }

        const defaultUserSourceId = sources[0]?.id ?? "";
        const nextUserSourceId = prev.userSourceId || defaultUserSourceId;

        if (prev.projectId === "" && prev.projectSourceId === "" && prev.userSourceId === nextUserSourceId) {
          return prev;
        }

        return {
          ...prev,
          projectId: "",
          projectSourceId: "",
          userSourceId: nextUserSourceId,
        };
      });
    },
    [sources]
  );

  const handleCreateSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!accessToken) {
        setCreateError("Your session expired. Please sign in again.");
        return;
      }

      if (!createForm.summary.trim()) {
        setCreateError("Event name is required");
        return;
      }

      if (!createForm.date) {
        setCreateError("Select a date for the event");
        return;
      }

      const hasProject = createForm.projectId !== "";
      const useProjectCalendar = hasProject && projectHasCalendars;
      const needsUserCalendar = !useProjectCalendar;

      if (useProjectCalendar) {
        if (!createForm.projectSourceId) {
          setCreateError("Select which project calendar to use");
          return;
        }
      }

      if (needsUserCalendar) {
        if (!createForm.userSourceId) {
          if (sources.length === 0) {
            setCreateError("Connect a Google Calendar or link the event to a project.");
          } else {
            setCreateError("Select which calendar to add the event to");
          }
          return;
        }
      }

      const payload: CreateCalendarEventInput = {
        summary: createForm.summary.trim(),
        date: createForm.date,
        startTime: createForm.startTime ? createForm.startTime : null,
        endTime: createForm.endTime ? createForm.endTime : null,
        description: createForm.description.trim() ? createForm.description.trim() : null,
        location: createForm.location.trim() ? createForm.location.trim() : null,
        projectId: hasProject ? createForm.projectId : null,
        projectSourceId: useProjectCalendar ? createForm.projectSourceId : null,
        userSourceId: needsUserCalendar ? createForm.userSourceId : null,
      };

      setCreateSubmitting(true);
      setCreateError(null);
      try {
        const result = await createCalendarEvent(payload, accessToken);
        setSyncMessage("Event created and synced to Google Calendar.");
        handleCloseCreateModal();
        setCreateForm({ ...INITIAL_CREATE_EVENT });
        await reloadEvents();
        setSelectedEvent(result.event);
      } catch (err: any) {
        setCreateError(err?.message || "Failed to create calendar event");
      } finally {
        setCreateSubmitting(false);
      }
    },
    [accessToken, createForm, handleCloseCreateModal, reloadEvents, sources, projectHasCalendars]
  );

  const renderAllDayEvent = useCallback(
    (event: CalendarEventRecord, muted: boolean, dayKey: string) => {
      const key = `${event.id}-${dayKey}-all-day`;
      return (
        <button
          key={key}
          type="button"
          onClick={() => handleEventSelect(event)}
          className={`group inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 shadow-sm transition hover:border-sky-400 hover:bg-sky-100 hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${muted ? "opacity-60" : ""}`}
        >
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" />
          <span className="truncate flex-1 min-w-0">{event.summary ?? "Untitled event"}</span>
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
          className={`group flex w-full max-w-full items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs transition hover:border-sky-400 hover:bg-sky-50 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${muted ? "opacity-60" : ""}`}
        >
          <span className="mt-0.5 flex-shrink-0 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {timeRange}
          </span>
          <span className="flex-1 min-w-0 truncate text-xs font-semibold text-slate-800">{event.summary ?? "Untitled event"}</span>
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
          className="absolute left-1.5 right-1.5 flex flex-col gap-0.5 overflow-hidden rounded-lg border border-sky-200 bg-sky-50/95 px-2 py-1.5 text-left text-xs font-medium text-slate-700 shadow-sm transition hover:border-sky-400 hover:bg-sky-100 hover:shadow hover:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 focus-visible:z-10"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 truncate">{timeRange}</span>
          <span className="truncate text-xs font-semibold text-slate-800 leading-tight">{event.summary ?? "Untitled event"}</span>
          {(startsBeforeDay || endsAfterDay) && (
            <span className="text-[9px] uppercase tracking-wide text-slate-400">Continues</span>
          )}
        </button>
      );
    },
    [handleEventSelect]
  );

  const monthView = (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
      <div className="grid grid-cols-7 gap-px border-b border-slate-200 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="bg-white px-3 py-3 text-center">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-slate-200">
        {visibleDays.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };
          const isToday = isSameDay(day, today);
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const muted = !isCurrentMonth;

          return (
            <div key={key} className="bg-white min-h-[140px] overflow-hidden">
              <div
                className={`flex h-full flex-col gap-2 p-3 ${
                  isToday ? "bg-sky-50/50" : muted ? "bg-slate-50/50" : "bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-bold ${muted ? "text-slate-400" : isToday ? "text-sky-600" : "text-slate-700"}`}>
                    {day.getDate()}
                  </span>
                  {isToday && (
                    <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                      Today
                    </span>
                  )}
                </div>
                
                <div className="flex flex-col gap-1.5 min-h-0 overflow-hidden">
                  {bucket.allDay.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {bucket.allDay.slice(0, 2).map((event) => renderAllDayEvent(event, muted, key))}
                      {bucket.allDay.length > 2 && (
                        <span className="text-[10px] font-medium text-slate-400 px-1">
                          +{bucket.allDay.length - 2} more
                        </span>
                      )}
                    </div>
                  )}
                  
                  <div className="flex flex-col gap-1 flex-1 min-h-0">
                    {bucket.timed.length > 0 ? (
                      <>
                        {bucket.timed.slice(0, 3).map((event) => renderTimedListEvent(event, muted, key))}
                        {bucket.timed.length > 3 && (
                          <span className="text-[10px] font-medium text-slate-400 px-1">
                            +{bucket.timed.length - 3} more
                          </span>
                        )}
                      </>
                    ) : bucket.allDay.length === 0 ? (
                      <span className="text-[10px] text-slate-300 px-1">No events</span>
                    ) : null}
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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
      <div className="grid grid-cols-[80px,repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <div className="px-3 py-3" />
        {visibleDays.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={`head-${day.toISOString()}`}
              className={`px-3 py-3 text-center ${isToday ? "bg-sky-50 text-sky-600" : ""}`}
            >
              <div className="text-[10px]">{WEEKDAY_LABELS[day.getDay()]}</div>
              <div className={`text-lg font-bold ${isToday ? "text-sky-600" : "text-slate-800"}`}>{day.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[80px,repeat(7,minmax(0,1fr))] border-b border-slate-200 bg-slate-50/50">
        <div className="px-3 py-2 text-xs font-semibold text-slate-500">All day</div>
        {visibleDays.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const bucket = eventsByDay.get(key) ?? { allDay: [], timed: [] };
          const isToday = isSameDay(day, today);
          return (
            <div
              key={`all-${key}`}
              className={`flex min-h-[60px] flex-col gap-1 overflow-hidden px-2 py-2 ${
                isToday ? "bg-sky-50/50" : ""
              }`}
            >
              {bucket.allDay.length > 0 ? (
                bucket.allDay.map((event) => renderAllDayEvent(event, false, key))
              ) : (
                <span className="text-[10px] text-slate-300">Free</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-[80px,repeat(7,minmax(0,1fr))]">
        <div className="relative h-[720px] border-r border-slate-200 bg-slate-50/30">
          {HOURS.map((hour) => (
            <div
              key={`label-${hour}`}
              style={{ top: `${(hour / 24) * 100}%` }}
              className="absolute left-0 right-0 -mt-2.5 flex items-center justify-end pr-2 text-[10px] font-semibold text-slate-400"
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
            <div key={key} className={`relative h-[720px] border-l border-slate-200 overflow-hidden ${isToday ? "bg-sky-50/30" : "bg-white"}`}>
              {HOURS.map((hour) => (
                <div
                  key={`grid-${key}-${hour}`}
                  style={{ top: `${(hour / 24) * 100}%` }}
                  className="absolute left-0 right-0 -mt-px border-t border-dashed border-slate-200"
                />
              ))}
              {bucket.timed.length === 0 && (
                <span className="absolute left-2 top-2 text-[11px] text-slate-300">No events</span>
              )}
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
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-sky-50 to-white px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Single Day View</p>
            <h2 className="text-2xl font-bold text-slate-900">
              {currentDate.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </h2>
          </div>
          {isSameDay(currentDate, today) && (
            <span className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm">
              Today
            </span>
          )}
        </div>
        <div className="border-b border-slate-200 bg-slate-50/50 px-6 py-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">All-day Events</h3>
          <div className="flex flex-wrap gap-2">
            {bucket.allDay.length > 0 ? (
              bucket.allDay.map((event) => renderAllDayEvent(event, false, key))
            ) : (
              <span className="text-xs text-slate-400">No all-day events</span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-[80px,1fr]">
          <div className="relative h-[720px] border-r border-slate-200 bg-slate-50/30">
            {HOURS.map((hour) => (
              <div
                key={`day-label-${hour}`}
                style={{ top: `${(hour / 24) * 100}%` }}
                className="absolute left-0 right-0 -mt-2.5 flex justify-end pr-2 text-[10px] font-semibold text-slate-400"
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>
          <div className="relative h-[720px] overflow-hidden">
            {HOURS.map((hour) => (
              <div
                key={`day-grid-${hour}`}
                style={{ top: `${(hour / 24) * 100}%` }}
                className="absolute left-0 right-0 -mt-px border-t border-dashed border-slate-200"
              />
            ))}
            {bucket.timed.length === 0 && (
              <span className="absolute left-3 top-3 text-sm text-slate-300">No scheduled events</span>
            )}
            {bucket.timed.map((event) => renderTimedBlock(event, currentDate, key))}
          </div>
        </div>
      </div>
    );
  })();

  const createModal = createModalOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={handleCloseCreateModal}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={handleCreateSubmit} className="space-y-6 px-6 py-7">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Create event</p>
              <h2 className="text-2xl font-bold text-slate-900">New calendar event</h2>
              <p className="text-sm text-slate-600">
                Add an event to Google Calendar. Link a project if you want the event to appear on the Kazador timeline.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCloseCreateModal}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
              aria-label="Close new event form"
            >
              ✕
            </button>
          </div>

          {createError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {createError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Event name
              <input
                type="text"
                value={createForm.summary}
                onChange={(event) => handleCreateInputChange("summary", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                placeholder="Planning session"
                required
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Date
              <input
                type="date"
                value={createForm.date}
                onChange={(event) => handleCreateInputChange("date", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                required
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Start time
              <input
                type="time"
                value={createForm.startTime}
                onChange={(event) => handleCreateInputChange("startTime", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
              <span className="block text-xs font-normal text-slate-500">Leave blank for an all-day event.</span>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              End time
              <input
                type="time"
                value={createForm.endTime}
                onChange={(event) => handleCreateInputChange("endTime", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Project (optional)
              <select
                value={createForm.projectId}
                onChange={(event) => {
                  handleProjectChange(event.target.value);
                  setProjectCalendarsError(null);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="">Don’t link to a project</option>
                {projects.map((item) => (
                  <option key={item.project.id} value={item.project.id}>
                    {item.project.name}
                  </option>
                ))}
              </select>
              <span className="block text-xs font-normal text-slate-500">
                Linking to a project keeps the timeline in sync, but it’s not required.
              </span>
              {projectsLoading && <span className="text-xs text-slate-500">Loading projects…</span>}
              {projectsError && <span className="text-xs text-rose-600">{projectsError}</span>}
              {!projectsLoading && projects.length === 0 && !projectsError && (
                <span className="text-xs text-slate-500">No projects available yet.</span>
              )}
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Location
              <input
                type="text"
                value={createForm.location}
                onChange={(event) => handleCreateInputChange("location", event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                placeholder="Studio A, LA"
              />
            </label>
          </div>

          {shouldUsePersonalCalendars && (
            <div className="space-y-2">
              {createForm.projectId && !projectHasCalendars && (
                <p className="text-xs text-slate-500">
                  This project doesn’t have its own Google Calendar yet. We’ll use your connected calendar below.
                </p>
              )}
              <label className="space-y-1 text-sm font-medium text-slate-700">
                Calendar
                {sources.length > 0 ? (
                  <select
                    value={createForm.userSourceId}
                    onChange={(event) => handleCreateInputChange("userSourceId", event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                  >
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.summary ?? source.calendarId ?? "Calendar"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-amber-600">
                    No personal calendars are connected yet. Connect Google Calendar from Settings → Integrations.
                  </p>
                )}
              </label>
            </div>
          )}

          {isProjectSelected && projectHasCalendars && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Project calendar</label>
              {projectCalendarsLoading ? (
                <p className="text-xs text-slate-500">Loading calendars…</p>
              ) : (
                <select
                  value={createForm.projectSourceId}
                  onChange={(event) => handleCreateInputChange("projectSourceId", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                  required
                >
                  {selectedProjectCalendars.map((source) => {
                    const metadata = (source.metadata as Record<string, unknown> | null) ?? null;
                    const summary =
                      metadata && typeof (metadata as any).calendarSummary === "string"
                        ? ((metadata as any).calendarSummary as string)
                        : null;
                    const label = source.title ?? summary ?? "Calendar";
                    return (
                      <option key={source.id} value={source.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              )}
              {projectCalendarsError && <span className="text-xs text-rose-600">{projectCalendarsError}</span>}
            </div>
          )}

          <label className="space-y-1 text-sm font-medium text-slate-700">
            Description
            <textarea
              value={createForm.description}
              onChange={(event) => handleCreateInputChange("description", event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              placeholder="Outline the purpose, participants, or important notes"
            />
          </label>

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={handleCloseCreateModal}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createButtonDisabled}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
            >
              {createSubmitting ? "Creating…" : "Create event"}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  const eventModal = selectedEvent ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={() => setSelectedEvent(null)}
    >
      <div
        className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setSelectedEvent(null)}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
          aria-label="Close event details"
        >
          ✕
        </button>
        <div className="space-y-5 px-6 py-7">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">Event Details</p>
            <h3 className="pr-8 text-2xl font-bold text-slate-900">
              {selectedEvent.summary ?? "Untitled event"}
            </h3>
            {selectedEventRangeLabel && (
              <p className="text-sm text-slate-600">{selectedEventRangeLabel}</p>
            )}
            {selectedEvent?.isAllDay && (
              <p className="text-sm font-semibold text-sky-600">All day</p>
            )}
          </div>
          <div className="space-y-3 text-sm text-slate-600">
            {selectedEventCalendarName && (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 min-w-[70px] text-xs font-semibold uppercase tracking-wide text-slate-400">Calendar</span>
                <span className="font-medium text-slate-700">{selectedEventCalendarName}</span>
              </div>
            )}
            {selectedEvent.location && (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 min-w-[70px] text-xs font-semibold uppercase tracking-wide text-slate-400">Location</span>
                <span className="font-medium text-slate-700">{selectedEvent.location}</span>
              </div>
            )}
            {selectedEventStatus && (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 min-w-[70px] text-xs font-semibold uppercase tracking-wide text-slate-400">Status</span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                  {selectedEventStatus}
                </span>
              </div>
            )}
            {selectedEventDescription && (
              <div className="flex items-start gap-3">
                <span className="mt-0.5 min-w-[70px] text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</span>
                <p className="flex-1 whitespace-pre-wrap text-sm text-slate-600">{selectedEventDescription}</p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {selectedEventLink && (
              <a
                href={selectedEventLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700"
              >
                Open in Google Calendar ↗
              </a>
            )}
            <button
              type="button"
              onClick={() => setSelectedEvent(null)}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
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
      <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-8 sm:px-6 lg:px-8">
        <header className="mb-8 space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-sky-600">Synced Schedules</p>
          <h1 className="text-4xl font-bold text-slate-900">Calendar</h1>
          <p className="max-w-3xl text-base text-slate-600 leading-relaxed">
            View and manage events from your connected calendars. Switch between day, week, and month views to find what you need.
          </p>
        </header>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              View
              <select
                value={viewMode}
                onChange={(event) => setViewMode(event.target.value as CalendarViewMode)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              >
                {VIEW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              Calendar
              <select
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
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
            <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
              <span>{rangeLabel}</span>
              <span className="text-slate-400">•</span>
              <span>
                {visibleEventCount} of {totalCount}
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1">
              <button
                type="button"
                onClick={handlePrev}
                className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                aria-label="Previous"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 whitespace-nowrap"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                aria-label="Next"
              >
                ▶
              </button>
            </div>
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700"
            >
              New event
            </button>
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={syncing || !accessToken}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
            >
              {syncing ? "Syncing…" : "Sync calendars"}
            </button>
          </div>
        </div>

        {syncMessage && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-medium text-emerald-800">
            {syncMessage}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-medium text-rose-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
            Loading events…
          </div>
        ) : visibleEventCount === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 shadow-sm">
            No events found for the selected view and filters.
          </div>
        ) : viewMode === "day" ? (
          dayView
        ) : viewMode === "week" ? (
          weekView
        ) : (
          monthView
        )}
      </div>
      {createModal}
      {eventModal}
    </>
  );
}
