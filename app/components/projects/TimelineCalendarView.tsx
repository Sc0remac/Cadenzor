"use client";

import { Fragment, useMemo } from "react";
import type { MouseEvent } from "react";
import Link from "next/link";
import type {
  TimelineItemRecord,
  TimelineItemStatus,
  TimelineLane,
  TimelineLaneDefinition,
} from "@kazador/shared";
import { detectTimelineConflicts } from "@kazador/shared";
import type { LaneState } from "./TimelineStudio";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CalendarViewMode = "week" | "month" | "quarter";

interface TimelineCalendarViewProps {
  items: TimelineItemRecord[];
  lanes: LaneState[];
  laneDefinitions?: TimelineLaneDefinition[];
  viewMode: CalendarViewMode;
  startDate: Date;
  endDate: Date;
  onSelectItem?: (item: TimelineItemRecord) => void;
  onCreateItem?: (date: Date, lane: TimelineLane) => void;
}

interface CalendarColumn {
  id: string;
  label: string;
  subLabel?: string;
  rangeStart: Date;
  rangeEnd: Date;
  weekNumber?: number;
}

interface CalendarCellProps {
  column: CalendarColumn;
  lane: LaneState;
  items: TimelineItemRecord[];
  onSelectItem?: (item: TimelineItemRecord) => void;
  onCreateItem?: (date: Date, lane: TimelineLane) => void;
}

interface CalendarItemCardProps {
  item: TimelineItemRecord;
  conflicted: boolean;
  onSelect?: (item: TimelineItemRecord) => void;
}

