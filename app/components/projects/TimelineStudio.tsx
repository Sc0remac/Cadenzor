"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
const ITEM_HEIGHT = 52;
const PIN_SIZE = 18;
const LANE_HEADER_HEIGHT = 48;
const LANE_PADDING_Y = 18;
const ROW_GAP = 12;
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

function formatLaneLabel(slug: string): string {
  return slug
    .toLowerCase()
    .split(/[_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
};

const STATUS_DECORATION: Partial<Record<TimelineItemStatus, string>> = {
  tentative: "border-dashed",
  done: "opacity-60",
  canceled: "opacity-60",
};

const PRIORITY_LEVELS = [
  { id: "HIGH", label: "High", min: 70, color: "bg-red-500" },
  { id: "MEDIUM", label: "Medium", min: 40, color: "bg-amber-500" },
  { id: "LOW", label: "Low", min: 0, color: "bg-emerald-500" },
];

type TimelineViewMode = "day" | "week" | "month" | "quarter";

type ContextAction = "edit" | "attach" | "convert";

interface LaneState {
  id: TimelineLane;
  label: string;
  color: string;
  visible: boolean;
  collapsed: boolean;
  sortOrder: number;
}

interface TimelineStudioProps {
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
  realtimeLabel?: string;
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
        endMs = startMs + 90 * DAY_MS;
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

function getAxisTicks(viewMode: TimelineViewMode, startMs: number, endMs: number) {
  const ticks: Array<{ position: number; label: string }> = [];
  if (viewMode === "day") {
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

  const cursor = new Date(startMs);
  cursor.setHours(0, 0, 0, 0);
  let step = 7 * DAY_MS;
  if (viewMode === "week") step = DAY_MS;
  if (viewMode === "quarter") step = 14 * DAY_MS;
  for (let ms = cursor.getTime(); ms <= endMs; ms += step) {
    const date = new Date(ms);
    const labelOptions =
      viewMode === "week"
        ? { weekday: "short", month: "short", day: "numeric" }
        : viewMode === "quarter"
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric" };
    ticks.push({ position: ms, label: date.toLocaleDateString(undefined, labelOptions) });
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
  realtimeLabel,
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
    resizeObserver.observe(node);

    return () => {
      node.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

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

    const handlePointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragMessage(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [viewMode, zoom]);

  const { startMs, endMs } = useMemo(() => describeRange(viewMode, startDate, endDate), [
    viewMode,
    startDate,
    endDate,
  ]);
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
  const positionedLayouts = useMemo<LaneLayout[]>(() => {
    let offset = 0;
    const layouts: LaneLayout[] = [];

    for (const lane of laneStateList) {
      if (!lane.visible) {
        continue;
      }

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
        let rowIndex = rowEndTimes.findIndex((endTime) => endTime <= entry.startMs - MINUTE_MS * 15);
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

  const visibleLaneCount = useMemo(() => laneStateList.filter((lane) => lane.visible).length, [laneStateList]);

  const totalHeight = useMemo(() => {
    if (!positionedLayouts.length) return Math.max(visibleLaneCount, 1) * LANE_HEADER_HEIGHT;
    const last = positionedLayouts[positionedLayouts.length - 1];
    return last.offsetTop + last.height;
  }, [positionedLayouts, visibleLaneCount]);

  const conflictIndex = useMemo(() => {
    const conflicts = detectTimelineConflicts(localItems, { bufferHours: 4 });
    return buildConflictIndex(conflicts);
  }, [localItems]);

  useEffect(() => {
    const inConflict = Array.from(conflictIndex.keys());
    if (inConflict.length > 0) {
      setDragMessage("⚠ Conflicts detected. Check red outlined bars.");
    } else {
      setDragMessage((prev) => (prev?.includes("Conflicts") ? null : prev));
    }
  }, [conflictIndex]);

  const virtualizedLayouts = useMemo<VirtualizedLaneLayout[]>(() => {
    const minX = scrollLeft - VIRTUALIZATION_BUFFER;
    const maxX = scrollLeft + viewportWidth + VIRTUALIZATION_BUFFER;
    return positionedLayouts.map((layout) => {
      if (!layout.lane.visible || layout.lane.collapsed) {
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
      const rect = (event.target as HTMLElement).getBoundingClientRect();
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

  const handleZoom = useCallback(
    (delta: number) => {
      if (!onZoomChange || !scrollRef.current) return;
      const container = scrollRef.current;
      const previousPxPerMs = getPxPerMs(viewMode, zoom);
      const nextZoom = clampZoom(zoom + delta);
      if (nextZoom === zoom) return;
      const centerMs = startMs + (container.scrollLeft + container.clientWidth / 2) / previousPxPerMs;

      onZoomChange(nextZoom);

      requestAnimationFrame(() => {
        const node = scrollRef.current;
        if (!node) return;
        const nextPxPerMs = getPxPerMs(viewMode, nextZoom);
        const nextScrollLeft = (centerMs - startMs) * nextPxPerMs - node.clientWidth / 2;
        node.scrollLeft = Math.max(0, nextScrollLeft);
      });
    },
    [onZoomChange, scrollRef, startMs, viewMode, zoom]
  );
  const positionLookup = useMemo(() => {
    const map = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const layout of positionedLayouts) {
      if (!layout.lane.visible || layout.lane.collapsed) continue;
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
    (positioned: PositionedItem) => {
      const { item } = positioned;
      const typeStyle = TYPE_COLORS[item.type];
      const statusDecoration = STATUS_DECORATION[item.status];
      const priorityMeta = getPriorityMeta(item.priorityScore);
      const conflicted = conflictIndex.has(item.id);
      const overdue = isOverdue(item);
      const attachments = hasAttachments(item);
      const classes = [
        "group absolute rounded-md border px-3 py-2 text-xs shadow transition-all duration-200",
        typeStyle.base,
        typeStyle.text,
        typeStyle.border,
        statusDecoration ?? "",
        conflicted ? "ring-2 ring-offset-1 ring-offset-slate-900/60 ring-red-500" : "",
        overdue ? "shadow-[0_0_12px_rgba(239,68,68,0.45)]" : "",
        positioned.isPin ? "flex items-center justify-center" : "flex flex-col",
      ]
        .filter(Boolean)
        .join(" ");

      const style: CSSProperties = {
        left: positioned.left,
        top: positioned.top,
        width: positioned.width,
        height: positioned.height,
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
            <div className="flex items-center gap-2">
              <span className="text-[0.65rem] uppercase tracking-wide">{item.type.replace(/_/g, " ")}</span>
              <span className="font-semibold text-sm">{item.title}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 text-[0.65rem] uppercase tracking-wide">
                <span>{item.type.replace(/_/g, " ")}</span>
                <span className="font-semibold">{priorityMeta.label}</span>
              </div>
              <p className="mt-1 truncate text-sm font-semibold leading-tight">{item.title}</p>
              <p className="mt-1 text-[0.65rem] text-slate-200/80">{formatTimeRange(item)}</p>
              <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-slate-100/80">
                {item.labels?.city ? <span>{item.labels.city}</span> : null}
                {item.labels?.territory ? <span>{item.labels.territory}</span> : null}
                {attachments ? <span className="flex items-center gap-1">📎<span>files</span></span> : null}
                {item.status === "tentative" ? <span>tentative</span> : null}
                {item.status === "done" ? <span>done</span> : null}
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 rounded-b-md bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition group-hover:opacity-100" />
            </>
          )}

          {!positioned.isPin ? (
            <div className="absolute inset-x-0 bottom-0 flex justify-between px-1 text-[0.65rem]">
              <div
                className="cursor-ew-resize rounded px-1 py-0.5 text-slate-100/80"
                onPointerDown={(event) => handleDragStart(event, "resize-start", positioned)}
              >
                ⇠
              </div>
              <div
                className="cursor-grab rounded px-1 py-0.5 text-slate-100/80"
                onPointerDown={(event) => handleDragStart(event, "move", positioned)}
              >
                ↔
              </div>
              <div
                className="cursor-ew-resize rounded px-1 py-0.5 text-slate-100/80"
                onPointerDown={(event) => handleDragStart(event, "resize-end", positioned)}
              >
                ⇢
              </div>
            </div>
          ) : null}
        </div>
      );
    },
    [conflictIndex, handleContextMenu, handleDragStart, onSelectItem]
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
              return (
                <div
                  key={layout.lane.id}
                  className="flex items-start justify-between border-b px-4"
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
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleLaneCollapse?.(layout.lane.id)}
                    className="mt-4 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
                  >
                    {layout.lane.collapsed ? "Expand" : "Collapse"}
                  </button>
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
                          className="absolute flex -translate-x-1/2 flex-col items-center text-sm text-slate-200"
                          style={{ left }}
                        >
                          <span className="rounded bg-slate-900/80 px-2 py-0.5 shadow">{tick.label}</span>
                          <span className="mt-2 h-6 w-px bg-slate-700/60" />
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
                    <div
                      className="absolute inset-y-0 w-px bg-red-400"
                      style={{ left: todayPosition }}
                    />
                  ) : null}
                </div>

                {positionedLayouts.map((layout) => {
                  if (!layout.lane.visible) {
                    return null;
                  }
                  const visuals = buildLaneVisual(layout.lane.color);
                  return (
                    <div
                      key={layout.lane.id}
                      className="absolute inset-x-0"
                      style={{ top: layout.offsetTop, height: layout.height, background: visuals.background }}
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
                      {layout.visibleItems.map((positioned) => renderItem(positioned))}
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
          className="fixed z-50 w-48 rounded-lg border border-slate-700 bg-slate-900/95 py-2 text-sm text-slate-100 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {["edit", "attach", "convert"].map((action) => (
            <button
              key={action}
              type="button"
              className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-800"
              onClick={() => onContextAction?.(action as ContextAction, contextMenu.item)}
            >
              {action === "edit" ? "✏️" : action === "attach" ? "📎" : "🔁"}
              <span className="capitalize">{action}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
