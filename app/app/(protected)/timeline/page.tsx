"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ProjectRecord,
  TimelineDependencyRecord,
  TimelineItemRecord,
} from "@cadenzor/shared";
import { useAuth } from "../../../components/AuthProvider";
import { TimelineStudio } from "../../../components/projects/TimelineStudio";
import { fetchProjects, fetchTimelineExplorer, type ProjectListItem } from "../../../lib/supabaseClient";

const ENTRY_TYPES = [
  { value: "milestone", label: "Milestones" },
  { value: "task", label: "Tasks" },
  { value: "email", label: "Emails" },
  { value: "meeting", label: "Meetings" },
  { value: "interview", label: "Interviews" },
  { value: "promo", label: "Promos" },
  { value: "note", label: "Notes" },
  { value: "comment", label: "Comments" },
  { value: "travel", label: "Travel" },
  { value: "hold", label: "Holds" },
] as const;

type EntryTypeValue = (typeof ENTRY_TYPES)[number]["value"];

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

function startOfDayIso(dateString: string): string {
  return new Date(`${dateString}T00:00:00.000Z`).toISOString();
}

function endOfDayIso(dateString: string): string {
  return new Date(`${dateString}T23:59:59.999Z`).toISOString();
}

function isoToDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
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

function coerceEntryType(item: TimelineItemRecord): EntryTypeValue {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const rawCandidate = [
    metadata.entryType,
    metadata.entry_type,
    metadata.category,
    metadata.kind,
    item.type,
    item.lane,
  ]
    .map((candidate) =>
      typeof candidate === "string" ? candidate.toLowerCase() : Array.isArray(candidate) ? String(candidate[0]).toLowerCase() : null
    )
    .find((candidate) => candidate && candidate.length > 0);

  switch (rawCandidate) {
    case "milestone":
    case "milestones":
    case "gate":
      return "milestone";
    case "email":
    case "emails":
    case "urgent email":
      return "email";
    case "meeting":
    case "meetings":
    case "calendar":
    case "call":
      return "meeting";
    case "interview":
    case "interviews":
      return "interview";
    case "promo":
    case "promos":
    case "promotion":
    case "press":
    case "event":
    case "lead":
      return "promo";
    case "note":
    case "notes":
      return "note";
    case "comment":
    case "comments":
    case "feedback":
      return "comment";
    case "travel":
    case "travel buffer":
      return "travel";
    case "hold":
    case "holdback":
      return "hold";
    case "task":
    case "tasks":
    case "writing":
    case "band":
    case "live":
    case "release":
    default:
      return "task";
  }
}

interface ClassifiedTimelineItem extends TimelineItemRecord {
  entryType: EntryTypeValue;
  lane: string | null;
}

interface ProjectTimelineSummary {
  project: ProjectRecord | null;
  items: ClassifiedTimelineItem[];
  dependencies: TimelineDependencyRecord[];
}

function summarizeProject(items: ClassifiedTimelineItem[]): {
  percentComplete: number;
  totalItems: number;
  completeItems: number;
  dateRange: { start: string | null; end: string | null };
  byType: Record<EntryTypeValue, number>;
} {
  if (items.length === 0) {
    return {
      percentComplete: 0,
      totalItems: 0,
      completeItems: 0,
      dateRange: { start: null, end: null },
      byType: Object.fromEntries(ENTRY_TYPES.map((entry) => [entry.value, 0])) as Record<EntryTypeValue, number>,
    };
  }

  let complete = 0;
  let minDate: number | null = null;
  let maxDate: number | null = null;
  const byType = Object.fromEntries(ENTRY_TYPES.map((entry) => [entry.value, 0])) as Record<EntryTypeValue, number>;

  for (const item of items) {
    byType[item.entryType] += 1;
    const completion = getPercentComplete(item);
    if (completion >= 100) {
      complete += 1;
    }
    const start = item.startsAt ? Date.parse(item.startsAt) : null;
    const end = item.endsAt ? Date.parse(item.endsAt) : start;
    if (start != null) {
      minDate = minDate == null ? start : Math.min(minDate, start);
    }
    if (end != null) {
      maxDate = maxDate == null ? end : Math.max(maxDate, end);
    }
  }

  const percent = items.length === 0 ? 0 : Math.round((complete / items.length) * 100);

  return {
    percentComplete: percent,
    totalItems: items.length,
    completeItems: complete,
    dateRange: {
      start: minDate != null ? new Date(minDate).toISOString() : null,
      end: maxDate != null ? new Date(maxDate).toISOString() : null,
    },
    byType,
  };
}

