"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchCalendarEvents,
  fetchCalendarSources,
  fetchProjects,
  pullCalendarEvents,
  assignCalendarEvent,
  setCalendarEventIgnored,
  type CalendarEventsResponse,
} from "@/lib/supabaseClient";
import type { CalendarEventRecord, ProjectRecord } from "@kazador/shared";
import type { CalendarSourceSummary } from "@/lib/supabaseClient";

interface FilterState {
  assigned: "all" | "assigned" | "unassigned";
  sourceId: string;
  includeIgnored: boolean;
}

interface EventActionState {
  loadingIds: Set<string>;
  errorMessage: string | null;
  successMessage: string | null;
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
    assigned: "all",
    sourceId: "all",
    includeIgnored: false,
  });
  const [events, setEvents] = useState<CalendarEventRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [sources, setSources] = useState<CalendarSourceSummary[]>([]);
  const [actionState, setActionState] = useState<EventActionState>({
    loadingIds: new Set<string>(),
    errorMessage: null,
    successMessage: null,
  });
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    fetchProjects({ accessToken })
      .then((payload) => {
        if (cancelled) return;
        setProjects(payload.map((entry) => entry.project));
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.error("Failed to load projects", err);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

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
        assigned: filters.assigned,
        sourceId: filters.sourceId !== "all" ? filters.sourceId : undefined,
        includeIgnored: filters.includeIgnored,
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
  }, [accessToken, filters.assigned, filters.sourceId, filters.includeIgnored]);

  useEffect(() => {
    void reloadEvents();
  }, [reloadEvents]);

  const calendarSourceOptions = useMemo(() => {
    return sources.map(({ source, project }) => {
      const metadata = (source.metadata ?? {}) as Record<string, unknown>;
      const summary = (metadata.calendarSummary as string | undefined) ?? source.title ?? source.externalId;
      return {
        id: source.id,
        name: summary ?? "Calendar",
        projectId: project?.id ?? source.projectId ?? null,
      };
    });
  }, [sources]);

  const setFilterValue = (key: keyof FilterState, value: string | boolean) => {
    setFilters((prev) => ({ ...prev, [key]: value } as FilterState));
  };

  const updateEventActionState = (updater: (prev: EventActionState) => EventActionState) => {
    setActionState((prev) => updater(prev));
  };

  const handleAssign = async (event: CalendarEventRecord, projectId: string | null) => {
    if (!accessToken) return;
    updateEventActionState((prev) => {
      const next = new Set(prev.loadingIds);
      next.add(event.id);
      return { ...prev, loadingIds: next, errorMessage: null, successMessage: null };
    });

    try {
      const updated = await assignCalendarEvent(event.id, projectId, accessToken);
      setEvents((prev) => prev.map((item) => (item.id === event.id ? updated : item)));
      updateEventActionState((prev) => ({
        ...prev,
        loadingIds: new Set(Array.from(prev.loadingIds).filter((id) => id !== event.id)),
        successMessage: projectId ? "Event assigned to project" : "Event set to unassigned",
      }));
    } catch (err: any) {
      updateEventActionState((prev) => ({
        ...prev,
        loadingIds: new Set(Array.from(prev.loadingIds).filter((id) => id !== event.id)),
        errorMessage: err?.message || "Failed to update event",
      }));
    }
  };

  const handleIgnore = async (event: CalendarEventRecord, ignore: boolean) => {
    if (!accessToken) return;
    updateEventActionState((prev) => {
      const next = new Set(prev.loadingIds);
      next.add(event.id);
      return { ...prev, loadingIds: next, errorMessage: null, successMessage: null };
    });

    try {
      await setCalendarEventIgnored(event.id, ignore, accessToken);
      setEvents((prev) =>
        prev.map((item) => (item.id === event.id ? { ...item, ignore } : item))
      );
      updateEventActionState((prev) => ({
        ...prev,
        loadingIds: new Set(Array.from(prev.loadingIds).filter((id) => id !== event.id)),
        successMessage: ignore ? "Event ignored" : "Event unignored",
      }));
    } catch (err: any) {
      updateEventActionState((prev) => ({
        ...prev,
        loadingIds: new Set(Array.from(prev.loadingIds).filter((id) => id !== event.id)),
        errorMessage: err?.message || "Failed to update event",
      }));
    }
  };

  const handleSyncAll = async () => {
    if (!accessToken) return;
    if (sources.length === 0) {
      updateEventActionState((prev) => ({
        ...prev,
        errorMessage: "No calendars are connected yet.",
      }));
      return;
    }

    setSyncing(true);
    updateEventActionState((prev) => ({ ...prev, errorMessage: null, successMessage: null }));

    try {
      for (const entry of sources) {
        const projectId = entry.project?.id ?? entry.source.projectId;
        if (!projectId) continue;
        await pullCalendarEvents(projectId, entry.source.id, {}, accessToken);
      }
      await reloadEvents();
      updateEventActionState((prev) => ({
        ...prev,
        successMessage: "Calendars synced",
      }));
    } catch (err: any) {
      updateEventActionState((prev) => ({
        ...prev,
        errorMessage: err?.message || "Failed to sync calendars",
      }));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-gray-900">Calendar inbox</h1>
        <p className="mt-1 text-sm text-gray-600">
          Review every Google Calendar event we've imported. Tag them to projects so they appear on timelines, or keep them unassigned.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Status
          <select
            value={filters.assigned}
            onChange={(event) => setFilterValue("assigned", event.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="all">All events</option>
            <option value="assigned">Assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>

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

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={filters.includeIgnored}
            onChange={(event) => setFilterValue("includeIgnored", event.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Show ignored
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

      {actionState.errorMessage ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {actionState.errorMessage}
        </div>
      ) : null}
      {actionState.successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {actionState.successMessage}
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
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-sm text-gray-700">
              {events.map((event) => {
                const sourceName = event.source
                  ? ((event.source.metadata as Record<string, unknown> | null)?.calendarSummary as string | undefined) ??
                    event.source.title ??
                    event.source.externalId
                  : "Calendar";
                const projectId = event.assignedProjectId ?? "";
                const loadingEvent = actionState.loadingIds.has(event.id);
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
                      {event.source?.projectId ? (
                        <div className="text-xs text-gray-500">Default project: {projects.find((p) => p.id === event.source?.projectId)?.name ?? event.source?.projectId}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <select
                        value={projectId}
                        onChange={(evt) => handleAssign(event, evt.target.value === "" ? null : evt.target.value)}
                        disabled={loadingEvent}
                        className="mt-1 w-56 rounded-md border border-gray-300 px-3 py-1 text-sm disabled:bg-gray-100"
                      >
                        <option value="">Unassigned</option>
                        {projectOptions.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => handleIgnore(event, !event.ignore)}
                          disabled={loadingEvent}
                          className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-100"
                        >
                          {event.ignore ? "Stop ignoring" : "Ignore"}
                        </button>
                      </div>
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
