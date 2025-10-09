"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProjectStatus, TimelineDependencyRecord, TimelineItemRecord } from "@cadenzor/shared";
import { useAuth } from "../../../components/AuthProvider";
import { TimelineStudio } from "../../../components/projects/TimelineStudio";
import {
  fetchTimelineExplorer,
  type TimelineExplorerResponse,
} from "../../../lib/supabaseClient";

const TIMELINE_TYPES: TimelineItemRecord["type"][] = [
  "event",
  "milestone",
  "task",
  "hold",
  "lead",
  "gate",
];

type TimelineGranularity = "day" | "week" | "month" | "quarter" | "year";

const GRANULARITY_OPTIONS: Array<{ value: TimelineGranularity; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

function computeDateRange(granularity: TimelineGranularity, anchor = new Date()): {
  start: string;
  end: string;
} {
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();

  switch (granularity) {
    case "day": {
      const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
      const end = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case "week": {
      const dayOfWeek = anchor.getUTCDay();
      const mondayDiff = (dayOfWeek + 6) % 7;
      const startDate = day - mondayDiff;
      const start = new Date(Date.UTC(year, month, startDate, 0, 0, 0, 0));
      const end = new Date(Date.UTC(year, month, startDate + 6, 23, 59, 59, 999));
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case "quarter": {
      const quarter = Math.floor(month / 3);
      const startMonth = quarter * 3;
      const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case "year": {
      const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case "month":
    default: {
      const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      return { start: start.toISOString(), end: end.toISOString() };
    }
  }
}

function isoToDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function startOfDayIso(dateString: string): string {
  return new Date(`${dateString}T00:00:00.000Z`).toISOString();
}

function endOfDayIso(dateString: string): string {
  return new Date(`${dateString}T23:59:59.999Z`).toISOString();
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getPercentComplete(item: TimelineItemRecord): number {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const candidates = [
    metadata.percentComplete,
    metadata.percent_complete,
    metadata.progress,
    metadata.progressPercent,
    metadata.completion,
    metadata.completionPercent,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return clampPercent(candidate);
    }
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const parsed = Number.parseFloat(candidate);
      if (!Number.isNaN(parsed)) {
        return clampPercent(parsed);
      }
    }
  }

  if ((metadata as Record<string, unknown>).done === true) {
    return 100;
  }

  if ((metadata as Record<string, unknown>).done === false) {
    return 0;
  }

  if (typeof item.priority === "number" && item.priority >= 100) {
    return 100;
  }

  return 0;
}

interface ProjectMetrics {
  percentComplete: number;
  itemCount: number;
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
}
export default function TimelinePage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [data, setData] = useState<TimelineExplorerResponse>({
    projects: [],
    items: [],
    dependencies: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const initialRange = computeDateRange("month");
  const [granularity, setGranularity] = useState<TimelineGranularity>("month");
  const [rangeStart, setRangeStart] = useState<string | null>(initialRange.start);
  const [rangeEnd, setRangeEnd] = useState<string | null>(initialRange.end);
  const [projectDueStart, setProjectDueStart] = useState<string | null>(null);
  const [projectDueEnd, setProjectDueEnd] = useState<string | null>(null);
  const [projectPercentMin, setProjectPercentMin] = useState<number>(0);
  const [projectPercentMax, setProjectPercentMax] = useState<number>(100);
  const [itemPercentMin, setItemPercentMin] = useState<number>(0);
  const [itemPercentMax, setItemPercentMax] = useState<number>(100);
  const [laneFilter, setLaneFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [itemStatusFilter, setItemStatusFilter] = useState<string>("all");
  const [territoryFilter, setTerritoryFilter] = useState<string>("all");

  useEffect(() => {
    if (!accessToken) {
      setData({ projects: [], items: [], dependencies: [] });
      setLoading(false);
      setError("You need to sign in again to view the timeline view.");
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchTimelineExplorer({
          accessToken,
          status: statusFilter,
          rangeStart: rangeStart ?? undefined,
          rangeEnd: rangeEnd ?? undefined,
        });
        if (!active) return;
        setData(response);
      } catch (err: any) {
        if (!active) return;
        setError(err?.message ?? "Failed to load timeline view");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [accessToken, statusFilter, rangeStart, rangeEnd]);

  useEffect(() => {
    if (data.projects.length === 0) {
      if (selectedProjects.length !== 0) {
        setSelectedProjects([]);
      }
      return;
    }

    setSelectedProjects((previous) => {
      const availableIds = data.projects.map((project) => project.id);
      const availableSet = new Set(availableIds);
      const retained = previous.filter((id) => availableSet.has(id));
      if (retained.length === previous.length && retained.length > 0) {
        return previous;
      }
      if (retained.length > 0) {
        return retained;
      }
      return availableIds;
    });
  }, [data.projects, selectedProjects.length]);
  const projectMetrics = useMemo(() => {
    const metrics = new Map<string, ProjectMetrics>();
    for (const project of data.projects) {
      metrics.set(project.id, {
        percentComplete: 0,
        itemCount: 0,
        startDate: project.startDate,
        endDate: project.endDate,
        status: project.status,
      });
    }

    for (const item of data.items) {
      const metric = metrics.get(item.projectId);
      if (!metric) continue;
      const percent = getPercentComplete(item);
      metric.percentComplete = metric.percentComplete + percent;
      metric.itemCount += 1;
    }

    for (const [projectId, metric] of metrics.entries()) {
      if (metric.itemCount > 0) {
        metric.percentComplete = metric.percentComplete / metric.itemCount;
      }
    }

    return metrics;
  }, [data.projects, data.items]);

  const availableLanes = useMemo(() => {
    const set = new Set<string>();
    for (const item of data.items) {
      if (item.lane) {
        set.add(item.lane);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data.items]);

  const availableTerritories = useMemo(() => {
    const set = new Set<string>();
    for (const item of data.items) {
      if (item.territory) {
        set.add(item.territory);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data.items]);

  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const item of data.items) {
      if (item.status) {
        set.add(item.status);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data.items]);

  const projectDueStartMs = projectDueStart ? Date.parse(projectDueStart) : null;
  const projectDueEndMs = projectDueEnd ? Date.parse(projectDueEnd) : null;

  const filteredProjects = useMemo(() => {
    const selection = new Set(selectedProjects);
    return data.projects.filter((project) => {
      if (!selection.has(project.id)) {
        return false;
      }
      const metric = projectMetrics.get(project.id);
      if (!metric) {
        return false;
      }
      if (projectPercentMin > 0 || projectPercentMax < 100) {
        const percent = metric.percentComplete;
        if (percent < projectPercentMin || percent > projectPercentMax) {
          return false;
        }
      }
      if (projectDueStartMs != null && metric.endDate) {
        const endMs = Date.parse(metric.endDate);
        if (!Number.isNaN(endMs) && endMs < projectDueStartMs) {
          return false;
        }
      }
      if (projectDueEndMs != null && metric.endDate) {
        const endMs = Date.parse(metric.endDate);
        if (!Number.isNaN(endMs) && endMs > projectDueEndMs) {
          return false;
        }
      }
      return true;
    });
  }, [
    data.projects,
    selectedProjects,
    projectMetrics,
    projectPercentMin,
    projectPercentMax,
    projectDueStartMs,
    projectDueEndMs,
  ]);

  const filteredItems = useMemo(() => {
    const projectSet = new Set(filteredProjects.map((project) => project.id));
    const minPercent = Math.min(itemPercentMin, itemPercentMax);
    const maxPercent = Math.max(itemPercentMin, itemPercentMax);
    return data.items.filter((item) => {
      if (!projectSet.has(item.projectId)) {
        return false;
      }
      if (laneFilter !== "all") {
        const laneKey = item.lane ?? "__none";
        if (laneKey !== laneFilter) {
          return false;
        }
      }
      if (typeFilter !== "all" && item.type !== typeFilter) {
        return false;
      }
      if (itemStatusFilter !== "all") {
        const statusKey = item.status ?? "__none";
        if (statusKey !== itemStatusFilter) {
          return false;
        }
      }
      if (territoryFilter !== "all") {
        const territoryKey = item.territory ?? "__none";
        if (territoryKey !== territoryFilter) {
          return false;
        }
      }
      const percent = getPercentComplete(item);
      if (percent < minPercent || percent > maxPercent) {
        return false;
      }
      return true;
    });
  }, [
    data.items,
    filteredProjects,
    laneFilter,
    typeFilter,
    itemStatusFilter,
    territoryFilter,
    itemPercentMin,
    itemPercentMax,
  ]);

  const filteredDependencies = useMemo(() => {
    const visibleItemIds = new Set(filteredItems.map((item) => item.id));
    return data.dependencies.filter(
      (dependency) =>
        visibleItemIds.has(dependency.fromItemId) && visibleItemIds.has(dependency.toItemId)
    );
  }, [data.dependencies, filteredItems]);

  const itemsByProject = useMemo(() => {
    const map = new Map<string, TimelineItemRecord[]>();
    for (const item of filteredItems) {
      const list = map.get(item.projectId) ?? [];
      list.push(item);
      map.set(item.projectId, list);
    }
    return map;
  }, [filteredItems]);

  const dependenciesByProject = useMemo(() => {
    const map = new Map<string, TimelineDependencyRecord[]>();
    for (const dependency of filteredDependencies) {
      const list = map.get(dependency.projectId) ?? [];
      list.push(dependency);
      map.set(dependency.projectId, list);
    }
    return map;
  }, [filteredDependencies]);

  const averageProjectProgress = useMemo(() => {
    if (filteredProjects.length === 0) {
      return 0;
    }
    let total = 0;
    let counted = 0;
    for (const project of filteredProjects) {
      const metric = projectMetrics.get(project.id);
      if (!metric) continue;
      total += metric.percentComplete;
      counted += 1;
    }
    return counted > 0 ? total / counted : 0;
  }, [filteredProjects, projectMetrics]);

  const averageItemProgress = useMemo(() => {
    if (filteredItems.length === 0) {
      return 0;
    }
    let total = 0;
    for (const item of filteredItems) {
      total += getPercentComplete(item);
    }
    return total / filteredItems.length;
  }, [filteredItems]);

  const handleGranularityChange = (value: TimelineGranularity) => {
    setGranularity(value);
    const range = computeDateRange(value);
    setRangeStart(range.start);
    setRangeEnd(range.end);
  };

  const handleProjectSelection = (projectId: string, checked: boolean) => {
    setSelectedProjects((previous) => {
      if (checked) {
        if (previous.includes(projectId)) {
          return previous;
        }
        return [...previous, projectId];
      }
      return previous.filter((id) => id !== projectId);
    });
  };

  const allProjectIds = data.projects.map((project) => project.id);
  const allSelected = selectedProjects.length > 0 && selectedProjects.length === allProjectIds.length;

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-gray-900">Timeline Studio</h1>
        <p className="text-sm text-gray-600">
          Compare every project lane in one place, dial in date windows, and filter on metadata like
          status, progress, territory, and dependencies.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
              <button
                type="button"
                onClick={() => {
                  setProjectPercentMin(0);
                  setProjectPercentMax(100);
                  setItemPercentMin(0);
                  setItemPercentMax(100);
                  setLaneFilter("all");
                  setTypeFilter("all");
                  setItemStatusFilter("all");
                  setTerritoryFilter("all");
                  setProjectDueStart(null);
                  setProjectDueEnd(null);
                }}
                className="text-xs font-medium text-gray-500 hover:text-gray-900"
              >
                Reset
              </button>
            </div>

            <div className="mt-4 space-y-5">
              <div>
                <span className="text-xs font-semibold uppercase text-gray-500">Project status</span>
                <select
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="archived">Archived</option>
                </select>
              </div>

              <div>
                <span className="text-xs font-semibold uppercase text-gray-500">Date window</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {GRANULARITY_OPTIONS.map((option) => {
                    const active = granularity === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleGranularityChange(option.value)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                          active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 text-sm">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-gray-500">Starts</span>
                    <input
                      type="date"
                      value={isoToDateInput(rangeStart)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setRangeStart(value ? startOfDayIso(value) : null);
                      }}
                      className="rounded-md border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase text-gray-500">Ends</span>
                    <input
                      type="date"
                      value={isoToDateInput(rangeEnd)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setRangeEnd(value ? endOfDayIso(value) : null);
                      }}
                      className="rounded-md border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setRangeStart(null);
                      setRangeEnd(null);
                    }}
                    className="text-left text-xs font-medium text-gray-500 hover:text-gray-900"
                  >
                    Clear date filters
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase text-gray-500">Projects</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedProjects(allSelected ? [] : allProjectIds)
                    }
                    className="text-xs font-medium text-gray-500 hover:text-gray-900"
                  >
                    {allSelected ? "Clear" : "Select all"}
                  </button>
                </div>
                <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                  {data.projects.length === 0 ? (
                    <p className="text-xs text-gray-500">No projects available.</p>
                  ) : (
                    data.projects.map((project) => {
                      const checked = selectedProjects.includes(project.id);
                      const metric = projectMetrics.get(project.id);
                      const percent = metric ? Math.round(metric.percentComplete) : 0;
                      return (
                        <label
                          key={project.id}
                          className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => handleProjectSelection(project.id, event.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                            />
                            {project.name}
                          </span>
                          <span className="text-xs text-gray-500">{percent}%</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="grid gap-3 text-sm">
                <div>
                  <span className="text-xs font-semibold uppercase text-gray-500">Project due date</span>
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500">On or after</span>
                      <input
                        type="date"
                        value={isoToDateInput(projectDueStart)}
                        onChange={(event) => {
                          const value = event.target.value;
                          setProjectDueStart(value ? startOfDayIso(value) : null);
                        }}
                        className="rounded-md border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500">On or before</span>
                      <input
                        type="date"
                        value={isoToDateInput(projectDueEnd)}
                        onChange={(event) => {
                          const value = event.target.value;
                          setProjectDueEnd(value ? endOfDayIso(value) : null);
                        }}
                        className="rounded-md border border-gray-300 px-3 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase text-gray-500">Project % complete</span>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={projectPercentMin}
                      onChange={(event) => {
                        const value = clampPercent(Number(event.target.value));
                        setProjectPercentMin(Math.min(value, projectPercentMax));
                      }}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                    <span className="text-xs text-gray-500">to</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={projectPercentMax}
                      onChange={(event) => {
                        const value = clampPercent(Number(event.target.value));
                        setProjectPercentMax(Math.max(value, projectPercentMin));
                      }}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                    <span className="text-xs text-gray-500">%</span>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase text-gray-500">Item % complete</span>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={itemPercentMin}
                      onChange={(event) => {
                        const value = clampPercent(Number(event.target.value));
                        setItemPercentMin(Math.min(value, itemPercentMax));
                      }}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                    <span className="text-xs text-gray-500">to</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={itemPercentMax}
                      onChange={(event) => {
                        const value = clampPercent(Number(event.target.value));
                        setItemPercentMax(Math.max(value, itemPercentMin));
                      }}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                    <span className="text-xs text-gray-500">%</span>
                  </div>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase text-gray-500">Lane</span>
                  <select
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    value={laneFilter}
                    onChange={(event) => setLaneFilter(event.target.value)}
                  >
                    <option value="all">All lanes</option>
                    <option value="__none">No lane</option>
                    {availableLanes.map((lane) => (
                      <option key={lane} value={lane}>
                        {lane}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase text-gray-500">Item type</span>
                  <select
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                  >
                    <option value="all">All types</option>
                    {TIMELINE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase text-gray-500">Item status</span>
                  <select
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    value={itemStatusFilter}
                    onChange={(event) => setItemStatusFilter(event.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="__none">No status</option>
                    {availableStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase text-gray-500">Territory</span>
                  <select
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    value={territoryFilter}
                    onChange={(event) => setTerritoryFilter(event.target.value)}
                  >
                    <option value="all">All territories</option>
                    <option value="__none">No territory</option>
                    {availableTerritories.map((territory) => (
                      <option key={territory} value={territory}>
                        {territory}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <div className="space-y-6">
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}
          {loading ? (
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span className="h-3 w-3 animate-ping rounded-full bg-gray-400" />
              Loading timeline data…
            </div>
          ) : null}

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <span className="text-xs font-semibold uppercase text-gray-500">Projects</span>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{filteredProjects.length}</p>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase text-gray-500">Timeline items</span>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{filteredItems.length}</p>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase text-gray-500">Avg project progress</span>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{averageProjectProgress.toFixed(1)}%</p>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase text-gray-500">Avg item progress</span>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{averageItemProgress.toFixed(1)}%</p>
              </div>
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-600">
              <h2 className="text-lg font-semibold text-gray-900">No projects match the filters</h2>
              <p className="mt-2 text-sm text-gray-500">
                Adjust the project selection, date window, or metadata filters to surface a timeline view.
              </p>
            </div>
          ) : null}

          {filteredProjects.map((project) => {
            const items = itemsByProject.get(project.id) ?? [];
            const dependencies = dependenciesByProject.get(project.id) ?? [];
            const metric = projectMetrics.get(project.id);
            const percent = metric ? metric.percentComplete : 0;
            return (
              <div key={project.id} className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">{project.name}</h2>
                    <p className="text-xs uppercase text-gray-500">{project.status}</p>
                  </div>
                  <div className="text-right text-sm text-gray-600">
                    <p>
                      <span className="font-semibold text-gray-900">{percent.toFixed(1)}%</span> complete
                    </p>
                    <p className="text-xs text-gray-500">
                      {project.startDate ? `Start: ${new Date(project.startDate).toLocaleDateString()}` : "No start"} · {project.endDate ? `Due: ${new Date(project.endDate).toLocaleDateString()}` : "No due"}
                    </p>
                  </div>
                </div>
                <TimelineStudio items={items} dependencies={dependencies} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
