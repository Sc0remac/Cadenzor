"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import type {
  ProjectRecord,
  TimelineDependencyRecord,
  TimelineItemRecord,
  TimelineItemStatus,
  TimelineLane,
} from "@cadenzor/shared";
import { detectTimelineConflicts } from "@cadenzor/shared";
import { useAuth } from "../../../components/AuthProvider";
import { TimelineStudio } from "../../../components/projects/TimelineStudio";
import { fetchProjects, fetchTimelineExplorer, type ProjectListItem } from "../../../lib/supabaseClient";

type TimelineViewMode = "day" | "week" | "month";
type PriorityBand = "HIGH" | "MEDIUM" | "LOW";

type DrawerMode = "view" | "create" | null;

const VIEW_OPTIONS: Array<{ value: TimelineViewMode; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const LANE_OPTIONS: Array<{ id: TimelineLane; label: string }> = [
  { id: "LIVE_HOLDS", label: "Live / Holds" },
  { id: "TRAVEL", label: "Travel" },
  { id: "PROMO", label: "Promo" },
  { id: "RELEASE", label: "Release" },
  { id: "LEGAL", label: "Legal" },
  { id: "FINANCE", label: "Finance" },
];

const STATUS_OPTIONS: Array<{ id: TimelineItemStatus; label: string }> = [
  { id: "planned", label: "Planned" },
  { id: "tentative", label: "Tentative" },
  { id: "confirmed", label: "Confirmed" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Completed" },
  { id: "canceled", label: "Canceled" },
];

const PRIORITY_OPTIONS: Array<{ id: PriorityBand; label: string }> = [
  { id: "HIGH", label: "High" },
  { id: "MEDIUM", label: "Medium" },
  { id: "LOW", label: "Low" },
];

const PRIORITY_THRESHOLDS: Record<PriorityBand, number> = {
  HIGH: 70,
  MEDIUM: 40,
  LOW: 0,
};

const LANE_TO_TYPE: Record<TimelineLane, TimelineItemRecord["type"]> = {
  LIVE_HOLDS: "LIVE_HOLD",
  TRAVEL: "TRAVEL_SEGMENT",
  PROMO: "PROMO_SLOT",
  RELEASE: "RELEASE_MILESTONE",
  LEGAL: "LEGAL_ACTION",
  FINANCE: "FINANCE_ACTION",
};

const REFRESH_INTERVAL_MS = 30_000;
function computeViewRange(view: TimelineViewMode, anchor: Date): { start: Date; end: Date } {
  const base = new Date(anchor);
  base.setHours(0, 0, 0, 0);
  switch (view) {
    case "day": {
      const start = new Date(base);
      const end = new Date(base);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case "week": {
      const start = new Date(base);
      const day = start.getDay();
      const diff = (day + 6) % 7; // start on Monday
      start.setDate(start.getDate() - diff);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case "month":
    default: {
      const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
  }
}

function formatDateInput(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}

function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const candidate = new Date(value);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function formatDateTimeLocal(date: Date): string {
  const pad = (input: number) => String(input).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateTimeLocal(value: string): Date | null {
  if (!value) return null;
  const candidate = new Date(value);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function getPriorityBand(score: number | null): PriorityBand {
  if (score == null) return "LOW";
  if (score >= PRIORITY_THRESHOLDS.HIGH) return "HIGH";
  if (score >= PRIORITY_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}

function matchesSearch(item: TimelineItemRecord, term: string): boolean {
  if (!term.trim()) return true;
  const lower = term.trim().toLowerCase();
  const fields: Array<string | null | undefined> = [
    item.title,
    item.description,
    item.labels?.city,
    item.labels?.venue,
    item.labels?.artist,
    item.labels?.territory,
    (item.labels as Record<string, unknown>)?.contact as string | undefined,
  ];
  return fields.some((value) => typeof value === "string" && value.toLowerCase().includes(lower));
}

function isOverdue(item: TimelineItemRecord, now = Date.now()): boolean {
  const due = item.dueAt ? Date.parse(item.dueAt) : Number.NaN;
  if (Number.isNaN(due)) return false;
  if (item.status === "done" || item.status === "canceled") return false;
  return due < now;
}

function summarizeTimeline(items: TimelineItemRecord[]) {
  const total = items.length;
  let completed = 0;
  let tentative = 0;
  let overdue = 0;
  for (const item of items) {
    if (item.status === "done") completed += 1;
    if (item.status === "tentative") tentative += 1;
    if (isOverdue(item)) overdue += 1;
  }
  const conflicts = detectTimelineConflicts(items, { bufferHours: 4 });
  return {
    total,
    completed,
    tentative,
    overdue,
    conflicts: conflicts.length,
  };
}
export default function TimelinePage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectProfile, setProjectProfile] = useState<ProjectRecord | null>(null);
  const [timelineItems, setTimelineItems] = useState<TimelineItemRecord[]>([]);
  const [dependencies, setDependencies] = useState<TimelineDependencyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<TimelineViewMode>("week");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const defaultRange = useMemo(() => computeViewRange("week", new Date()), []);
  const [startDate, setStartDate] = useState<Date>(defaultRange.start);
  const [endDate, setEndDate] = useState<Date>(defaultRange.end);

  const [laneFilters, setLaneFilters] = useState<Set<TimelineLane>>(
    () => new Set(LANE_OPTIONS.map((option) => option.id))
  );
  const [collapsedLanes, setCollapsedLanes] = useState<Set<TimelineLane>>(new Set());
  const [statusFilters, setStatusFilters] = useState<Set<TimelineItemStatus>>(new Set());
  const [priorityFilters, setPriorityFilters] = useState<Set<PriorityBand>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [zoom, setZoom] = useState(1);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [selectedItem, setSelectedItem] = useState<TimelineItemRecord | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftLane, setDraftLane] = useState<TimelineLane>("PROMO");
  const [draftPriority, setDraftPriority] = useState<PriorityBand>("MEDIUM");
  const [draftStart, setDraftStart] = useState<string>(() => formatDateTimeLocal(new Date()));
  const [draftEnd, setDraftEnd] = useState<string>(() => formatDateTimeLocal(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [draftCity, setDraftCity] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const range = computeViewRange(viewMode, anchorDate);
    setStartDate(range.start);
    setEndDate(range.end);
  }, [viewMode, anchorDate]);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    fetchProjects({ accessToken, status: "active" })
      .then((results) => {
        if (!active) return;
        setProjects(results);
        if (!selectedProjectId && results.length > 0) {
          setSelectedProjectId(results[0].project.id);
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load projects");
      });
    return () => {
      active = false;
    };
  }, [accessToken, selectedProjectId]);
  const updateTimelineState = useCallback((payload: {
    project: ProjectRecord | null;
    items: TimelineItemRecord[];
    dependencies: TimelineDependencyRecord[];
  }) => {
    setTimelineItems(payload.items);
    setDependencies(payload.dependencies);
    setProjectProfile(payload.project);
    setLastRefreshed(new Date());
  }, []);

  useEffect(() => {
    if (!accessToken || !selectedProjectId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchTimelineExplorer({
      accessToken,
      projectId: selectedProjectId,
      rangeStart: startDate.toISOString(),
      rangeEnd: endDate.toISOString(),
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        updateTimelineState(response);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unable to load timeline");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [accessToken, selectedProjectId, startDate, endDate, updateTimelineState]);

  useEffect(() => {
    if (!accessToken || !selectedProjectId) return;
    const interval = setInterval(() => {
      fetchTimelineExplorer({
        accessToken,
        projectId: selectedProjectId,
        rangeStart: startDate.toISOString(),
        rangeEnd: endDate.toISOString(),
      })
        .then(updateTimelineState)
        .catch(() => {
          /* ignore background refresh errors */
        });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [accessToken, selectedProjectId, startDate, endDate, updateTimelineState]);
  useEffect(() => {
    if (drawerMode === "create") {
      setDraftTitle("");
      setDraftLane("PROMO");
      setDraftPriority("MEDIUM");
      setDraftStart(formatDateTimeLocal(startDate));
      setDraftEnd(formatDateTimeLocal(new Date(startDate.getTime() + 2 * 60 * 60 * 1000)));
      setDraftCity("");
      setCreateError(null);
    } else {
      setCreateError(null);
    }
  }, [drawerMode, startDate]);
  const handleProjectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    setSelectedProjectId(next.length > 0 ? next : null);
    setSelectedItem(null);
  };

  const handleViewChange = (mode: TimelineViewMode) => {
    setViewMode(mode);
    setAnchorDate(new Date());
  };

  const handleStartDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = parseDateInput(event.target.value);
    if (!next) return;
    setStartDate(next);
    if (next > endDate) {
      const adjusted = new Date(next);
      adjusted.setDate(adjusted.getDate() + 1);
      setEndDate(adjusted);
    }
  };

  const handleEndDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = parseDateInput(event.target.value);
    if (!next) return;
    if (next < startDate) {
      const adjusted = new Date(startDate);
      adjusted.setDate(startDate.getDate() + 1);
      setEndDate(adjusted);
      return;
    }
    setEndDate(next);
  };

  const toggleLaneFilter = (lane: TimelineLane) => {
    setLaneFilters((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) {
        next.delete(lane);
      } else {
        next.add(lane);
      }
      return next;
    });
  };

  const toggleStatusFilter = (status: TimelineItemStatus) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  const togglePriorityFilter = (priority: PriorityBand) => {
    setPriorityFilters((prev) => {
      const next = new Set(prev);
      if (next.has(priority)) {
        next.delete(priority);
      } else {
        next.add(priority);
      }
      return next;
    });
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  };

  const handleToggleLaneCollapse = (lane: TimelineLane) => {
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) {
        next.delete(lane);
      } else {
        next.add(lane);
      }
      return next;
    });
  };

  const handleSelectItem = (item: TimelineItemRecord) => {
    setSelectedItem(item);
    setDrawerMode("view");
  };

  const handleContextAction = (action: "edit" | "attach" | "convert", item: TimelineItemRecord) => {
    setSelectedItem(item);
    setDrawerMode("view");
    if (action === "convert") {
      const nextLane = item.lane === "PROMO" ? "RELEASE" : item.lane;
      if (nextLane !== item.lane) {
        setTimelineItems((previous) =>
          previous.map((entry) => (entry.id === item.id ? { ...entry, lane: nextLane } : entry))
        );
      }
    }
  };

  const handleDrawerClose = () => {
    setDrawerMode(null);
    setSelectedItem(null);
  };

  const handleMarkDone = () => {
    if (!selectedItem) return;
    setTimelineItems((previous) =>
      previous.map((item) => (item.id === selectedItem.id ? { ...item, status: "done" } : item))
    );
    setSelectedItem((prev) => (prev ? { ...prev, status: "done" } : prev));
  };

  const handleDraftSubmit = () => {
    if (!selectedProjectId) {
      setCreateError("Select a project before adding an item.");
      return;
    }
    if (!draftTitle.trim()) {
      setCreateError("Title is required.");
      return;
    }
    const start = parseDateTimeLocal(draftStart) ?? new Date();
    const end = parseDateTimeLocal(draftEnd) ?? new Date(start.getTime() + 2 * 60 * 60 * 1000);
    if (end <= start) {
      setCreateError("End must be after start.");
      return;
    }
    const nowIso = new Date().toISOString();
    const priorityScore =
      draftPriority === "HIGH"
        ? 90
        : draftPriority === "MEDIUM"
        ? 60
        : 25;
    const newItem: TimelineItemRecord = {
      id: `draft-${Date.now()}`,
      projectId: selectedProjectId,
      type: LANE_TO_TYPE[draftLane],
      lane: draftLane,
      kind: null,
      title: draftTitle.trim(),
      description: null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      dueAt: end.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      status: "tentative",
      priorityScore,
      priorityComponents: null,
      labels: {
        city: draftCity.trim() || null,
      },
      links: {},
      createdBy: session?.user?.id ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
      conflictFlags: null,
      layoutRow: null,
      territory: null,
    };
    setTimelineItems((previous) => [...previous, newItem]);
    setDrawerMode("view");
    setSelectedItem(newItem);
  };
  const projectOptions = useMemo(() => {
    return projects.map((entry) => ({
      id: entry.project.id,
      name: entry.project.name,
    }));
  }, [projects]);

  const laneState = useMemo(
    () =>
      LANE_OPTIONS.map((option) => ({
        id: option.id,
        label: option.label,
        visible: laneFilters.has(option.id),
        collapsed: collapsedLanes.has(option.id),
      })),
    [laneFilters, collapsedLanes]
  );

  const filteredItems = useMemo(() => {
    return timelineItems.filter((item) => {
      if (!laneFilters.has(item.lane)) return false;
      if (statusFilters.size > 0 && !statusFilters.has(item.status)) return false;
      const band = getPriorityBand(item.priorityScore);
      if (priorityFilters.size > 0 && !priorityFilters.has(band)) return false;
      if (!matchesSearch(item, searchTerm)) return false;
      return true;
    });
  }, [laneFilters, priorityFilters, searchTerm, statusFilters, timelineItems]);

  const filteredItemIds = useMemo(() => new Set(filteredItems.map((item) => item.id)), [filteredItems]);

  const filteredDependencies = useMemo(() => {
    return dependencies.filter(
      (dependency) =>
        dependency.fromItemId &&
        dependency.toItemId &&
        filteredItemIds.has(dependency.fromItemId) &&
        filteredItemIds.has(dependency.toItemId)
    );
  }, [dependencies, filteredItemIds]);

  const summary = useMemo(() => summarizeTimeline(filteredItems), [filteredItems]);

  const realtimeLabel = useMemo(() => {
    if (!lastRefreshed) return undefined;
    return `Updated ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }, [lastRefreshed]);

  const itemMap = useMemo(() => new Map(timelineItems.map((item) => [item.id, item])), [timelineItems]);

  const selectedItemDependencies = useMemo(() => {
    if (!selectedItem) return [] as TimelineDependencyRecord[];
    return dependencies.filter(
      (dependency) => dependency.fromItemId === selectedItem.id || dependency.toItemId === selectedItem.id
    );
  }, [dependencies, selectedItem]);
  const relatedItems = useMemo(() => {
    if (!selectedItem) return [] as TimelineItemRecord[];
    const ids = new Set<string>();
    for (const dependency of selectedItemDependencies) {
      if (dependency.fromItemId) ids.add(dependency.fromItemId);
      if (dependency.toItemId) ids.add(dependency.toItemId);
    }
    ids.delete(selectedItem.id);
    return Array.from(ids)
      .map((id) => itemMap.get(id))
      .filter((item): item is TimelineItemRecord => Boolean(item));
  }, [itemMap, selectedItem, selectedItemDependencies]);
  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active
        ? "border-indigo-400 bg-indigo-500/20 text-indigo-100 shadow"
        : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-white"
    }`;

  const selectedProject = useMemo(
    () => projects.find((entry) => entry.project.id === selectedProjectId)?.project ?? null,
    [projects, selectedProjectId]
  );
  const handleStatusChange = (status: TimelineItemStatus) => {
    if (!selectedItem) return;
    setTimelineItems((previous) =>
      previous.map((item) => (item.id === selectedItem.id ? { ...item, status } : item))
    );
    setSelectedItem((prev) => (prev ? { ...prev, status } : prev));
  };
  const drawerOpen = drawerMode !== null;

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-900 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-white">Timeline Command Center</h1>
              <p className="mt-1 text-sm text-slate-400">
                Align Live, Promo, Travel, Release, Legal, and Finance in one synchronized view.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col text-xs uppercase tracking-wide text-slate-400">
                Project
                <select
                  value={selectedProjectId ?? ""}
                  onChange={handleProjectChange}
                  className="mt-1 min-w-[12rem] rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white shadow-sm focus:border-indigo-400 focus:outline-none"
                >
                  <option value="">Select a project</option>
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-col text-xs uppercase tracking-wide text-slate-400">
                View
                <div className="mt-1 flex overflow-hidden rounded-xl border border-slate-800 bg-slate-900 text-sm font-medium text-slate-200">
                  {VIEW_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleViewChange(option.value)}
                      className={`px-4 py-2 transition ${
                        viewMode === option.value
                          ? "bg-indigo-500 text-white shadow"
                          : "hover:bg-slate-800"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex flex-col text-xs uppercase tracking-wide text-slate-400">
                Start
                <input
                  type="date"
                  value={formatDateInput(startDate)}
                  onChange={handleStartDateChange}
                  className="mt-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white shadow-sm focus:border-indigo-400 focus:outline-none"
                />
              </label>
              <label className="flex flex-col text-xs uppercase tracking-wide text-slate-400">
                End
                <input
                  type="date"
                  value={formatDateInput(endDate)}
                  onChange={handleEndDateChange}
                  className="mt-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white shadow-sm focus:border-indigo-400 focus:outline-none"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {LANE_OPTIONS.map((lane) => (
                <button
                  key={lane.id}
                  type="button"
                  onClick={() => toggleLaneFilter(lane.id)}
                  className={chipClass(laneFilters.has(lane.id))}
                >
                  {lane.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleStatusFilter(option.id)}
                  className={chipClass(statusFilters.has(option.id))}
                >
                  {option.label}
                </button>
              ))}
              {PRIORITY_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => togglePriorityFilter(option.id)}
                  className={chipClass(priorityFilters.has(option.id))}
                >
                  {option.label} priority
                </button>
              ))}
            </div>
            <div className="relative w-full max-w-sm">
              <input
                type="search"
                value={searchTerm}
                onChange={handleSearchChange}
                placeholder="Search title, contact, city"
                className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-sm text-white shadow-sm placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
              />
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">🔍</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-6">
          <section className="rounded-3xl border border-slate-900 bg-slate-900/70 p-6 shadow-2xl">
            <div className="flex flex-col gap-6 lg:flex-row lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Project</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">
                  {selectedProject?.name ?? "Select a project"}
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  {projectProfile?.description ??
                    "Filter lanes, zoom the timeline, and inspect every milestone with conflict awareness."}
                </p>
              </div>
              <dl className="grid w-full max-w-xl grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Items in view</dt>
                  <dd className="mt-2 text-xl font-semibold text-white">{summary.total}</dd>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Completed</dt>
                  <dd className="mt-2 text-xl font-semibold text-emerald-300">{summary.completed}</dd>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Tentative</dt>
                  <dd className="mt-2 text-xl font-semibold text-amber-300">{summary.tentative}</dd>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Conflicts</dt>
                  <dd className="mt-2 text-xl font-semibold text-rose-300">{summary.conflicts}</dd>
                </div>
              </dl>
            </div>
          </section>

          {error ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <section className="relative">
            <TimelineStudio
              items={filteredItems}
              dependencies={filteredDependencies}
              lanes={laneState}
              viewMode={viewMode}
              startDate={startDate}
              endDate={endDate}
              zoom={zoom}
              onZoomChange={setZoom}
              onSelectItem={handleSelectItem}
              onToggleLaneCollapse={handleToggleLaneCollapse}
              onContextAction={handleContextAction}
              onAddItem={() => {
                setDrawerMode("create");
                setSelectedItem(null);
              }}
              realtimeLabel={realtimeLabel}
            />
            {loading ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-slate-950/70">
                <span className="animate-spin text-3xl">⏳</span>
              </div>
            ) : null}
          </section>
        </div>
      </main>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-slate-900/40 backdrop-blur-sm" onClick={handleDrawerClose} />
          <aside className="relative w-full max-w-md overflow-y-auto border-l border-slate-800 bg-slate-950 px-6 py-8 shadow-2xl">
            <button
              type="button"
              onClick={handleDrawerClose}
              className="absolute right-4 top-4 rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-300 hover:border-slate-500 hover:text-white"
            >
              Close
            </button>
            {drawerMode === "create" ? (
              <div className="mt-6 space-y-5">
                <h3 className="text-xl font-semibold text-white">New timeline item</h3>
                <p className="text-sm text-slate-400">
                  Draft a quick hold, promo slot, or release milestone. Saved items will appear immediately.
                </p>
                <label className="block text-xs uppercase tracking-wide text-slate-400">
                  Title
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                  />
                </label>
                <label className="block text-xs uppercase tracking-wide text-slate-400">
                  Lane
                  <select
                    value={draftLane}
                    onChange={(event) => setDraftLane(event.target.value as TimelineLane)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                  >
                    {LANE_OPTIONS.map((lane) => (
                      <option key={lane.id} value={lane.id}>
                        {lane.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs uppercase tracking-wide text-slate-400">
                  Priority
                  <select
                    value={draftPriority}
                    onChange={(event) => setDraftPriority(event.target.value as PriorityBand)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                  >
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-xs uppercase tracking-wide text-slate-400">
                    Start
                    <input
                      type="datetime-local"
                      value={draftStart}
                      onChange={(event) => setDraftStart(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                    />
                  </label>
                  <label className="block text-xs uppercase tracking-wide text-slate-400">
                    End
                    <input
                      type="datetime-local"
                      value={draftEnd}
                      onChange={(event) => setDraftEnd(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                    />
                  </label>
                </div>
                <label className="block text-xs uppercase tracking-wide text-slate-400">
                  City / Territory
                  <input
                    type="text"
                    value={draftCity}
                    onChange={(event) => setDraftCity(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
                  />
                </label>
                {createError ? (
                  <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                    {createError}
                  </p>
                ) : null}
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleDraftSubmit}
                    className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-400"
                  >
                    Create draft
                  </button>
                </div>
              </div>
            ) : selectedItem ? (
              <div className="mt-6 space-y-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-400">Timeline item</p>
                  <h3 className="text-2xl font-semibold text-white">{selectedItem.title}</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    {selectedItem.type.replace(/_/g, " ")} · {formatDateTimeLocal(new Date(selectedItem.startsAt ?? selectedItem.updatedAt))}
                  </p>
                </div>
                <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-200">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Status</span>
                    <select
                      value={selectedItem.status}
                      onChange={(event) => handleStatusChange(event.target.value as TimelineItemStatus)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white focus:border-indigo-400 focus:outline-none"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Lane</span>
                    <span className="font-semibold">{selectedItem.lane.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs uppercase tracking-wide text-slate-400">Priority</span>
                    <span className="font-semibold">{getPriorityBand(selectedItem.priorityScore)}</span>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Window</p>
                    <p className="mt-1 text-sm text-slate-200">
                      {selectedItem.startsAt ? new Date(selectedItem.startsAt).toLocaleString() : "Not scheduled"}
                      {selectedItem.endsAt ? ` → ${new Date(selectedItem.endsAt).toLocaleString()}` : ""}
                    </p>
                  </div>
                  {selectedItem.labels?.city ? (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">City</p>
                      <p className="mt-1 text-sm text-slate-200">{selectedItem.labels.city}</p>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs uppercase tracking-wide text-slate-400">Quick actions</h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleMarkDone}
                      className="rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20"
                    >
                      Mark done
                    </button>
                    <button
                      type="button"
                      onClick={() => console.log("draft reply", selectedItem.id)}
                      className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
                    >
                      Draft reply
                    </button>
                    <button
                      type="button"
                      onClick={() => console.log("attach asset", selectedItem.id)}
                      className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
                    >
                      Attach asset
                    </button>
                    <button
                      type="button"
                      onClick={() => console.log("reschedule", selectedItem.id)}
                      className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
                    >
                      Reschedule
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs uppercase tracking-wide text-slate-400">Dependencies</h4>
                  {selectedItemDependencies.length === 0 ? (
                    <p className="text-sm text-slate-400">No linked dependencies.</p>
                  ) : (
                    <ul className="space-y-2 text-sm text-slate-200">
                      {selectedItemDependencies.map((dependency) => {
                        const direction = dependency.fromItemId === selectedItem.id ? "Blocks" : "Depends on";
                        const counterpartId = dependency.fromItemId === selectedItem.id ? dependency.toItemId : dependency.fromItemId;
                        const counterpart = counterpartId ? itemMap.get(counterpartId) : null;
                        return (
                          <li key={dependency.id} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                            <p className="text-xs uppercase tracking-wide text-slate-400">{direction}</p>
                            <p className="text-sm font-semibold text-white">
                              {counterpart ? counterpart.title : "Unknown item"}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs uppercase tracking-wide text-slate-400">Related items</h4>
                  {relatedItems.length === 0 ? (
                    <p className="text-sm text-slate-400">Nothing linked yet.</p>
                  ) : (
                    <ul className="space-y-2 text-sm text-slate-200">
                      {relatedItems.map((item) => (
                        <li key={item.id} className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
                          <p className="font-semibold text-white">{item.title}</p>
                          <p className="text-xs text-slate-400">{item.lane.replace(/_/g, " ")}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-6 text-sm text-slate-400">Select an item to view full details.</p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
