"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TimelineItemRecord, TimelineDependencyRecord } from "@cadenzor/shared";
import { detectTimelineConflicts, buildConflictIndex, type TimelineConflict } from "@cadenzor/shared";

const DEFAULT_LANES = [
  "Live",
  "Promo",
  "Writing",
  "Brand",
  "Release",
  "General",
];
const MIN_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours
const DAY_MS = 24 * 60 * 60 * 1000;
const LANE_PADDING_TOP = 12;
const LANE_PADDING_BOTTOM = 16;
const ITEM_HEIGHT = 52;
const ROW_GAP = 10;
const AXIS_HEIGHT = 44;
const DEFAULT_BUFFER_HOURS = 4;

export type DependencyKind = "FS" | "SS";

interface DependencyMeta {
  itemId: string;
  kind?: DependencyKind;
  note?: string;
}

interface ParsedItem {
  item: TimelineItemRecord;
  lane: string;
  start: number;
  end: number;
}

interface PositionedItem extends ParsedItem {
  leftRatio: number;
  widthRatio: number;
  rowIndex: number;
  top: number;
  height: number;
}

interface LaneLayout {
  name: string;
  items: PositionedItem[];
  height: number;
  top: number;
  rowCount: number;
}

interface DependencyEdge {
  fromId: string;
  toId: string;
  kind: DependencyKind;
  note?: string;
}

function normaliseLane(rawLane: string | null): string {
  const trimmed = rawLane?.trim();
  if (!trimmed) {
    return "General";
  }
  return trimmed;
}