export function TimelineCalendarView({
  items,
  lanes,
  laneDefinitions,
  viewMode,
  startDate,
  endDate,
  onSelectItem,
  onCreateItem,
}: TimelineCalendarViewProps) {
  const columns = useMemo(() => computeCalendarColumns(viewMode, startDate, endDate), [viewMode, startDate, endDate]);
  const laneDefinitionMap = useMemo(() => {
    const map = new Map<TimelineLane, TimelineLaneDefinition>();
    if (laneDefinitions) {
      for (const definition of laneDefinitions) {
        const key = (definition.slug || definition.id) as TimelineLane;
        map.set(key, definition);
      }
    }
    return map;
  }, [laneDefinitions]);

  const itemsByLane = useMemo(() => {
    const map = new Map<TimelineLane, TimelineItemRecord[]>();
    for (const item of items) {
      const list = map.get(item.lane) ?? [];
      list.push(item);
      map.set(item.lane, list);
    }
    for (const [, list] of map) {
      list.sort((a: TimelineItemRecord, b: TimelineItemRecord) => getItemStartMs(a) - getItemStartMs(b));
    }
    return map;
  }, [items]);

  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);

  const gridTemplate = useMemo(() => {
    const columnCount = columns.length;
    return `240px repeat(${columnCount}, minmax(190px, 1fr))`;
  }, [columns.length]);

  return (
    <div className="relative flex h-full min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 text-slate-100 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Calendar timeline</h3>
          <p className="text-xs uppercase tracking-wider text-slate-400">Double-click empty cells to add new holds or blocks</p>
        </div>
        <p className="text-xs text-slate-400">{columns.length} {viewMode === "quarter" ? "weeks" : "days"} in view</p>
      </div>

      <div className="relative flex-1 overflow-x-auto">
        <div className="min-w-max">
          <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-3 text-xs uppercase tracking-wide text-slate-400">
              Lane
            </div>
            {columns.map((column) => {
              const isTodayColumn = isTodayInColumn(column, today);
              return (
                <div
                  key={column.id}
                  className={`sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 px-4 py-3 text-sm font-medium ${
                    isTodayColumn ? "text-white" : "text-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{column.label}</span>
                    {column.weekNumber ? (
                      <span className="text-xs uppercase text-slate-500">W{column.weekNumber}</span>
                    ) : null}
                  </div>
                  {column.subLabel ? (
                    <p className="mt-1 text-xs text-slate-500">{column.subLabel}</p>
                  ) : null}
                  {isTodayColumn ? (
                    <div className="mt-2 flex items-center gap-2 text-xs font-semibold text-rose-300">
                      <span className="h-2 w-2 rounded-full bg-rose-400" />
                      Today
                    </div>
                  ) : null}
                </div>
              );
            })}

            {lanes.map((lane) => {
              const laneDefinition = laneDefinitionMap.get(lane.id) ?? null;
              const laneItems = itemsByLane.get(lane.id) ?? [];
              return (
                <Fragment key={lane.id}>
                  <LaneHeader lane={lane} laneDefinition={laneDefinition} dimmed={!lane.visible} />
                  {columns.map((column) => {
                    const columnItems = laneItems.filter((item) => itemOverlapsColumn(item, column));
                    return (
                      <CalendarCell
                        key={`${lane.id}:${column.id}`}
                        column={column}
                        lane={lane}
                        items={columnItems}
                        onSelectItem={onSelectItem}
                        onCreateItem={onCreateItem}
                      />
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarCell({ column, lane, items, onSelectItem, onCreateItem }: CalendarCellProps) {
  const conflicts = useMemo(() => (items.length > 1 ? detectTimelineConflicts(items, { bufferHours: 4 }) : []), [items]);
  const conflictItemIds = useMemo(() => new Set(conflicts.flatMap((entry) => (entry.items ?? []).map(item => typeof item === 'string' ? item : item.id))), [conflicts]);

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onCreateItem) return;
    if (event.target !== event.currentTarget) return;
    const start = new Date(column.rangeStart);
    onCreateItem(start, lane.id);
  };

  const borderClasses = conflicts.length > 0 ? "border-rose-500/60" : "border-slate-800/70";
  const hoverClasses = lane.visible ? "hover:bg-slate-900/40" : "opacity-50";

  return (
    <div
      className={`relative min-h-[9rem] border-l border-b ${borderClasses} p-3 transition ${hoverClasses}`}
      onDoubleClick={handleDoubleClick}
    >
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <CalendarItemCard
            key={item.id}
            item={item}
            conflicted={conflictItemIds.has(item.id)}
            onSelect={onSelectItem}
          />
        ))}
      </div>
      {conflicts.length > 0 ? (
        <div className="pointer-events-none mt-3 rounded-md border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-[0.7rem] text-rose-200">
          ⚠️ {conflicts[0]?.message ?? "Conflict detected"}
        </div>
      ) : null}
    </div>
  );
}

function CalendarItemCard({ item, conflicted, onSelect }: CalendarItemCardProps) {
  const statusMeta = getStatusMeta(item.status);
  const locationSummary = [item.labels?.city, item.labels?.territory].filter(Boolean).join(" · ");
  const timeSummary = formatItemTimeRange(item);

  return (
    <button
      type="button"
      onClick={() => onSelect?.(item)}
      className={`w-full rounded-2xl border-2 px-4 py-3 text-left shadow transition hover:-translate-y-0.5 hover:shadow-lg ${
        conflicted ? "border-rose-400/80 bg-rose-500/10" : "border-slate-700/70 bg-slate-900/80"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
        <span className="text-base">{statusMeta.icon}</span>
        <span className="text-xs uppercase tracking-wide text-slate-400">{statusMeta.label}</span>
        <span className="truncate text-sm font-semibold text-white">{item.title}</span>
      </div>
      {locationSummary ? <p className="mt-2 text-sm text-slate-300">📍 {locationSummary}</p> : null}
      {timeSummary ? <p className="mt-2 text-xs text-slate-400">{timeSummary}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <QuickActionButton label="Accept" tone="positive" onClick={() => onSelect?.(item)} />
        <QuickActionButton label="Info" tone="neutral" onClick={() => onSelect?.(item)} />
        <QuickActionButton label="Decline" tone="negative" onClick={() => onSelect?.(item)} />
      </div>
    </button>
  );
}

interface QuickActionButtonProps {
  label: string;
  tone: "positive" | "neutral" | "negative";
  onClick?: () => void;
}

function QuickActionButton({ label, tone, onClick }: QuickActionButtonProps) {
  const classes = {
    positive: "bg-emerald-500/80 hover:bg-emerald-500",
    neutral: "bg-slate-700/80 hover:bg-slate-600",
    negative: "bg-rose-600/80 hover:bg-rose-600",
  }[tone];
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      className={`rounded-lg px-3 py-1 text-xs font-semibold text-white shadow-sm transition ${classes}`}
    >
      {label}
    </button>
  );
}

interface LaneHeaderProps {
  lane: LaneState;
  laneDefinition: TimelineLaneDefinition | null;
  dimmed: boolean;
}

function LaneHeader({ lane, laneDefinition, dimmed }: LaneHeaderProps) {
  const autoAssignSummary = describeAutoAssignRules(laneDefinition?.autoAssignRules ?? null);
  return (
    <div
      className={`sticky left-0 flex h-full flex-col gap-2 border-r border-b border-slate-800 bg-slate-950/70 px-4 py-4 ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: lane.color }} />
        <p className="text-sm font-semibold text-white">{lane.label}</p>
      </div>
      <p className="text-xs text-slate-400">Auto-assigns: {autoAssignSummary}</p>
      <p className="text-[0.65rem] text-slate-500">Manual override: drag any item into this lane</p>
      <Link
        href="/settings/lanes"
        className="mt-auto inline-flex w-max items-center gap-1 text-xs font-semibold text-indigo-300 transition hover:text-indigo-100"
      >
        Edit rules
        <span aria-hidden>↗</span>
      </Link>
    </div>
  );
}

function computeCalendarColumns(viewMode: CalendarViewMode, startDate: Date, endDate: Date): CalendarColumn[] {
  switch (viewMode) {
    case "quarter":
      return buildQuarterColumns(startDate, endDate);
    case "month":
      return buildDailyColumns(startDate, endDate, true);
    case "week":
    default:
      return buildDailyColumns(startDate, endDate, false);
  }
}

function buildDailyColumns(startDate: Date, endDate: Date, includeWeekNumber: boolean): CalendarColumn[] {
  const columns: CalendarColumn[] = [];
  const cursor = startOfDay(startDate);
  const limit = startOfDay(addDays(endDate, 1));
  for (let current = cursor; current < limit; current = addDays(current, 1)) {
    const rangeStart = new Date(current);
    const rangeEnd = new Date(current);
    rangeEnd.setHours(23, 59, 59, 999);
    const labelFormatter = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const label = labelFormatter.format(rangeStart);
    columns.push({
      id: rangeStart.toISOString(),
      label,
      rangeStart,
      rangeEnd,
      weekNumber: includeWeekNumber ? getWeekNumber(rangeStart) : undefined,
    });
  }
  return columns;
}

function buildQuarterColumns(startDate: Date, endDate: Date): CalendarColumn[] {
  const columns: CalendarColumn[] = [];
  let current = startOfWeek(startDate);
  const limit = startOfDay(addDays(endDate, 7));
  let weekIndex = 1;
  while (current < limit && columns.length < 13) {
    const rangeStart = new Date(current);
    const rangeEnd = addDays(rangeStart, 6);
    rangeEnd.setHours(23, 59, 59, 999);
    const label = `Week ${weekIndex}`;
    const subLabel = `${formatCompactDate(rangeStart)} – ${formatCompactDate(rangeEnd)}`;
    columns.push({
      id: `${rangeStart.toISOString()}::${weekIndex}`,
      label,
      subLabel,
      rangeStart,
      rangeEnd,
      weekNumber: getWeekNumber(rangeStart),
    });
    current = addDays(current, 7);
    weekIndex += 1;
  }
  return columns;
}

function formatCompactDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function startOfDay(source: Date): Date {
  const date = new Date(source);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek(source: Date): Date {
  const date = startOfDay(source);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  return date;
}

function addDays(source: Date, days: number): Date {
  const date = new Date(source);
  date.setDate(date.getDate() + days);
  return date;
}

function isTodayInColumn(column: CalendarColumn, today: Date): boolean {
  return today >= column.rangeStart && today <= column.rangeEnd;
}

function itemOverlapsColumn(item: TimelineItemRecord, column: CalendarColumn): boolean {
  const itemStart = getItemStartMs(item);
  const itemEnd = getItemEndMs(item);
  const columnStart = column.rangeStart.getTime();
  const columnEnd = column.rangeEnd.getTime();
  return itemEnd >= columnStart && itemStart <= columnEnd;
}

function getItemStartMs(item: TimelineItemRecord): number {
  return getFirstValidTimestamp(item.startsAt, item.dueAt, item.endsAt);
}

function getItemEndMs(item: TimelineItemRecord): number {
  return getFirstValidTimestamp(item.endsAt, item.dueAt, item.startsAt);
}

function getFirstValidTimestamp(...values: Array<string | null | undefined>): number {
  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function getStatusMeta(status: TimelineItemStatus) {
  const map: Record<
    TimelineItemStatus,
    {
      icon: string;
      label: string;
    }
  > = {
    planned: { icon: "⚪", label: "Planned" },
    tentative: { icon: "🟡", label: "Tentative" },
    confirmed: { icon: "🟢", label: "Confirmed" },
    waiting: { icon: "🟠", label: "Waiting" },
    done: { icon: "✅", label: "Completed" },
    canceled: { icon: "⛔", label: "Canceled" },
  };
  return map[status] ?? { icon: "⚪", label: "Planned" };
}

function formatItemTimeRange(item: TimelineItemRecord): string {
  const start = parseDateSafe(item.startsAt);
  const end = parseDateSafe(item.endsAt) ?? parseDateSafe(item.dueAt);
  if (!start && !end) return "";
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (start && end) {
    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) {
      return `${dateFormatter.format(start)} · ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
    }
    return `${dateFormatter.format(start)} ${timeFormatter.format(start)} → ${dateFormatter.format(end)} ${timeFormatter.format(end)}`;
  }

  if (start) {
    return `${dateFormatter.format(start)} · ${timeFormatter.format(start)}`;
  }

  return `${dateFormatter.format(end!)} · ${timeFormatter.format(end!)}`;
}

function parseDateSafe(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function describeAutoAssignRules(rules: Record<string, unknown> | null): string {
  if (!rules) return "Manual only";
  const parts: string[] = [];
  for (const [key, rawValue] of Object.entries(rules)) {
    if (Array.isArray(rawValue) && rawValue.length > 0) {
      parts.push(`${formatRuleKey(key)}: ${rawValue.join(", ")}`);
    } else if (typeof rawValue === "string" && rawValue.trim().length > 0) {
      parts.push(`${formatRuleKey(key)}: ${rawValue}`);
    }
  }
  return parts.length > 0 ? parts.slice(0, 3).join(" • ") : "Manual only";
}

function formatRuleKey(key: string): string {
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
}
