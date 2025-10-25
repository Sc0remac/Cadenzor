"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type {
  TimelineDependencyRecord,
  TimelineItemRecord,
  TimelineItemStatus,
  TimelineLane,
  TimelineLaneDefinition,
} from "@kazador/shared";
import { buildConflictIndex, detectTimelineConflicts } from "@kazador/shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const ITEM_HEIGHT = 110;
const PIN_SIZE = 24;
const LANE_HEADER_HEIGHT = 52;
const LANE_PADDING_Y = 28;
const ROW_GAP = 20;
const VIRTUALIZATION_BUFFER = 640;
const MIN_BAR_WIDTH = 36;
const MIN_PIN_WIDTH = 12;
const MAX_ZOOM = 3;
const MIN_ZOOM = 0.4;

const DEFAULT_LANE_COLORS: Record<string, string> = {
  LIVE_HOLDS: "#7c3aed",
  TRAVEL: "#0284c7",
  PROMO: "#0f766e",
  RELEASE: "#f97316",
  LEGAL: "#dc2626",
  FINANCE: "#06b6d4",
};

const FALLBACK_LANE_COLOR = "#475569";

function normaliseHex(color?: string | null): string {
  if (!color) return FALLBACK_LANE_COLOR;
  let value = color.trim();
  if (!value) return FALLBACK_LANE_COLOR;
  if (!value.startsWith("#")) {
    const hexMatch = value.match(/[0-9a-fA-F]{6}/);
    if (!hexMatch) return FALLBACK_LANE_COLOR;
    value = `#${hexMatch[0]}`;
  }
  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  if (value.length >= 7) {
    return value.slice(0, 7);
  }
  return FALLBACK_LANE_COLOR;
}