function toTimestamp(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function ensureDuration(start: number, end: number | null): number {
  if (!end || end <= start) {
    return start + MIN_DURATION_MS;
  }
  return end;
}

function extractDependencies(item: TimelineItemRecord): DependencyMeta[] {
  const maybeDeps = (item.metadata as Record<string, unknown>)?.dependencies;
  if (!maybeDeps) return [];

  const buildFromObject = (entry: any): DependencyMeta | null => {
    if (!entry || typeof entry !== "object" || !("itemId" in entry)) {
      return null;
    }
    const candidate = entry as { itemId?: unknown; kind?: unknown; note?: unknown };
    if (typeof candidate.itemId !== "string" || candidate.itemId.length === 0) {
      return null;
    }
    const kind = candidate.kind === "SS" ? "SS" : candidate.kind === "FS" ? "FS" : undefined;
    const note = typeof candidate.note === "string" ? candidate.note : undefined;
    return { itemId: candidate.itemId, kind, note };
  };

  const results: DependencyMeta[] = [];

  if (Array.isArray(maybeDeps)) {
    for (const entry of maybeDeps) {
      if (typeof entry === "string" && entry.trim()) {
        results.push({ itemId: entry.trim() });
        continue;
      }
      const normalised = buildFromObject(entry);
      if (normalised) {
        results.push(normalised);
      }
    }
    return results;
  }

  if (typeof maybeDeps === "string" && maybeDeps.trim()) {
    return [{ itemId: maybeDeps.trim() }];
  }

  const single = buildFromObject(maybeDeps);
  return single ? [single] : [];
}

function buildTimeScale(rangeStart: number, rangeEnd: number) {
  const total = Math.max(rangeEnd - rangeStart, DAY_MS);
  const segments: Array<{ leftRatio: number; label: string }> = [];
  const cursor = new Date(rangeStart);
  cursor.setHours(0, 0, 0, 0);
  for (let ms = cursor.getTime(); ms <= rangeEnd; ms += DAY_MS) {
    const ratio = (ms - rangeStart) / total;
    if (ratio >= 0 && ratio <= 1) {
      const label = new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      segments.push({ leftRatio: ratio, label });
    }
  }
  return segments;
}

function getTypeStyles(type: TimelineItemRecord["type"]): string {
  switch (type) {
    case "event":
      return "bg-blue-100 border-blue-300 text-blue-900";
    case "milestone":
      return "bg-amber-100 border-amber-300 text-amber-900";
    case "task":
      return "bg-emerald-100 border-emerald-300 text-emerald-900";
    case "hold":
      return "bg-slate-100 border-slate-300 text-slate-800";
    case "lead":
      return "bg-purple-100 border-purple-300 text-purple-900";
    case "gate":
      return "bg-rose-100 border-rose-300 text-rose-900";
    default:
      return "bg-gray-100 border-gray-300 text-gray-800";
  }
}

export function TimelineStudio({
  items,
  dependencies = [],
  laneOrder,
  showBufferControl = false,
  showConflictSummary = true,
  title = "Timeline Studio",
  subtitle = "Visualise items across lanes, dependencies, and milestones.",
  defaultBufferHours = DEFAULT_BUFFER_HOURS,
}: {
  items: TimelineItemRecord[];
  dependencies?: TimelineDependencyRecord[];
  laneOrder?: string[];
  showBufferControl?: boolean;
  showConflictSummary?: boolean;
  title?: string;
  subtitle?: string;
  defaultBufferHours?: number;
}) {
  const [bufferHours, setBufferHours] = useState(defaultBufferHours);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(0);

  const scheduledItems = useMemo(() => {
    return items
      .map((item) => {
        const start = toTimestamp(item.startsAt);
        if (!start) return null;
        const end = ensureDuration(start, toTimestamp(item.endsAt));
        return { item, start, end, lane: normaliseLane(item.lane) } satisfies ParsedItem;
      })
      .filter((entry): entry is ParsedItem => Boolean(entry));
  }, [items]);

  const unscheduledItems = useMemo(() => items.filter((item) => !item.startsAt), [items]);

  const range = useMemo(() => {
    if (scheduledItems.length === 0) {
      const now = Date.now();
      return { start: now - DAY_MS, end: now + 3 * DAY_MS };
    }
    let min = scheduledItems[0].start;
    let max = scheduledItems[0].end;
    for (const entry of scheduledItems) {
      min = Math.min(min, entry.start);
      max = Math.max(max, entry.end);
    }
    // add padding so edges have breathing room
    const padding = Math.max((max - min) * 0.05, 12 * 60 * 60 * 1000);
    return { start: min - padding, end: max + padding };
  }, [scheduledItems]);

  const totalDuration = Math.max(range.end - range.start, DAY_MS);

  useEffect(() => {
    const handleResize = () => {
      const width = timelineRef.current?.clientWidth ?? 0;
      setTimelineWidth(width);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [scheduledItems.length]);

  const laneLayouts = useMemo(() => {
    const lanePriority = laneOrder ?? DEFAULT_LANES;
    const laneNames = new Set<string>(lanePriority);
    for (const entry of scheduledItems) {
      laneNames.add(entry.lane);
    }

    const orderedLanes = Array.from(laneNames).sort((a, b) => {
      const ai = lanePriority.indexOf(a);
      const bi = lanePriority.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    const laneTopOffsets = new Map<string, number>();
    let cumulativeTop = AXIS_HEIGHT;

    const layouts: LaneLayout[] = [];

    for (const laneName of orderedLanes) {
      const laneEntries = scheduledItems.filter((entry) => entry.lane === laneName);
      const rows: PositionedItem[][] = [];

      laneEntries
        .sort((a, b) => a.start - b.start)
        .forEach((entry) => {
          const leftRatio = Math.max(0, Math.min(1, (entry.start - range.start) / totalDuration));
          const widthRatio = Math.max((entry.end - entry.start) / totalDuration, MIN_DURATION_MS / totalDuration);

          let placedRow = 0;
          for (; placedRow < rows.length; placedRow += 1) {
            const rowItems = rows[placedRow];
            const latest = rowItems[rowItems.length - 1];
            if (!latest || latest.end <= entry.start) {
              break;
            }
          }

          if (!rows[placedRow]) {
            rows[placedRow] = [];
          }

          const positioned: PositionedItem = {
            ...entry,
            leftRatio,
            widthRatio,
            rowIndex: placedRow,
            top: 0,
            height: ITEM_HEIGHT,
          };
          rows[placedRow].push(positioned);
        });

      const rowCount = rows.length || 1;
      const laneHeight = LANE_PADDING_TOP + LANE_PADDING_BOTTOM + rowCount * ITEM_HEIGHT + Math.max(0, rowCount - 1) * ROW_GAP;

      laneTopOffsets.set(laneName, cumulativeTop);
      cumulativeTop += laneHeight;

      const positionedItems = rows
        .flat()
        .map((item) => ({
          ...item,
          top:
            (laneTopOffsets.get(laneName) ?? AXIS_HEIGHT) +
            LANE_PADDING_TOP +
            item.rowIndex * (ITEM_HEIGHT + ROW_GAP),
        }));

      layouts.push({
        name: laneName,
        items: positionedItems,
        height: laneHeight,
        top: (laneTopOffsets.get(laneName) ?? AXIS_HEIGHT),
        rowCount,
      });
    }

    return { layouts, totalHeight: cumulativeTop };
  }, [scheduledItems, range.start, totalDuration]);

  const { layouts, totalHeight } = laneLayouts;

  const edges = useMemo(() => {
    if (!items.length) return [] as DependencyEdge[];
    const byId = new Map(items.map((item) => [item.id, item]));
    const result: DependencyEdge[] = [];
    const seen = new Set<string>();

    for (const dependency of dependencies) {
      if (!dependency.fromItemId || !dependency.toItemId) continue;
      if (!byId.has(dependency.fromItemId) || !byId.has(dependency.toItemId)) continue;
      const key = `${dependency.fromItemId}:${dependency.toItemId}:${dependency.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        fromId: dependency.fromItemId,
        toId: dependency.toItemId,
        kind: dependency.kind === "SS" ? "SS" : "FS",
        note: dependency.note ?? undefined,
      });
    }

    for (const item of items) {
      const deps = extractDependencies(item);
      for (const dep of deps) {
        if (!dep.itemId || !byId.has(dep.itemId)) continue;
        const key = `${dep.itemId}:${item.id}:${dep.kind ?? "FS"}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
          fromId: dep.itemId,
          toId: item.id,
          kind: dep.kind === "SS" ? "SS" : "FS",
          note: dep.note,
        });
      }
    }

    return result;
  }, [dependencies, items]);

  const positionLookup = useMemo(() => {
    const map = new Map<string, PositionedItem & { left: number; width: number }>();
    for (const lane of layouts) {
      for (const item of lane.items) {
        const left = item.leftRatio * timelineWidth;
        const width = Math.max(item.widthRatio * timelineWidth, 6);
        map.set(item.item.id, { ...item, left, width });
      }
    }
    return map;
  }, [layouts, timelineWidth]);

  const conflicts = useMemo<TimelineConflict[]>(
    () => (showConflictSummary ? detectTimelineConflicts(items, { bufferHours }) : []),
    [items, bufferHours, showConflictSummary]
  );

  const conflictIndex = useMemo(() => buildConflictIndex(conflicts), [conflicts]);

  const conflictItemIds = useMemo(() => {
    return new Set(Array.from(conflictIndex.keys()));
  }, [conflictIndex]);

  const timeScale = useMemo(() => buildTimeScale(range.start, range.end), [range.start, range.end]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white/95 p-6 shadow-lg backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
          {showBufferControl ? (
            <label className="flex items-center gap-3 text-sm text-slate-600">
              Travel buffer
              <input
                type="range"
                min={0}
                max={24}
                step={1}
                value={bufferHours}
                onChange={(event) => setBufferHours(Number(event.target.value))}
              />
              <span className="w-8 text-right font-semibold text-slate-900">{bufferHours}h</span>
            </label>
          ) : null}
        </div>

        <div className="mt-6 overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[160px_1fr] gap-x-4">
              <div style={{ height: AXIS_HEIGHT }} />
              <div className="relative" style={{ height: totalHeight - AXIS_HEIGHT }}>
                <div className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50/80 backdrop-blur">
                  <div className="relative" style={{ height: AXIS_HEIGHT }} ref={timelineRef}>
                    <div className="absolute inset-x-0 bottom-0 h-full">
                      {timeScale.map((tick) => (
                        <div
                          key={tick.label + tick.leftRatio}
                          className="absolute flex translate-x-[-50%] flex-col items-center text-xs text-gray-500"
                          style={{ left: `${tick.leftRatio * 100}%` }}
                        >
                          <span className="rounded bg-white px-2 py-0.5 shadow">{tick.label}</span>
                          <span className="mt-1 h-8 w-px bg-gray-200" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="absolute inset-x-0" style={{ top: AXIS_HEIGHT, height: totalHeight - AXIS_HEIGHT }}>
                  {layouts.map((lane) => (
                    <div key={lane.name} className="absolute inset-x-0 border-b border-gray-100" style={{ top: lane.top - AXIS_HEIGHT, height: lane.height }}>
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent" />
                      <div className="relative h-full">
                        {lane.items.map((positioned) => {
                          const cardLeft = `${positioned.leftRatio * 100}%`;
                          const cardWidth = `${Math.min(100, positioned.widthRatio * 100)}%`;
                          const isConflicted = conflictItemIds.has(positioned.item.id);
                          const dependencies = extractDependencies(positioned.item);
                          return (
                            <div
                              key={positioned.item.id}
                              className={`absolute rounded border px-3 py-2 text-xs shadow-sm transition hover:shadow-md ${getTypeStyles(positioned.item.type)} ${
                                isConflicted ? "ring-2 ring-red-500" : ""
                              }`}
                              style={{
                                left: cardLeft,
                                top: positioned.top - lane.top,
                                width: cardWidth,
                                minWidth: "120px",
                                height: ITEM_HEIGHT - 8,
                              }}
                            >
                              <div className="flex items-center justify-between gap-2 text-[0.7rem] uppercase tracking-wide text-gray-500">
                                <span>{positioned.item.type}</span>
                                <span className="font-semibold text-gray-700">p{positioned.item.priority ?? 0}</span>
                              </div>
                              <p className="mt-1 text-sm font-semibold text-gray-900">{positioned.item.title}</p>
                              <p className="mt-1 text-[0.7rem] text-gray-600">
                                {new Date(positioned.item.startsAt ?? "").toLocaleString()} → {new Date(positioned.item.endsAt ?? positioned.item.startsAt ?? "").toLocaleString()}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-2 text-[0.65rem] text-gray-600">
                                <span>{positioned.item.territory ?? "No territory"}</span>
                                {dependencies.length ? <span className="rounded bg-white/70 px-2 py-0.5">{dependencies.length} deps</span> : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <svg
                    className="pointer-events-none absolute left-0 top-0 h-full w-full"
                    viewBox={`0 0 ${Math.max(timelineWidth, 1)} ${Math.max(totalHeight - AXIS_HEIGHT, 1)}`}
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <marker id="timeline-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto">
                        <path d="M0,0 L8,4 L0,8 z" className="fill-slate-400" />
                      </marker>
                    </defs>
                    {edges.map((edge) => {
                      const source = positionLookup.get(edge.fromId);
                      const target = positionLookup.get(edge.toId);
                      if (!source || !target) return null;
                      const sourceY = source.top + (source.height / 2) - AXIS_HEIGHT;
                      const targetY = target.top + (target.height / 2) - AXIS_HEIGHT;
                      const sourceX = edge.kind === "SS" ? source.left : source.left + source.width;
                      const targetX = target.left;
                      const deltaX = Math.max(32, Math.abs(targetX - sourceX) * 0.5);
                      const path = `M${sourceX},${sourceY} C${sourceX + deltaX},${sourceY} ${targetX - deltaX},${targetY} ${targetX},${targetY}`;
                      return <path key={`${edge.fromId}->${edge.toId}`} d={path} className="fill-none stroke-slate-400" strokeWidth={1.5} markerEnd="url(#timeline-arrow)" />;
                    })}
                  </svg>
                </div>
              </div>

              <div className="relative">
                <div className="sticky top-0 bg-gray-50/80 backdrop-blur" style={{ height: AXIS_HEIGHT }} />
                {layouts.map((lane) => (
                  <div key={lane.name} className="border-b border-gray-100" style={{ height: lane.height }}>
                    <div className="flex h-full items-start">
                      <div className="mt-3 text-sm font-semibold text-gray-700">{lane.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {showConflictSummary && conflicts.length ? (
          <div className="mt-5 space-y-2">
            <h4 className="text-sm font-semibold text-gray-900">Detected conflicts</h4>
            <ul className="space-y-2">
              {conflicts.map((conflict) => (
                <li
                  key={conflict.id}
                  className={`rounded border px-3 py-2 text-sm ${
                    conflict.severity === "error" ? "border-red-300 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  {conflict.message}
                </li>
              ))}
            </ul>
          </div>
        ) : showConflictSummary ? (
          <p className="mt-5 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">No conflicts detected with the current buffer.</p>
        ) : null}
      </div>

      {unscheduledItems.length ? (
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h4 className="text-sm font-semibold text-gray-900">Unscheduled items</h4>
          <ul className="mt-3 space-y-2 text-sm text-gray-600">
            {unscheduledItems.map((item) => (
              <li key={item.id} className="rounded border border-dashed border-gray-300 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-900">{item.title}</span>
                  <span className="text-xs uppercase text-gray-500">{item.type}</span>
                </div>
                <p className="text-xs text-gray-500">Assign a start to place this on the lanes.</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