export default function TimelinePage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ProjectTimelineSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<TimelineGranularity>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<EntryTypeValue>>(new Set());

  const presetRange = useMemo(() => computeDateRange(granularity, anchorDate), [granularity, anchorDate]);
  const effectiveRangeStart = customStart ? startOfDayIso(customStart) : presetRange.start;
  const effectiveRangeEnd = customEnd ? endOfDayIso(customEnd) : presetRange.end;
  const laneOrder = useMemo(() => ENTRY_TYPES.map((entry) => entry.label), []);

  useEffect(() => {
    if (!accessToken) return;

    let isMounted = true;
    fetchProjects({ accessToken, status: "active" })
      .then((results) => {
        if (!isMounted) return;
        setProjects(results);
        if (results.length > 0 && !selectedProjectId) {
          setSelectedProjectId(results[0].project.id);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Failed to load projects");
      });

    return () => {
      isMounted = false;
    };
  }, [accessToken, selectedProjectId]);

  useEffect(() => {
    if (!accessToken || !selectedProjectId) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const entryTypes = Array.from(selectedTypes);

    fetchTimelineExplorer({
      accessToken,
      projectId: selectedProjectId,
      entryTypes: entryTypes.length > 0 ? entryTypes : undefined,
      rangeStart: effectiveRangeStart,
      rangeEnd: effectiveRangeEnd,
      signal: controller.signal,
    })
      .then((response) => {
        const classified: ClassifiedTimelineItem[] = response.items.map((item) => {
          const entryType = coerceEntryType(item);
          const lane = ENTRY_TYPES.find((entry) => entry.value === entryType)?.label ?? "General";
          return { ...item, entryType, lane };
        });

        const filteredItems = entryTypes.length > 0
          ? classified.filter((item) => entryTypes.includes(item.entryType))
          : classified;

        setTimeline({
          project: response.project,
          items: filteredItems,
          dependencies: response.dependencies,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load project timeline");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    accessToken,
    selectedProjectId,
    selectedTypes,
    effectiveRangeStart,
    effectiveRangeEnd,
  ]);

  const summary = useMemo(() => summarizeProject(timeline?.items ?? []), [timeline?.items]);

  const handleProjectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    setSelectedProjectId(next.length > 0 ? next : null);
  };

  const handleTypeToggle = (value: EntryTypeValue) => {
    setSelectedTypes((previous) => {
      const next = new Set(previous);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const handleCustomStartChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setCustomStart(value.length > 0 ? value : null);
  };

  const handleCustomEndChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setCustomEnd(value.length > 0 ? value : null);
  };

  const projectOptions = useMemo(
    () =>
      projects.map((item) => ({
        id: item.project.id,
        name: item.project.name,
        status: item.project.status,
      })),
    [projects]
  );

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-50">Project Timeline Studio</h1>
            <p className="mt-1 text-sm text-slate-400">
              Focus on one project at a time and explore every milestone, task, email, and meeting across the selected window.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-slate-200">
            <label className="flex flex-col text-xs uppercase tracking-wide text-slate-400">
              Project
              <select
                value={selectedProjectId ?? ""}
                onChange={handleProjectChange}
                className="mt-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 shadow-sm focus:border-indigo-400 focus:outline-none"
              >
                <option value="">Select a project</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs uppercase tracking-wide text-slate-400">
              Timeframe
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 p-1">
                {GRANULARITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setGranularity(option.value);
                      setCustomStart(null);
                      setCustomEnd(null);
                      setAnchorDate(new Date());
                    }}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                      granularity === option.value
                        ? "bg-indigo-500 text-white shadow"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </label>
            <label className="flex flex-col text-xs uppercase tracking-wide text-slate-400">
              Start date
              <input
                type="date"
                value={isoToDateInput(customStart ?? effectiveRangeStart)}
                onChange={handleCustomStartChange}
                className="mt-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 focus:border-indigo-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col text-xs uppercase tracking-wide text-slate-400">
              End date
              <input
                type="date"
                value={isoToDateInput(customEnd ?? effectiveRangeEnd)}
                onChange={handleCustomEndChange}
                className="mt-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 focus:border-indigo-400 focus:outline-none"
              />
            </label>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-slate-100 shadow-xl">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">Project</p>
              <h2 className="mt-1 text-2xl font-semibold text-white">
                {timeline?.project?.name ?? "Select a project"}
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                {timeline?.project?.description ?? "Choose a project to explore its dedicated timeline."}
              </p>
            </div>
            <dl className="grid w-full max-w-xl grid-cols-2 gap-4 text-sm lg:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-400">Items in view</dt>
                <dd className="mt-2 text-xl font-semibold text-white">{summary.totalItems}</dd>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-400">Completed</dt>
                <dd className="mt-2 text-xl font-semibold text-white">{summary.completeItems}</dd>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-400">Progress</dt>
                <dd className="mt-2 text-xl font-semibold text-white">{summary.percentComplete}%</dd>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <dt className="text-xs uppercase tracking-wide text-slate-400">Window</dt>
                <dd className="mt-2 text-sm font-medium text-white">
                  {summary.dateRange.start && summary.dateRange.end
                    ? `${new Date(summary.dateRange.start).toLocaleDateString()} – ${new Date(
                        summary.dateRange.end
                      ).toLocaleDateString()}`
                    : "No scheduled items"}
                </dd>
              </div>
            </dl>
          </div>
          <div className="mt-6">
            <p className="text-xs uppercase tracking-wide text-slate-400">Filter by entry type</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {ENTRY_TYPES.map((type) => {
                const isActive = selectedTypes.has(type.value);
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => handleTypeToggle(type.value)}
                    className={`rounded-full border px-3 py-1 text-sm transition ${
                      isActive
                        ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
                        : "border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500"
                    }`}
                  >
                    {type.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-100">
            <p className="font-semibold">{error}</p>
          </div>
        ) : null}

        <section className="flex-1">
          {loading ? (
            <div className="flex h-[320px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60 text-slate-300">
              Loading timeline…
            </div>
          ) : timeline && timeline.items.length > 0 ? (
            <TimelineStudio
              items={timeline.items}
              dependencies={timeline.dependencies}
              laneOrder={laneOrder}
              showBufferControl={false}
              showConflictSummary={false}
              title="Timeline Studio"
              subtitle="Full-screen view of the selected project."
            />
          ) : (
            <div className="flex h-[320px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/60 text-slate-300">
              Choose a project and timeframe to populate the timeline.
            </div>
          )}
        </section>

        {timeline ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-slate-100">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Entry breakdown</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {ENTRY_TYPES.map((type) => (
                <div key={type.value} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{type.label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{summary.byType[type.value]}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