function withAlpha(color: string, alpha: number): string {
  const hex = normaliseHex(color).slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

function buildLaneVisual(color?: string | null) {
  const base = normaliseHex(color);
  return {
    base,
    background: withAlpha(base, 0.12),
    accent: `linear-gradient(90deg, ${withAlpha(base, 0.4)} 0%, ${withAlpha(base, 0.08)} 65%, transparent 100%)`,
    border: withAlpha(base, 0.35),
  };
}

function extractMeetingUrlFromItem(item: TimelineItemRecord): string | null {
  const links = (item.links ?? {}) as Record<string, any>;
  const labels = (item.labels ?? {}) as Record<string, any>;
  const url = links.meetingUrl ?? labels.meetingUrl;
  return typeof url === "string" ? url : null;
}

function formatLaneLabel(slug: string): string {
  return slug
    .toLowerCase()
    .split(/[_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function alignToWeek(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

function formatCompactDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getWeekNumber(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
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

interface QuickActionButtonProps {
  label: string;
  tone: "positive" | "neutral" | "negative" | "calendar";
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}

function QuickActionButton({ label, tone, onClick, disabled }: QuickActionButtonProps) {
  let toneClass = "border-slate-600 bg-slate-700/40 text-slate-300 hover:border-slate-500 hover:bg-slate-600/60 hover:text-slate-200";
  if (tone === "positive") {
    toneClass = "border-emerald-600/60 bg-emerald-500/15 text-emerald-300 hover:border-emerald-500 hover:bg-emerald-500/30 hover:text-emerald-200";
  } else if (tone === "negative") {
    toneClass = "border-rose-600/60 bg-rose-500/15 text-rose-300 hover:border-rose-500 hover:bg-rose-500/30 hover:text-rose-200";
  } else if (tone === "calendar") {
    toneClass = "border-sky-600/60 bg-sky-500/15 text-sky-300 hover:border-sky-500 hover:bg-sky-500/30 hover:text-sky-200";
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onClick?.(event);
      }}
      className={`rounded-md border px-2.5 py-1 text-[0.65rem] font-medium uppercase tracking-wide shadow-sm transition-all ${toneClass} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {label}
    </button>
  );
}

const TYPE_COLORS: Record<
  TimelineItemRecord["type"],
  { base: string; text: string; border: string }
> = {
  LIVE_HOLD: {
    base: "bg-purple-500/15",
    text: "text-purple-100",
    border: "border-purple-400/70",
  },
  TRAVEL_SEGMENT: {
    base: "bg-sky-500/15",
    text: "text-sky-100",
    border: "border-sky-400/70",
  },
  PROMO_SLOT: {
    base: "bg-emerald-500/15",
    text: "text-emerald-100",
    border: "border-emerald-400/70",
  },
  RELEASE_MILESTONE: {
    base: "bg-amber-500/15",
    text: "text-amber-100",
    border: "border-amber-400/70",
  },
  LEGAL_ACTION: {
    base: "bg-rose-500/15",
    text: "text-rose-100",
    border: "border-rose-400/70",
  },
  FINANCE_ACTION: {
    base: "bg-cyan-500/15",
    text: "text-cyan-100",
    border: "border-cyan-400/70",
  },
  TASK: {
    base: "bg-slate-500/15",
    text: "text-slate-100",
    border: "border-slate-400/70",
  },
};

const STATUS_DECORATION: Partial<Record<TimelineItemStatus, string>> = {
  tentative: "border-dashed",
  done: "opacity-60",
  canceled: "opacity-60",
};

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

const PRIORITY_LEVELS = [
  { id: "HIGH", label: "High", min: 70, color: "bg-red-500" },
  { id: "MEDIUM", label: "Medium", min: 40, color: "bg-amber-500" },
  { id: "LOW", label: "Low", min: 0, color: "bg-emerald-500" },
];

type TimelineViewMode = "day" | "week" | "month" | "quarter";

type ContextAction = "edit_details" | "change_status" | "add_note" | "delete";

export interface LaneState {
  id: TimelineLane;
  label: string;
  color: string;
  visible: boolean;
  collapsed: boolean;
  sortOrder: number;
}

interface AxisTick {
  position: number;
  label: string;
  subLabel?: string;
  weekNumber?: number;
}

interface TimelineStudioProps {
  projectId: string;
  items: TimelineItemRecord[];
  dependencies?: TimelineDependencyRecord[];
  lanes?: LaneState[];
  laneDefinitions?: TimelineLaneDefinition[];
  viewMode: TimelineViewMode;
  startDate: Date;
  endDate: Date;
  zoom: number;
  onZoomChange?: (next: number) => void;
  onSelectItem?: (item: TimelineItemRecord) => void;
  onToggleLaneCollapse?: (lane: TimelineLane) => void;
  onContextAction?: (action: ContextAction, item: TimelineItemRecord) => void;
  onAddItem?: () => void;
  onItemUpdate?: (itemId: string, updates: Partial<TimelineItemRecord>) => Promise<void>;
  onItemDelete?: (itemId: string) => Promise<void>;
  realtimeLabel?: string;
  onCalendarUpdate?: (item: TimelineItemRecord) => void;
  calendarUpdatingId?: string | null;
}

interface PositionedItem {
  item: TimelineItemRecord;
  laneId: TimelineLane;
  isPin: boolean;
  startMs: number;
  endMs: number;
  left: number;
  width: number;
  row: number;
  height: number;
  top: number;
}

interface LaneLayout {
  lane: LaneState;
  items: PositionedItem[];
  height: number;
  rowCount: number;
  offsetTop: number;
}

interface VirtualizedLaneLayout extends LaneLayout {
  visibleItems: PositionedItem[];
}

interface HoverState {
  item: TimelineItemRecord;
  x: number;
  y: number;
}

interface ContextMenuState {
  item: TimelineItemRecord;
  x: number;
  y: number;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function toMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getPriorityMeta(score: number | null) {
  if (score == null) {
    return { id: "LOW", label: "Low", color: "bg-emerald-500" };
  }
  for (const level of PRIORITY_LEVELS) {
    if (score >= level.min) {
      return level;
    }
  }
  return PRIORITY_LEVELS[PRIORITY_LEVELS.length - 1];
}

function describeRange(viewMode: TimelineViewMode, start: Date, end: Date) {
  const startMs = start.getTime();
  let endMs = end.getTime();
  if (endMs <= startMs) {
    switch (viewMode) {
      case "day":
        endMs = startMs + DAY_MS;
        break;
      case "week":
        endMs = startMs + 7 * DAY_MS;
        break;
      case "month":
        endMs = startMs + 30 * DAY_MS;
        break;
      case "quarter":
        endMs = startMs + 13 * 7 * DAY_MS;
        break;
      default:
        endMs = startMs + 7 * DAY_MS;
    }
  }
  return { startMs, endMs };
}

function getPxPerMs(viewMode: TimelineViewMode, zoom: number): number {
  const z = clampZoom(zoom);
  switch (viewMode) {
    case "day":
      return (z * 160) / HOUR_MS;
    case "week":
      return (z * 220) / DAY_MS;
    case "month":
      return (z * 140) / DAY_MS;
    case "quarter":
      return (z * 80) / DAY_MS;
    default:
      return (z * 140) / DAY_MS;
  }
}

function getAxisTicks(viewMode: TimelineViewMode, startMs: number, endMs: number): AxisTick[] {
  if (viewMode === "day") {
    const ticks: AxisTick[] = [];
    const start = new Date(startMs);
    start.setMinutes(0, 0, 0);
    for (let ms = start.getTime(); ms <= endMs; ms += HOUR_MS) {
      const date = new Date(ms);
      ticks.push({
        position: ms,
        label: date.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        }),
      });
    }
    return ticks;
  }

  if (viewMode === "quarter") {
    const ticks: AxisTick[] = [];
    let weekIndex = 1;
    for (let ms = alignToWeek(startMs); ms <= endMs; ms += 7 * DAY_MS) {
      const start = new Date(ms);
      const end = new Date(ms + 6 * DAY_MS);
      ticks.push({
        position: start.getTime(),
        label: `Week ${weekIndex}`,
        subLabel: `${formatCompactDate(start)} – ${formatCompactDate(end)}`,
        weekNumber: getWeekNumber(start),
      });
      weekIndex += 1;
      if (weekIndex > 13) break;
    }
    return ticks;
  }

  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  const step = DAY_MS;
  const ticks: AxisTick[] = [];
  for (let ms = cursor.getTime(); ms <= endMs; ms += step) {
    const date = new Date(ms);
    const label = date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    ticks.push({
      position: ms,
      label,
      weekNumber: viewMode === "month" ? getWeekNumber(date) : undefined,
    });
  }
  return ticks;
}

function getGridlines(viewMode: TimelineViewMode, startMs: number, endMs: number) {
  const lines: number[] = [];
  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  const step = viewMode === "quarter" ? 7 * DAY_MS : DAY_MS;
  for (let ms = cursor.getTime(); ms <= endMs; ms += step) {
    lines.push(ms);
  }
  return lines;
}
function isOverdue(item: TimelineItemRecord, now = Date.now()): boolean {
  const due = toMs(item.dueAt);
  if (!due) return false;
  if (item.status === "done" || item.status === "canceled") return false;
  return due < now;
}

function hasAttachments(item: TimelineItemRecord): boolean {
  const links = item.links ?? {};
  if (Array.isArray(links.assetIds) && links.assetIds.length > 0) return true;
  if (typeof (links as any).assetId === "string") return true;
  return Boolean(links.emailId || links.threadId);
}

function formatTimeRange(item: TimelineItemRecord): string {
  const start = toMs(item.startsAt);
  const end = toMs(item.endsAt);
  const due = toMs(item.dueAt);
  if (start && end) {
    const sameDay = new Date(start).toDateString() === new Date(end).toDateString();
    const startStr = new Date(start).toLocaleString(undefined, {
      month: sameDay ? undefined : "short",
      day: sameDay ? undefined : "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const endStr = new Date(end).toLocaleString(undefined, {
      month: sameDay ? undefined : "short",
      day: sameDay ? undefined : "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `${startStr} – ${endStr}`;
  }
  if (start) {
    return new Date(start).toLocaleString();
  }
  if (due) {
    return new Date(due).toLocaleString();
  }
  return "No schedule";
}
export function TimelineStudio({
  projectId,
  items,
  dependencies = [],
  lanes,
  laneDefinitions,
  viewMode,
  startDate,
  endDate,
  zoom,
  onZoomChange,
  onSelectItem,
  onToggleLaneCollapse,
  onContextAction,
  onAddItem,
  onItemUpdate,
  onItemDelete,
  realtimeLabel,
  onCalendarUpdate,
  calendarUpdatingId,
}: TimelineStudioProps) {
  const [localItems, setLocalItems] = useState<TimelineItemRecord[]>(items);
  const [hoverState, setHoverState] = useState<HoverState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragMessage, setDragMessage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1200);
  const dragRef = useRef<
    | {
        id: string;
        mode: "move" | "resize-start" | "resize-end";
        startMs: number;
        endMs: number;
        pointerStartX: number;
      }
    | null
  >(null);

  const { startMs, endMs } = useMemo(() => describeRange(viewMode, startDate, endDate), [
    viewMode,
    startDate,
    endDate,
  ]);

  const handleZoom = useCallback(
    (delta: number, cursorX?: number) => {
      if (!onZoomChange || !scrollRef.current) return;
      const container = scrollRef.current;
      const previousPxPerMs = getPxPerMs(viewMode, zoom);
      const nextZoom = clampZoom(zoom + delta);
      if (nextZoom === zoom) return;

      // If cursorX is provided, zoom centered on cursor; otherwise use viewport center
      const focusX = cursorX !== undefined ? cursorX - container.getBoundingClientRect().left : container.clientWidth / 2;
      const centerMs = startMs + (container.scrollLeft + focusX) / previousPxPerMs;

      onZoomChange(nextZoom);

      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) return;
        const nextPxPerMs = getPxPerMs(viewMode, nextZoom);
        const nextScrollLeft = (centerMs - startMs) * nextPxPerMs - focusX;
        node.scrollLeft = Math.max(0, nextScrollLeft);
      });
    },
    [onZoomChange, startMs, viewMode, zoom]
  );

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.15 : 0.15;
      handleZoom(delta, event.clientX);
    },
    [handleZoom]
  );

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const handleScroll = () => {
      setScrollLeft(node.scrollLeft);
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === node) {
          setViewportWidth(entry.contentRect.width);
        }
      }
    });

    handleScroll();
    setViewportWidth(node.clientWidth);
    node.addEventListener("scroll", handleScroll, { passive: true });
    node.addEventListener("wheel", handleWheel as any, { passive: false });
    resizeObserver.observe(node);

    return () => {
      node.removeEventListener("scroll", handleScroll);
      node.removeEventListener("wheel", handleWheel as any);
      resizeObserver.disconnect();
    };
  }, [handleWheel]);

  useEffect(() => {
    const closeContextMenu = () => setContextMenu(null);
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("contextmenu", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("contextmenu", closeContextMenu);
    };
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = event.clientX - drag.pointerStartX;
      const deltaMs = deltaX / getPxPerMs(viewMode, zoom);
      setLocalItems((previous) => {
        return previous.map((item) => {
          if (item.id !== drag.id) return item;
          const originalStart = drag.startMs;
          const originalEnd = drag.endMs;
          let nextStart = originalStart;
          let nextEnd = originalEnd;
          if (drag.mode === "move") {
            nextStart = originalStart + deltaMs;
            nextEnd = originalEnd + deltaMs;
          } else if (drag.mode === "resize-start") {
            nextStart = Math.min(originalEnd - MINUTE_MS * 30, originalStart + deltaMs);
          } else {
            nextEnd = Math.max(originalStart + MINUTE_MS * 30, originalEnd + deltaMs);
          }
          return {
            ...item,
            startsAt: new Date(nextStart).toISOString(),
            endsAt: new Date(nextEnd).toISOString(),
          };
        });
      });
    };

    const handlePointerUp = async () => {
      if (!dragRef.current) return;
      const dragData = dragRef.current;
      dragRef.current = null;
      setDragMessage(null);

      // Find the updated item and persist to API
      const updatedItem = localItems.find((item) => item.id === dragData.id);
      if (updatedItem && onItemUpdate) {
        try {
          await onItemUpdate(updatedItem.id, {
            startsAt: updatedItem.startsAt,
            endsAt: updatedItem.endsAt,
          });
        } catch (error) {
          console.error("Failed to persist timeline item update:", error);
          setDragMessage("⚠ Failed to save changes");
          // Revert to original items on error
          setLocalItems(items);
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [viewMode, zoom, localItems, items, onItemUpdate]);

  const pxPerMs = useMemo(() => getPxPerMs(viewMode, zoom), [viewMode, zoom]);
  const timelineWidth = Math.max((endMs - startMs) * pxPerMs, viewportWidth);
  const axisTicks = useMemo(() => getAxisTicks(viewMode, startMs, endMs), [viewMode, startMs, endMs]);
  const gridlines = useMemo(() => getGridlines(viewMode, startMs, endMs), [startMs, endMs, viewMode]);
  const today = Date.now();
  const todayPosition = today >= startMs && today <= endMs ? (today - startMs) * pxPerMs : null;

  const laneMetadata = useMemo(() => {
    if (laneDefinitions && laneDefinitions.length) {
      return [...laneDefinitions]
        .map((lane, index) => {
          const slug = lane.slug || lane.id;
          const defaultColor = DEFAULT_LANE_COLORS[slug] ?? FALLBACK_LANE_COLOR;
          return {
            id: slug as TimelineLane,
            label: lane.name || formatLaneLabel(slug),
            color: normaliseHex(lane.color ?? defaultColor),
            sortOrder: lane.sortOrder ?? index * 100,
          };
        })
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.label.localeCompare(b.label);
        });
    }
    return Object.entries(DEFAULT_LANE_COLORS).map(([slug, color], index) => ({
      id: slug as TimelineLane,
      label: formatLaneLabel(slug),
      color: normaliseHex(color),
      sortOrder: index * 100,
    }));
  }, [laneDefinitions]);

  const laneStateList: LaneState[] = useMemo(() => {
    if (lanes && lanes.length) {
      return lanes
        .map((lane) => {
          const meta = laneMetadata.find((entry) => entry.id === lane.id) ?? {
            id: lane.id,
            label: formatLaneLabel(String(lane.id)),
            color: normaliseHex(DEFAULT_LANE_COLORS[String(lane.id)] ?? FALLBACK_LANE_COLOR),
            sortOrder: 9999,
          };
          return {
            ...lane,
            label: meta.label,
            color: meta.color,
            sortOrder: meta.sortOrder,
          };
        })
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.label.localeCompare(b.label);
        });
    }
    return laneMetadata.map((lane) => ({
      id: lane.id,
      label: lane.label,
      color: lane.color,
      visible: true,
      collapsed: false,
      sortOrder: lane.sortOrder,
    }));
  }, [lanes, laneMetadata]);
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
  const positionedLayouts = useMemo<LaneLayout[]>(() => {
    let offset = 0;
    const layouts: LaneLayout[] = [];

    for (const lane of laneStateList) {
      const laneItems = localItems.filter((item) => item.lane === lane.id);
      const sorted = laneItems
        .map((item) => {
          const start = toMs(item.startsAt) ?? toMs(item.dueAt);
          const end = toMs(item.endsAt) ?? toMs(item.dueAt) ?? toMs(item.startsAt);
          if (!start && !end) return null;
          const startTime = start ?? end ?? startMs;
          const endTime = end ?? startTime;
          const duration = Math.max(endTime - startTime, 0);
          const isPin = duration < MINUTE_MS * 45;
          const safeEnd = isPin ? startTime + MINUTE_MS * 45 : Math.max(endTime, startTime + MINUTE_MS * 30);
          return {
            item,
            startMs: startTime,
            endMs: safeEnd,
            isPin,
          };
        })
        .filter((value): value is { item: TimelineItemRecord; startMs: number; endMs: number; isPin: boolean } => Boolean(value))
        .sort((a, b) => a.startMs - b.startMs);

      const rowEndTimes: number[] = [];
      const positioned: PositionedItem[] = sorted.map((entry) => {
        // Calculate zoom-aware minimum gap to prevent visual overlap
        // At month view, we need MORE separation; at day view, we need LESS
        // minVisualGapPx accounts for: card shadow + padding + comfortable visual gap
        const minVisualGapPx = 80; // Increased to prevent overlap at all zoom levels
        const minTimeGapMs = minVisualGapPx / pxPerMs;

        // Use whichever is LARGER: the pixel-based gap or a baseline time gap
        // This ensures proper spacing at both zoomed-in and zoomed-out views
        const effectiveGapMs = Math.max(HOUR_MS * 0.5, minTimeGapMs);

        let rowIndex = rowEndTimes.findIndex((endTime) => endTime <= entry.startMs - effectiveGapMs);
        if (rowIndex === -1) {
          rowIndex = rowEndTimes.length;
          rowEndTimes.push(entry.endMs);
        } else {
          rowEndTimes[rowIndex] = Math.max(rowEndTimes[rowIndex], entry.endMs);
        }
        const left = (entry.startMs - startMs) * pxPerMs;
        const rawWidth = (entry.endMs - entry.startMs) * pxPerMs;
        const width = entry.isPin ? Math.max(MIN_PIN_WIDTH, rawWidth) : Math.max(MIN_BAR_WIDTH, rawWidth);
        const height = entry.isPin ? PIN_SIZE : ITEM_HEIGHT;
        return {
          item: entry.item,
          laneId: entry.item.lane,
          isPin: entry.isPin,
          startMs: entry.startMs,
          endMs: entry.endMs,
          left,
          width,
          row: rowIndex,
          height,
          top: LANE_PADDING_Y + rowIndex * (ITEM_HEIGHT + ROW_GAP),
        } satisfies PositionedItem;
      });

      const rowCount = lane.collapsed ? 0 : Math.max(1, rowEndTimes.length || (positioned.length ? 1 : 0));
      const height = lane.collapsed
        ? LANE_HEADER_HEIGHT
        : LANE_PADDING_Y * 2 + rowCount * ITEM_HEIGHT + Math.max(0, rowCount - 1) * ROW_GAP;

      layouts.push({
        lane,
        items: positioned,
        height,
        rowCount,
        offsetTop: offset,
      });
      offset += height;
    }

    return layouts;
  }, [laneStateList, localItems, pxPerMs, startMs]);

  const laneCount = laneStateList.length;

  const totalHeight = useMemo(() => {
    if (!positionedLayouts.length) return Math.max(laneCount, 1) * LANE_HEADER_HEIGHT;
    const last = positionedLayouts[positionedLayouts.length - 1];
    return last.offsetTop + last.height;
  }, [positionedLayouts, laneCount]);

  const conflictIndex = useMemo(() => {
    const conflicts = detectTimelineConflicts(localItems, {
      bufferHours: 4,
      enableTravelTimeDetection: true,
      enableTimezoneWarnings: true,
    });
    return buildConflictIndex(conflicts);
  }, [localItems]);

  useEffect(() => {
    const inConflict = Array.from(conflictIndex.keys());
    if (inConflict.length > 0) {
      setDragMessage(`⚠ ${inConflict.length} conflict${inConflict.length > 1 ? 's' : ''} detected. Hover over items for details.`);
    } else {
      setDragMessage((prev) => (prev?.includes("conflict") ? null : prev));
    }
  }, [conflictIndex]);

  const virtualizedLayouts = useMemo<VirtualizedLaneLayout[]>(() => {
    const minX = scrollLeft - VIRTUALIZATION_BUFFER;
    const maxX = scrollLeft + viewportWidth + VIRTUALIZATION_BUFFER;
    return positionedLayouts.map((layout) => {
      if (layout.lane.collapsed) {
        return { ...layout, visibleItems: [] };
      }
      const visibleItems = layout.items.filter((item) => {
        const left = item.left;
        const width = item.width;
        return left + width >= minX && left <= maxX;
      });
      return { ...layout, visibleItems };
    });
  }, [positionedLayouts, scrollLeft, viewportWidth]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, item: TimelineItemRecord) => {
      event.preventDefault();
      setContextMenu({
        item,
        x: event.clientX,
        y: event.clientY,
      });
    },
    []
  );

  const handleDragStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, mode: "move" | "resize-start" | "resize-end", positioned: PositionedItem) => {
      event.stopPropagation();
      dragRef.current = {
        id: positioned.item.id,
        mode,
        startMs: positioned.startMs,
        endMs: positioned.endMs,
        pointerStartX: event.clientX,
      };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      setDragMessage(mode === "move" ? "Drag to reschedule" : "Drag to resize");
    },
    []
  );
  const positionLookup = useMemo(() => {
    const map = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const layout of positionedLayouts) {
      if (layout.lane.collapsed) continue;
      for (const item of layout.items) {
        map.set(item.item.id, {
          x: item.left,
          y: layout.offsetTop + item.top,
          width: item.width,
          height: item.height,
        });
      }
    }
    return map;
  }, [positionedLayouts]);

  const dependencyEdges = useMemo(() => {
    const edges: Array<{ from: string; to: string; kind: string }> = [];
    for (const dependency of dependencies) {
      if (!dependency.fromItemId || !dependency.toItemId) continue;
      if (!positionLookup.has(dependency.fromItemId) || !positionLookup.has(dependency.toItemId)) continue;
      edges.push({
        from: dependency.fromItemId,
        to: dependency.toItemId,
        kind: dependency.kind ?? "FS",
      });
    }
    return edges;
  }, [dependencies, positionLookup]);

  const renderItem = useCallback(
    (positioned: PositionedItem, laneActive: boolean) => {
      const { item } = positioned;
      const typeStyle = TYPE_COLORS[item.type];
      const statusDecoration = STATUS_DECORATION[item.status];
      const priorityMeta = getPriorityMeta(item.priorityScore);
      const conflicted = conflictIndex.has(item.id);
      const conflictDetails = conflictIndex.get(item.id);
      const conflictMessage = conflictDetails?.[0]?.message;
      const overdue = isOverdue(item);
      const attachments = hasAttachments(item);
      const statusMeta = getStatusMeta(item.status);
      const locationSummary = [item.labels?.city, item.labels?.territory].filter(Boolean).join(" · ");
      const priorityBadgeClass =
        priorityMeta.id === "HIGH"
          ? "border-rose-400/80 bg-rose-500/20 text-rose-100"
          : priorityMeta.id === "MEDIUM"
          ? "border-amber-400/70 bg-amber-500/20 text-amber-100"
          : "border-emerald-400/70 bg-emerald-500/15 text-emerald-100";
      const isCalendarEvent = Boolean((item.links as Record<string, any>)?.calendarId);
      const meetingUrl = isCalendarEvent ? extractMeetingUrlFromItem(item) : null;
      const calendarSyncedAtRaw = isCalendarEvent ? (item.links as Record<string, any>)?.calendarSyncedAt : null;
      const calendarSyncedLabel =
        typeof calendarSyncedAtRaw === "string" && calendarSyncedAtRaw
          ? new Date(calendarSyncedAtRaw).toLocaleString()
          : null;

      // Compact padding for month/quarter view, full padding for day/week
      const isCompactView = viewMode === "month" || viewMode === "quarter";
      const paddingClass = isCompactView ? "px-2.5 py-2" : "px-3.5 pb-6 pt-3.5";

      const classes = [
        "group absolute rounded-xl border text-sm shadow-lg transition-all duration-200 backdrop-blur-sm hover:shadow-xl",
        paddingClass,
        typeStyle.base,
        typeStyle.text,
        typeStyle.border,
        statusDecoration ?? "",
        conflicted ? "ring-1 ring-rose-500/60 border-rose-500/40" : "",
        overdue ? "shadow-[0_0_18px_rgba(248,113,113,0.45)]" : "",
        positioned.isPin ? "flex items-center gap-3" : "flex flex-col",
        laneActive ? "" : "opacity-55",
        isCalendarEvent ? "ring-1 ring-sky-500/40" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const style: CSSProperties = {
        left: positioned.left,
        top: positioned.top,
        width: positioned.width,
        height: positioned.height,
      };
      const timeSummary = formatTimeRange(item);

      const handleQuickAction = () => {
        onSelectItem?.(item);
      };

      return (
        <div
          key={item.id}
          className={classes}
          style={style}
          onMouseEnter={(event) => {
            const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
            setHoverState({ item, x: rect.left + rect.width / 2, y: rect.top });
          }}
          onMouseLeave={() => setHoverState(null)}
          onClick={() => onSelectItem?.(item)}
          onContextMenu={(event) => handleContextMenu(event, item)}
        >
          <div className="pointer-events-none absolute inset-y-1 left-1 w-1 rounded bg-gradient-to-b from-slate-50/80 to-slate-50/30" style={{ backgroundColor: undefined }} />
          <div
            className={`pointer-events-none absolute inset-y-1 left-1 w-1 rounded ${priorityMeta.color}`}
            aria-hidden
          />
          {positioned.isPin ? (
            <div className="flex w-full items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-200">
                <span className="text-base">{statusMeta.icon}</span>
                <span>{statusMeta.label}</span>
                {isCalendarEvent ? <span className="rounded bg-sky-500/20 px-2 py-0.5 text-[0.6rem] font-semibold text-sky-100">Calendar</span> : null}
              </div>
              <div className="flex flex-col items-end">
                <span className="truncate text-sm font-semibold text-white">{item.title}</span>
                {timeSummary ? <span className="text-[0.65rem] text-slate-300">{timeSummary}</span> : null}
              </div>
            </div>
          ) : viewMode === "month" || viewMode === "quarter" ? (
            // COMPACT VIEW for month/quarter: minimal info for quick scanning
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-1 items-center gap-2">
                  <span className="text-base">{statusMeta.icon}</span>
                  <h4 className="truncate text-[0.9rem] font-bold text-white">{item.title}</h4>
                </div>
                {conflicted && conflictDetails && conflictDetails.length > 0 ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/25 text-[0.65rem] font-bold text-rose-300 ring-1 ring-rose-500/50">
                    {conflictDetails.length}
                  </span>
                ) : null}
              </div>
              {locationSummary ? (
                <p className="mt-1.5 truncate text-[0.7rem] text-slate-400">
                  📍 {locationSummary}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="flex items-center gap-2.5 text-[0.7rem] uppercase tracking-wider text-slate-400">
                    <span className="text-lg">{statusMeta.icon}</span>
                    <span className="font-medium">{statusMeta.label}</span>
                    <span className="text-[0.6rem] text-slate-500">·</span>
                    <span className="text-[0.6rem] text-slate-500">{item.type.replace(/_/g, " ")}</span>
                    {isCalendarEvent ? (
                      <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[0.6rem] font-semibold text-sky-100">
                        Calendar
                      </span>
                    ) : null}
                  </div>
                  <h4 className="text-[0.95rem] font-bold leading-snug text-white">{item.title}</h4>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-wide ${priorityBadgeClass}`}>
                  {priorityMeta.label}
                </span>
              </div>
              {meetingUrl ? (
                <div className="mt-2">
                  <a
                    href={meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center gap-1 rounded bg-sky-500 px-2 py-1 text-[0.7rem] font-semibold text-white transition hover:bg-sky-400"
                  >
                    Join meeting
                    <span aria-hidden>↗</span>
                  </a>
                </div>
              ) : null}
              {isCalendarEvent ? (
                <p className="mt-2 text-[0.65rem] text-slate-500">
                  {calendarSyncedLabel ? `Synced ${calendarSyncedLabel}` : "Not synced yet"}
                </p>
              ) : null}
              {locationSummary ? (
                <p className="mt-2.5 flex items-center gap-1.5 text-[0.75rem] font-medium text-slate-300">
                  <span className="text-slate-500">📍</span>
                  <span>{locationSummary}</span>
                </p>
              ) : null}
              {timeSummary ? <p className="mt-1 text-[0.7rem] text-slate-500">{timeSummary}</p> : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[0.7rem] text-slate-400">
                {attachments ? <span className="flex items-center gap-1.5"><span className="text-slate-500">📎</span><span>Files</span></span> : null}
                {item.labels?.artist ? <span className="flex items-center gap-1.5"><span className="text-slate-500">🎤</span><span>{item.labels.artist}</span></span> : null}
                {item.labels?.venue ? <span className="font-medium text-slate-300">{item.labels.venue}</span> : null}
              </div>
              {conflicted && conflictDetails && conflictDetails.length > 0 ? (
                <div className="group/conflict relative mt-2">
                  <div className="flex items-center gap-1.5 text-[0.7rem]">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 ring-1 ring-rose-500/40">
                      ⚠
                    </span>
                    <span className="font-medium text-rose-300">
                      {conflictDetails.length} conflict{conflictDetails.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="invisible absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-sm group-hover/conflict:visible">
                    <div className="space-y-2">
                      {conflictDetails.map((conflict, idx) => {
                        const iconColor = conflict.severity === "error" ? "text-rose-400" : "text-amber-400";
                        return (
                          <div key={idx} className="border-b border-slate-700/50 pb-2 last:border-0 last:pb-0">
                            <div className={`mb-1 flex items-start gap-2 text-[0.7rem] font-semibold ${iconColor}`}>
                              <span className="mt-0.5">⚠</span>
                              <span className="flex-1">{conflict.type?.replace(/_/g, " ").toUpperCase() || "CONFLICT"}</span>
                            </div>
                            <p className="text-[0.65rem] leading-relaxed text-slate-300">
                              {conflict.message}
                            </p>
                            {conflict.metadata && (
                              <div className="mt-1.5 space-y-0.5 text-[0.6rem] text-slate-400">
                                {conflict.metadata.fromCity && conflict.metadata.toCity && (
                                  <div className="flex items-center gap-1">
                                    <span className="text-slate-500">→</span>
                                    <span>{conflict.metadata.fromCity} → {conflict.metadata.toCity}</span>
                                  </div>
                                )}
                                {conflict.metadata.requiredBufferHours != null && conflict.metadata.availableBufferHours != null && (
                                  <div className="flex gap-3">
                                    <span>Required: <strong className="text-rose-400">{conflict.metadata.requiredBufferHours}h</strong></span>
                                    <span>Available: <strong className="text-amber-400">{conflict.metadata.availableBufferHours.toFixed(1)}h</strong></span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
              {/* Only show action buttons in day/week view */}
              {viewMode !== "month" && viewMode !== "quarter" ? (
                <div className="mt-3 flex flex-wrap gap-2 text-[0.7rem] opacity-0 transition-opacity group-hover:opacity-100">
                  <QuickActionButton label="Accept" tone="positive" onClick={handleQuickAction} />
                  <QuickActionButton label="Info" tone="neutral" onClick={handleQuickAction} />
                  <QuickActionButton label="Decline" tone="negative" onClick={handleQuickAction} />
                  {isCalendarEvent && onCalendarUpdate ? (
                    <QuickActionButton
                      label={calendarUpdatingId === item.id ? "Updating…" : "Update calendar"}
                      tone="calendar"
                      onClick={() => onCalendarUpdate(item)}
                      disabled={calendarUpdatingId === item.id}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {!positioned.isPin ? (
            <div className="absolute inset-x-0 bottom-0 flex justify-between px-2 pb-1.5 text-[0.7rem] opacity-0 transition-opacity group-hover:opacity-100">
              <div
                className="cursor-ew-resize rounded-md bg-slate-800/60 px-2 py-0.5 text-slate-400 backdrop-blur-sm transition-colors hover:bg-slate-700 hover:text-slate-200"
                onPointerDown={(event) => handleDragStart(event, "resize-start", positioned)}
              >
                ⇠
              </div>
              <div
                className="cursor-grab rounded-md bg-slate-800/60 px-2 py-0.5 text-slate-400 backdrop-blur-sm transition-colors hover:bg-slate-700 hover:text-slate-200 active:cursor-grabbing"
                onPointerDown={(event) => handleDragStart(event, "move", positioned)}
              >
                ↔
              </div>
              <div
                className="cursor-ew-resize rounded-md bg-slate-800/60 px-2 py-0.5 text-slate-400 backdrop-blur-sm transition-colors hover:bg-slate-700 hover:text-slate-200"
                onPointerDown={(event) => handleDragStart(event, "resize-end", positioned)}
              >
                ⇢
              </div>
            </div>
          ) : null}
        </div>
      );
    },
    [conflictIndex, handleContextMenu, handleDragStart, onSelectItem, viewMode]
  );
  return (
    <div className="relative flex h-full min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 text-slate-100 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Operational timeline</h3>
          <p className="text-xs uppercase tracking-wider text-slate-400">
            {realtimeLabel ?? "Synced live • drag, zoom, filter"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleZoom(-0.15)}
            className="h-9 w-9 rounded-full border border-slate-700 bg-slate-900 text-lg font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
            aria-label="Zoom out"
          >
            –
          </button>
          <button
            type="button"
            onClick={() => handleZoom(0.15)}
            className="h-9 w-9 rounded-full border border-slate-700 bg-slate-900 text-lg font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[220px_1fr] overflow-hidden">
        <div className="relative border-r border-slate-800 bg-slate-950/60">
          <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-4 py-3 text-xs uppercase tracking-wide text-slate-400">
            Lanes
          </div>
          <div className="relative" style={{ height: totalHeight }}>
            {positionedLayouts.map((layout) => {
              const visuals = buildLaneVisual(layout.lane.color);
              const dimmed = !layout.lane.visible;
              const definition = laneDefinitionMap.get(layout.lane.id) ?? null;
              const autoAssignSummary = describeAutoAssignRules(definition?.autoAssignRules ?? null);
              return (
                <div
                  key={layout.lane.id}
                  className={`flex h-full flex-col justify-between border-b px-4 transition ${dimmed ? "opacity-50" : ""}`}
                  style={{
                    height: layout.height,
                    borderColor: visuals.border,
                    background: layout.lane.collapsed ? "transparent" : withAlpha(visuals.base, 0.08),
                  }}
                >
                  <div className="py-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: visuals.base }}
                      />
                      <p className="text-sm font-semibold text-white">{layout.lane.label}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {layout.rowCount > 0 ? `${layout.items.length} scheduled` : "Collapsed"}
                    </p>
                    <p className="mt-2 text-[0.65rem] text-slate-500">Auto-assigns: {autoAssignSummary}</p>
                    <p className="mt-1 text-[0.65rem] text-slate-500">Manual override: drag any item into this lane.</p>
                  </div>
                  <div className="mb-4 flex items-center justify-between gap-2 text-xs">
                    <Link
                      href="/settings/lanes"
                      className="inline-flex items-center gap-1 text-indigo-300 transition hover:text-indigo-100"
                    >
                      Edit rules
                      <span aria-hidden>↗</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => onToggleLaneCollapse?.(layout.lane.id)}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
                    >
                      {layout.lane.collapsed ? "Expand" : "Collapse"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative">
          <div ref={scrollRef} className="h-full overflow-x-auto overflow-y-hidden">
            <div className="relative" style={{ width: timelineWidth }}>
              <div className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90">
                <div className="relative h-14">
                  <div className="absolute inset-x-0 bottom-0 h-10">
                    {axisTicks.map((tick) => {
                      const left = (tick.position - startMs) * pxPerMs;
                      return (
                        <div
                          key={tick.position}
                          className="absolute -translate-x-1/2 text-sm text-slate-200"
                          style={{ left }}
                        >
                          <div className="flex flex-col items-center gap-1 rounded bg-slate-900/85 px-3 py-1.5 shadow">
                            <span className="font-medium">{tick.label}</span>
                            {tick.subLabel ? (
                              <span className="text-xs text-slate-400">{tick.subLabel}</span>
                            ) : null}
                            {tick.weekNumber && viewMode !== "week" ? (
                              <span className="text-[0.65rem] uppercase tracking-wide text-slate-500">
                                W{tick.weekNumber}
                              </span>
                            ) : null}
                          </div>
                          <span className="mt-2 block h-6 w-px bg-slate-700/60" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="relative" style={{ height: totalHeight }}>
                <div className="pointer-events-none absolute inset-0">
                  {gridlines.map((line) => {
                    const left = (line - startMs) * pxPerMs;
                    return (
                      <div
                        key={line}
                        className="absolute inset-y-0 w-px bg-slate-800/60"
                        style={{ left }}
                      />
                    );
                  })}
                  {todayPosition != null ? (
                    <>
                      <div
                        className="absolute inset-y-0 w-1 bg-red-500/90 shadow-[0_0_12px_rgba(248,113,113,0.6)]"
                        style={{ left: todayPosition }}
                      />
                      <div
                        className="absolute top-0 -translate-x-1/2"
                        style={{ left: todayPosition }}
                      >
                        <span className="pointer-events-none rounded-b-full bg-red-500 px-3 py-1 text-xs font-semibold text-white shadow">
                          TODAY
                        </span>
                      </div>
                    </>
                  ) : null}
                </div>

                {positionedLayouts.map((layout) => {
                  const visuals = buildLaneVisual(layout.lane.color);
                  const dimmed = !layout.lane.visible;
                  return (
                    <div
                      key={layout.lane.id}
                      className="absolute inset-x-0 transition"
                      style={{
                        top: layout.offsetTop,
                        height: layout.height,
                        background: visuals.background,
                        opacity: dimmed ? 0.45 : 1,
                      }}
                    >
                      <div
                        className="pointer-events-none absolute inset-x-0 top-0 h-1"
                        style={{ background: visuals.accent }}
                        aria-hidden
                      />
                      <div
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
                        style={{ backgroundColor: visuals.border }}
                      />
                    </div>
                  );
                })}

                {virtualizedLayouts.map((layout) => {
                  if (!layout.visibleItems || layout.visibleItems.length === 0) {
                    return null;
                  }
                  return (
                    <div
                      key={layout.lane.id}
                      className="absolute"
                      style={{ top: layout.offsetTop, height: layout.height, insetInline: 0 }}
                    >
                      {layout.visibleItems.map((positioned) => renderItem(positioned, layout.lane.visible))}
                    </div>
                  );
                })}

                <svg
                  className="pointer-events-none absolute left-0 top-0 h-full w-full"
                  viewBox={`0 0 ${Math.max(timelineWidth, 1)} ${Math.max(totalHeight, 1)}`}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <marker
                      id="timeline-arrow"
                      viewBox="0 0 8 8"
                      refX="8"
                      refY="4"
                      markerWidth="8"
                      markerHeight="8"
                      orient="auto"
                    >
                      <path d="M0,0 L8,4 L0,8 z" className="fill-slate-500" />
                    </marker>
                  </defs>
                  {dependencyEdges.map((edge) => {
                    const from = positionLookup.get(edge.from);
                    const to = positionLookup.get(edge.to);
                    if (!from || !to) return null;
                    const startX = edge.kind === "SS" ? from.x : from.x + from.width;
                    const startY = from.y + from.height / 2;
                    const endX = to.x;
                    const endY = to.y + to.height / 2;
                    const deltaX = Math.max(48, Math.abs(endX - startX) * 0.4);
                    const path = `M${startX},${startY} C${startX + deltaX},${startY} ${endX - deltaX},${endY} ${endX},${endY}`;
                    return <path key={`${edge.from}->${edge.to}`} d={path} className="fill-none stroke-slate-500/70" strokeWidth={1.5} markerEnd="url(#timeline-arrow)" />;
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onAddItem}
        className="group absolute bottom-6 right-6 flex h-12 items-center gap-2 rounded-full bg-indigo-500 px-5 text-sm font-semibold text-white shadow-lg transition hover:bg-indigo-400"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-lg">+</span>
        Add item
      </button>

      {dragMessage ? (
        <div className="pointer-events-none absolute bottom-4 left-6 rounded-lg border border-slate-700 bg-slate-900/90 px-4 py-2 text-xs text-slate-200 shadow-lg">
          {dragMessage}
        </div>
      ) : null}

      {hoverState ? (
        <div
          className="pointer-events-none fixed z-40 max-w-xs rounded-lg border border-slate-700 bg-slate-900/95 px-4 py-3 text-xs text-slate-100 shadow-xl"
          style={{
            left: hoverState.x,
            top: Math.max(hoverState.y - 12, 80),
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="text-sm font-semibold text-white">{hoverState.item.title}</p>
          <p className="mt-1 text-[0.65rem] uppercase text-slate-400">{hoverState.item.type.replace(/_/g, " ")}</p>
          <p className="mt-2 text-xs text-slate-200">{formatTimeRange(hoverState.item)}</p>
          {hoverState.item.labels?.city ? (
            <p className="mt-1 text-xs text-slate-400">{hoverState.item.labels.city}</p>
          ) : null}
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="fixed z-50 w-56 rounded-lg border border-slate-700 bg-slate-900/95 py-2 text-sm text-slate-100 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-800"
            onClick={() => {
              onContextAction?.("edit_details", contextMenu.item);
              setContextMenu(null);
            }}
          >
            <span className="text-base">✏️</span>
            <span>Edit Details</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-800"
            onClick={() => {
              onContextAction?.("change_status", contextMenu.item);
              setContextMenu(null);
            }}
          >
            <span className="text-base">🔄</span>
            <span>Change Status</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-800"
            onClick={() => {
              onContextAction?.("add_note", contextMenu.item);
              setContextMenu(null);
            }}
          >
            <span className="text-base">📝</span>
            <span>Add Note</span>
          </button>
          <div className="my-1 h-px bg-slate-700" />
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-2 text-left text-rose-400 hover:bg-slate-800"
            onClick={async () => {
              if (confirm(`Delete "${contextMenu.item.title}"?`)) {
                setContextMenu(null);
                if (onItemDelete) {
                  try {
                    await onItemDelete(contextMenu.item.id);
                  } catch (error) {
                    console.error("Failed to delete item:", error);
                    setDragMessage("⚠ Failed to delete item");
                  }
                }
              }
            }}
          >
            <span className="text-base">🗑️</span>
            <span>Delete</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
