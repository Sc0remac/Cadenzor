"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import type {
  ProjectRecord,
  TimelineItemRecord,
  TimelineLaneDefinition,
  ProjectTaskRecord,
} from "@kazador/shared";
import { fetchTimelineExplorer, fetchProjects, type TimelineExplorerResponse } from "@/lib/supabaseClient";
import Link from "next/link";

const VIEW_MODES = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
] as const;

const DEFAULT_VIEW: (typeof VIEW_MODES)[number]["value"] = "week";

interface CalendarItem {
  id: string;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  lane: string | null;
  projectName: string;
  status: string;
  meetingUrl: string | null;
  location: string | null;
  type: string;
  links: TimelineItemRecord["links"];
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function beginOfWeek(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setDate(diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfWeek(date: Date): Date {
  const start = beginOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function beginOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function buildRange(viewMode: string, anchor: Date): { start: Date; end: Date } {
  if (viewMode === "day") {
    const start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    const end = new Date(anchor);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (viewMode === "month") {
    return { start: beginOfMonth(anchor), end: endOfMonth(anchor) };
  }
  return { start: beginOfWeek(anchor), end: endOfWeek(anchor) };
}

function formatRangeLabel(viewMode: string, date: Date): string {
  if (viewMode === "day") {
    return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  }
  if (viewMode === "month") {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  const start = beginOfWeek(date);
  const end = endOfWeek(date);
  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

function projectNameLookup(projects: ProjectRecord[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const project of projects) {
    lookup.set(project.id, project.name);
  }
  return lookup;
}

function extractMeetingUrl(item: TimelineItemRecord): string | null {
  const links = (item.links ?? {}) as Record<string, any>;
  const labels = (item.labels ?? {}) as Record<string, any>;
  const url = links.meetingUrl ?? labels.meetingUrl;
  return typeof url === "string" ? url : null;
}

function extractLocation(item: TimelineItemRecord): string | null {
  const labels = (item.labels ?? {}) as Record<string, any>;
  if (labels.city && labels.territory) {
    return `${labels.city}, ${labels.territory}`;
  }
  if (labels.city) {
    return labels.city as string;
  }
  return null;
}

function useProjects(accessToken: string | null) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      setLoading(false);
      setError("Sign in to view calendar");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchProjects({ accessToken })
      .then((list) => {
        if (cancelled) return;
        setProjects(list.map((entry) => entry.project));
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load projects");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);
  return { projects, loading, error };
}

function buildCalendarItems(
  data: TimelineExplorerResponse,
  projectNames: Map<string, string>
): CalendarItem[] {
  const output: CalendarItem[] = [];
  const addItems = (items: TimelineItemRecord[], projectName: string) => {
    for (const item of items) {
      const startsAt = parseDate(item.startsAt);
      const endsAt = parseDate(item.endsAt ?? item.dueAt);
      const meetingUrl = extractMeetingUrl(item);
      const location = extractLocation(item);
      output.push({
        id: item.id,
        title: item.title,
        startsAt,
        endsAt,
        lane: item.labels?.lane ? String(item.labels.lane) : null,
        projectName,
        status: item.status,
        meetingUrl,
        location,
        type: item.type,
        links: item.links,
      });
    }
  };

  if (data.project) {
    addItems(data.items, projectNames.get(data.project.id) ?? data.project.name);
  } else {
    addItems(data.items, "Unassigned");
  }
  // Convert tasks into event-like entries if needed.
  const taskItems = data.tasks?.map((task) => (
    {
      id: `task:${task.id}`,
      title: task.title,
      startsAt: null,
      endsAt: parseDate(task.dueAt),
      lane: task.laneSlug,
      projectName: projectNames.get(task.projectId) ?? data.project?.name ?? "Unknown project",
      status: task.status,
      meetingUrl: null,
      location: null,
      type: "TASK",
      links: { taskId: task.id },
    } satisfies CalendarItem
  )) ?? [];
  return [...output, ...taskItems];
}

function groupByDay(items: CalendarItem[]): Record<string, CalendarItem[]> {
  const lookup: Record<string, CalendarItem[]> = {};
  for (const item of items) {
    const date = item.startsAt ?? item.endsAt;
    if (!date) continue;
    const key = date.toISOString().slice(0, 10);
    lookup[key] = lookup[key] ?? [];
    lookup[key].push(item);
  }
  return lookup;
}

function isCalendarItem(item: CalendarItem): boolean {
  return Boolean((item.links as Record<string, any>)?.calendarId);
}

function CalendarGrid({
  items,
  viewMode,
  start,
  end,
}: {
  items: CalendarItem[];
  viewMode: string;
  start: Date;
  end: Date;
}) {
  if (viewMode === "day" || viewMode === "week") {
    return <CalendarWeekGrid items={items} start={start} end={end} viewMode={viewMode} />;
  }
  return <CalendarMonthGrid items={items} start={start} end={end} />;
}

function CalendarWeekGrid({
  items,
  start,
  end,
  viewMode,
}: {
  items: CalendarItem[];
  start: Date;
  end: Date;
  viewMode: string;
}) {
  const days: Date[] = [];
  const current = new Date(start);
  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  const grouped = groupByDay(items);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="grid grid-cols-1 gap-px border-b border-gray-200 bg-gray-200 sm:grid-cols-7">
        {days.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const dayItems = (grouped[key] ?? []).sort((a, b) => {
            const aStart = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
            const bStart = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
            return aStart - bStart;
          });
          return (
            <div key={key} className="flex h-full flex-col bg-white p-3">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span>{day.getDate()}</span>
              </div>
              <div className="mt-2 space-y-2">
                {dayItems.length === 0 ? (
                  <p className="text-xs text-gray-400">No events</p>
                ) : (
                  dayItems.map((item) => (
                    <CalendarEventCard key={item.id} item={item} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarMonthGrid({ items, start, end }: { items: CalendarItem[]; start: Date; end: Date }) {
  const days: Date[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  const grouped = groupByDay(items);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="grid gap-px border-b border-gray-200 bg-gray-200 sm:grid-cols-7">
        {days.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const dayItems = (grouped[key] ?? []).slice(0, 4);
          return (
            <div key={key} className="min-h-[7rem] bg-white p-2">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span>{day.getDate()}</span>
              </div>
              <div className="mt-2 space-y-1">
                {dayItems.length === 0 ? (
                  <p className="text-[0.7rem] text-gray-400">No events</p>
                ) : (
                  dayItems.map((item) => (
                    <CalendarEventCard key={item.id} item={item} compact />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarEventCard({ item, compact = false }: { item: CalendarItem; compact?: boolean }) {
  const isCalendar = isCalendarItem(item);
  const label = item.startsAt
    ? item.endsAt
      ? `${item.startsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${item.endsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : item.startsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : item.endsAt
    ? `Due ${item.endsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Time TBC";
  return (
    <div className={`rounded border ${isCalendar ? "border-sky-300 bg-sky-50" : "border-gray-200 bg-gray-50"} px-2 py-1 text-xs text-gray-700`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-gray-900">{item.title}</span>
        {isCalendar ? <span className="rounded bg-sky-200 px-1.5 py-0.5 text-[0.65rem] text-sky-800">Calendar</span> : null}
      </div>
      <p className="text-[0.7rem] text-gray-500">{item.projectName}</p>
      <p className="text-[0.7rem] text-gray-500">{label}</p>
      {item.location ? <p className="text-[0.7rem] text-gray-500">📍 {item.location}</p> : null}
      {item.meetingUrl ? (
        <a
          href={item.meetingUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[0.7rem] font-semibold text-sky-600 hover:text-sky-500"
        >
          Join
          <span aria-hidden>↗</span>
        </a>
      ) : null}
      {!compact ? (
        <div className="mt-1 flex gap-2 text-[0.65rem] text-gray-400">
          <span>{item.type.replace(/_/g, " ")}</span>
          {item.lane ? <span>{item.lane}</span> : null}
          <span>{item.status}</span>
        </div>
      ) : null}
    </div>
  );
}

export default function CalendarPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const router = useRouter();
  const params = useSearchParams();

  const [viewMode, setViewMode] = useState<(typeof VIEW_MODES)[number]["value"]>(
    (params?.get("view") as (typeof VIEW_MODES)[number]["value"]) ?? DEFAULT_VIEW
  );
  const [anchorDate, setAnchorDate] = useState(() => {
    const fromUrl = params?.get("date");
    if (fromUrl) {
      const parsed = new Date(fromUrl);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return new Date();
  });
  const [projectId, setProjectId] = useState<string | null>(() => params?.get("projectId") ?? null);
  const [laneFilter, setLaneFilter] = useState<string | null>(() => params?.get("lane") ?? null);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [lanes, setLanes] = useState<TimelineLaneDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasUserAdjustedRef = useRef(false);

  const { projects, loading: projectLoading, error: projectError } = useProjects(accessToken);

  const activeProjectId = projectId && projectId !== "all" ? projectId : null;

  useEffect(() => {
    if (!accessToken || !activeProjectId) {
      setItems([]);
      setLanes([]);
      setLoading(false);
      if (!accessToken) {
        setError("Sign in to view calendar");
      }
      return;
    }

    const { start, end } = buildRange(viewMode, anchorDate);

    setLoading(true);
    setError(null);

    fetchTimelineExplorer({
      accessToken,
      projectId: activeProjectId,
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
    })
      .then((response) => {
        const projectLookup = projectNameLookup(projects.map((entry) => entry));
        setItems(buildCalendarItems(response, projectLookup));
        setLanes(response.lanes ?? []);
      })
      .catch((err: any) => {
        setError(err?.message || "Failed to load timeline events");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [accessToken, activeProjectId, viewMode, anchorDate, projects]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", viewMode);
    url.searchParams.set("date", anchorDate.toISOString().slice(0, 10));
    if (projectId) {
      url.searchParams.set("projectId", projectId);
    } else {
      url.searchParams.delete("projectId");
    }
    if (laneFilter) {
      url.searchParams.set("lane", laneFilter);
    } else {
      url.searchParams.delete("lane");
    }
    router.replace(url.pathname + "?" + url.searchParams.toString());
  }, [viewMode, anchorDate, projectId, laneFilter, router]);

  const { start, end } = useMemo(() => buildRange(viewMode, anchorDate), [viewMode, anchorDate]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (laneFilter && item.lane !== laneFilter) {
        return false;
      }
      const withinRange = (() => {
        const startMs = start.getTime();
        const endMs = end.getTime();
        const itemStart = item.startsAt?.getTime();
        const itemEnd = item.endsAt?.getTime();
        if (itemStart == null && itemEnd == null) {
          return true;
        }
        const checkStart = itemStart ?? itemEnd ?? startMs;
        const checkEnd = itemEnd ?? itemStart ?? startMs;
        return checkEnd >= startMs && checkStart <= endMs;
      })();
      return withinRange;
    });
  }, [items, start, end, laneFilter]);

  const laneOptions = useMemo(() => {
    const options = lanes.map((lane) => ({ id: lane.slug, name: lane.name }));
    const dynamic = new Set<string>();
    for (const item of items) {
      const lane = item.lane ?? "";
      if (lane && !options.some((entry) => entry.id === lane) && !dynamic.has(lane)) {
        options.push({ id: lane, name: lane });
        dynamic.add(lane);
      }
    }
    return [{ id: "", name: "All lanes" }, ...options];
  }, [lanes, items]);

  const projectOptions = useMemo(() => {
    const base = projects.map((project) => ({ id: project.id, name: project.name }));
    return [{ id: "all", name: "All projects" }, ...base];
  }, [projects]);

  const earliestItemDate = useMemo(() => {
    let min: number | null = null;
    for (const item of items) {
      const times = [item.startsAt?.getTime(), item.endsAt?.getTime()];
      for (const value of times) {
        if (value != null && !Number.isNaN(value)) {
          if (min == null || value < min) {
            min = value;
          }
        }
      }
    }
    return min != null ? new Date(min) : null;
  }, [items]);

  useEffect(() => {
    hasUserAdjustedRef.current = false;
  }, [activeProjectId]);

  useEffect(() => {
    if (!earliestItemDate || items.length === 0) return;
    if (hasUserAdjustedRef.current) return;
    const { start: rangeStart, end: rangeEnd } = buildRange(viewMode, anchorDate);
    const earliestMs = earliestItemDate.getTime();
    if (earliestMs < rangeStart.getTime() || earliestMs > rangeEnd.getTime()) {
      setAnchorDate(new Date(earliestItemDate));
    }
  }, [earliestItemDate, items.length, viewMode, anchorDate]);

  const handleDateShift = (direction: number) => {
    hasUserAdjustedRef.current = true;
    const next = new Date(anchorDate);
    if (viewMode === "day") {
      next.setDate(next.getDate() + direction);
    } else if (viewMode === "week") {
      next.setDate(next.getDate() + direction * 7);
    } else {
      next.setMonth(next.getMonth() + direction);
    }
    setAnchorDate(next);
  };

  const handleSetToday = () => {
    hasUserAdjustedRef.current = true;
    setAnchorDate(new Date());
  };

  if (!accessToken) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-semibold text-gray-900">Calendar</h1>
          <p className="mt-2 text-sm text-gray-600">Sign in to view your project calendars.</p>
        </header>
        <p className="rounded border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
          Authentication required.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Calendar</h1>
          <p className="mt-1 text-sm text-gray-600">
            View upcoming meetings, promo holds, and travel windows pulled from connected Google calendars and project timelines.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSetToday}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            Today
          </button>
          <div className="inline-flex rounded-md border border-gray-300">
            <button
              type="button"
              onClick={() => handleDateShift(-1)}
              className="border-r border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => handleDateShift(1)}
              className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              ▶
            </button>
          </div>
          <select
            value={viewMode}
            onChange={(event) => setViewMode(event.target.value as typeof viewMode)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {VIEW_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Project
          <select
            value={projectId ?? "all"}
            onChange={(event) => setProjectId(event.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            {projectOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Lane
          <select
            value={laneFilter ?? ""}
            onChange={(event) => setLaneFilter(event.target.value || null)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            {laneOptions.map((lane) => (
              <option key={lane.id} value={lane.id}>
                {lane.name}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm text-gray-500">
          Showing {filteredItems.length} events between {start.toLocaleDateString()} and {end.toLocaleDateString()}
        </div>
        <Link
          href="/settings/lanes"
          className="text-xs font-semibold text-gray-600 underline hover:text-gray-900"
        >
          Manage lanes
        </Link>
      </div>

      {projectError ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{projectError}</div>
      ) : null}
      {error ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {loading ? (
        <p className="rounded border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 shadow-sm">Loading calendar…</p>
      ) : filteredItems.length === 0 ? (
        <p className="rounded border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 shadow-sm">
          No items fall within the selected range. Pull calendar events or adjust filters.
        </p>
      ) : null}

      {!loading ? (
        <CalendarGrid items={filteredItems} viewMode={viewMode} start={start} end={end} />
      ) : null}
    </section>
  );
}
