"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import type {
  ProjectRecord,
  TimelineItemRecord,
  TimelineLaneDefinition,
  TimelineItemStatus,
  ProjectSourceRecord,
} from "@kazador/shared";
import {
  fetchTimelineExplorer,
  fetchProjects,
  fetchProjectSources,
  fetchProjectHub,
  createTimelineItem,
  updateTimelineItem,
  createCalendarEventForTimelineItem,
  updateCalendarEventForTimelineItem,
} from "@/lib/supabaseClient";

const VIEW_MODES = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
] as const;

const DEFAULT_VIEW: (typeof VIEW_MODES)[number]["value"] = "week";
const MINUTES_PER_DAY = 24 * 60;
const STATUS_OPTIONS: TimelineItemStatus[] = ["planned", "tentative", "confirmed", "waiting", "done", "canceled"];
const DEFAULT_EVENT_TYPE: TimelineItemRecord["type"] = "PROMO_SLOT";

type CalendarItemKind = "timeline" | "task";

interface CalendarItem {
  id: string;
  projectId: string | null;
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
  record: TimelineItemRecord | null;
  kind: CalendarItemKind;
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
        projectId: item.projectId,
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
        record: item,
        kind: "timeline",
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
      projectId: task.projectId,
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
      record: null,
      kind: "task",
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

interface CalendarSelectionState {
  dateKey: string;
  date: Date;
  startMinutes: number;
  endMinutes: number;
  active: boolean;
}

interface CreateModalState {
  mode: "create";
  projectId: string | null;
  start: Date;
  end: Date;
}

interface EditModalState {
  mode: "edit";
  projectId: string;
  item: TimelineItemRecord;
}

type CalendarModalState = CreateModalState | EditModalState;

interface CalendarEventSubmission {
  mode: "create" | "edit";
  projectId: string;
  itemId?: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  status: TimelineItemStatus;
  lane: string | null;
  timezone: string | null;
  syncToCalendar: boolean;
  calendarSourceId: string | null;
}

interface CalendarGridProps {
  items: CalendarItem[];
  viewMode: string;
  start: Date;
  end: Date;
  onSelectItem?: (item: CalendarItem) => void;
  onBeginSelection?: (date: Date, minutes: number) => void;
  onUpdateSelection?: (minutes: number) => void;
  onCompleteSelection?: (minutes: number) => void;
  onCancelSelection?: () => void;
  selection?: CalendarSelectionState | null;
  onCreateAllDay?: (date: Date) => void;
}

function CalendarGrid({
  items,
  viewMode,
  start,
  end,
  onSelectItem,
  onBeginSelection,
  onUpdateSelection,
  onCompleteSelection,
  onCancelSelection,
  selection,
  onCreateAllDay,
}: CalendarGridProps) {
  if (viewMode === "day" || viewMode === "week") {
    return (
      <CalendarWeekGrid
        items={items}
        start={start}
        end={end}
        viewMode={viewMode}
        onSelectItem={onSelectItem}
        onBeginSelection={onBeginSelection}
        onUpdateSelection={onUpdateSelection}
        onCompleteSelection={onCompleteSelection}
        onCancelSelection={onCancelSelection}
        selection={selection}
      />
    );
  }
  return (
    <CalendarMonthGrid
      items={items}
      start={start}
      end={end}
      onSelectItem={onSelectItem}
      onCreateAllDay={onCreateAllDay}
    />
  );
}

function clampMinutes(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), MINUTES_PER_DAY);
}

function minutesFromEvent(event: MouseEvent<HTMLDivElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  const relative = rect.height > 0 ? Math.min(Math.max(event.clientY - rect.top, 0), rect.height) : 0;
  const ratio = rect.height > 0 ? relative / rect.height : 0;
  const minutes = Math.round((ratio * MINUTES_PER_DAY) / 30) * 30;
  return clampMinutes(minutes);
}

function minutesToPercent(minutes: number): number {
  return (clampMinutes(minutes) / MINUTES_PER_DAY) * 100;
}

function filterAccessibleCalendarSources(
  sources: ProjectSourceRecord[],
  userId: string | null
): ProjectSourceRecord[] {
  return sources.filter((source) => {
    if (source.kind !== "calendar") return false;
    const metadata = (source.metadata ?? {}) as Record<string, unknown>;
    const calendarId = metadata.calendarId as string | undefined;
    const accountId = metadata.accountId as string | undefined;
    if (!calendarId || !accountId) return false;
    const connectedBy = metadata.connectedBy as string | undefined;
    if (connectedBy && userId && connectedBy !== userId) {
      return false;
    }
    return true;
  });
}

function formatDatetimeLocalValue(input: Date | string | null): string {
  if (!input) return "";
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoFromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function CalendarWeekGrid({
  items,
  start,
  end,
  viewMode,
  onSelectItem,
  onBeginSelection,
  onUpdateSelection,
  onCompleteSelection,
  onCancelSelection,
  selection,
}: {
  items: CalendarItem[];
  start: Date;
  end: Date;
  viewMode: string;
  onSelectItem?: (item: CalendarItem) => void;
  onBeginSelection?: (date: Date, minutes: number) => void;
  onUpdateSelection?: (minutes: number) => void;
  onCompleteSelection?: (minutes: number) => void;
  onCancelSelection?: () => void;
  selection?: CalendarSelectionState | null;
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
          const selectionForDay = selection && selection.dateKey === key ? selection : null;
          const selectionStart = selectionForDay
            ? Math.min(selectionForDay.startMinutes, selectionForDay.endMinutes)
            : 0;
          const selectionEnd = selectionForDay
            ? Math.max(selectionForDay.startMinutes, selectionForDay.endMinutes)
            : 0;
          const selectionHeight = selectionForDay ? Math.max(selectionEnd - selectionStart, 30) : 0;

          const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
            if (!onBeginSelection) return;
            if (event.button !== 0) return;
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            onBeginSelection(day, minutesFromEvent(event));
          };

          const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
            if (!selection || !selection.active) return;
            if (selection.dateKey !== key) return;
            onUpdateSelection?.(minutesFromEvent(event));
          };

          const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
            if (!selection || !selection.active) return;
            if (selection.dateKey !== key) return;
            event.preventDefault();
            onCompleteSelection?.(minutesFromEvent(event));
          };

          const handleMouseLeave = (event: MouseEvent<HTMLDivElement>) => {
            if (!selection || !selection.active) return;
            if (selection.dateKey !== key) return;
            if (event.buttons === 0) {
              onUpdateSelection?.(minutesFromEvent(event));
            }
          };

          const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
            if (!onBeginSelection || !onCompleteSelection) return;
            if (event.target !== event.currentTarget) return;
            const minutes = minutesFromEvent(event);
            onBeginSelection(day, minutes);
            onUpdateSelection?.(minutes + 60);
            onCompleteSelection(minutes + 60);
          };

          return (
            <div key={key} className="flex h-full flex-col bg-white p-3">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span>{day.getDate()}</span>
              </div>
              <div
                className="relative mt-2 flex-1 rounded-md border border-transparent bg-gray-50/80 p-1 min-h-[24rem]"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onDoubleClick={handleDoubleClick}
              >
                {selectionForDay ? (
                  <div
                    className="pointer-events-none absolute inset-x-1 rounded-md border border-sky-300/80 bg-sky-400/20"
                    style={{
                      top: `${minutesToPercent(selectionStart)}%`,
                      height: `${Math.max(minutesToPercent(selectionHeight), 1.5)}%`,
                    }}
                  />
                ) : null}
                <div className="relative z-10 flex flex-col gap-2">
                  {dayItems.length === 0 ? (
                    <p className="text-xs text-gray-400">No events</p>
                  ) : (
                    dayItems.map((item) => (
                      <CalendarEventCard key={item.id} item={item} onSelect={onSelectItem} />
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarMonthGrid({
  items,
  start,
  end,
  onSelectItem,
  onCreateAllDay,
}: {
  items: CalendarItem[];
  start: Date;
  end: Date;
  onSelectItem?: (item: CalendarItem) => void;
  onCreateAllDay?: (date: Date) => void;
}) {
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
            <div
              key={key}
              className="min-h-[7rem] bg-white p-2"
              onDoubleClick={(event) => {
                if (event.target !== event.currentTarget) return;
                onCreateAllDay?.(day);
              }}
            >
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span>{day.getDate()}</span>
              </div>
              <div className="mt-2 space-y-1">
                {dayItems.length === 0 ? (
                  <p className="text-[0.7rem] text-gray-400">No events</p>
                ) : (
                  dayItems.map((item) => (
                    <CalendarEventCard key={item.id} item={item} compact onSelect={onSelectItem} />
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

function CalendarEventCard({
  item,
  compact = false,
  onSelect,
}: {
  item: CalendarItem;
  compact?: boolean;
  onSelect?: (item: CalendarItem) => void;
}) {
  const isCalendar = isCalendarItem(item);
  const isEditable = item.kind === "timeline" && Boolean(onSelect);
  const label = item.startsAt
    ? item.endsAt
      ? `${item.startsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${item.endsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : item.startsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : item.endsAt
    ? `Due ${item.endsAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Time TBC";
  const handleClick = () => {
    if (!isEditable) return;
    onSelect?.(item);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isEditable) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect?.(item);
    }
  };
  return (
    <div
      className={`rounded border ${
        isCalendar ? "border-sky-300 bg-sky-50" : "border-gray-200 bg-gray-50"
      } px-2 py-1 text-xs text-gray-700 ${isEditable ? "cursor-pointer transition hover:border-sky-400" : ""}`}
      role={isEditable ? "button" : undefined}
      tabIndex={isEditable ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
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
          onClick={(event) => event.stopPropagation()}
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

interface CalendarEventModalProps {
  state: CalendarModalState;
  projects: ProjectRecord[];
  onClose: () => void;
  onSubmit: (payload: CalendarEventSubmission) => Promise<void>;
  submitting: boolean;
  error: string | null;
  laneDefinitionsByProject: Record<string, TimelineLaneDefinition[]>;
  projectSourcesMap: Record<string, ProjectSourceRecord[]>;
  userId: string | null;
  onRequestProjectData: (projectId: string) => void | Promise<void>;
}

interface CalendarEventFormState {
  projectId: string;
  title: string;
  startInput: string;
  endInput: string;
  status: TimelineItemStatus;
  lane: string;
  timezone: string;
  syncToCalendar: boolean;
  calendarSourceId: string;
}

function CalendarEventModal({
  state,
  projects,
  onClose,
  onSubmit,
  submitting,
  error,
  laneDefinitionsByProject,
  projectSourcesMap,
  userId,
  onRequestProjectData,
}: CalendarEventModalProps) {
  const defaultTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const existingItem = state.mode === "edit" ? state.item : null;
  const existingCalendarId = existingItem
    ? (existingItem.links as Record<string, any>)?.calendarId || null
    : null;
  const existingCalendarSourceId = existingItem
    ? (existingItem.links as Record<string, any>)?.calendarSourceId || null
    : null;

  const initialProjectId = state.mode === "edit"
    ? state.projectId
    : state.projectId ?? projects[0]?.id ?? "";

  const [form, setForm] = useState<CalendarEventFormState>(() => {
    const initialStart =
      state.mode === "edit"
        ? formatDatetimeLocalValue(existingItem?.startsAt ?? existingItem?.dueAt ?? existingItem?.endsAt ?? new Date())
        : formatDatetimeLocalValue(state.start);
    const initialEnd =
      state.mode === "edit"
        ? formatDatetimeLocalValue(existingItem?.endsAt ?? existingItem?.startsAt ?? null)
        : formatDatetimeLocalValue(state.end);

    return {
      projectId: initialProjectId,
      title: state.mode === "edit" ? existingItem?.title ?? "" : "",
      startInput: initialStart,
      endInput: initialEnd || initialStart,
      status: state.mode === "edit" ? existingItem?.status ?? "planned" : "planned",
      lane:
        state.mode === "edit"
          ? (existingItem?.labels?.lane ? String(existingItem.labels.lane) : "")
          : "",
      timezone: state.mode === "edit" ? existingItem?.timezone ?? defaultTimezone : defaultTimezone,
      syncToCalendar: existingCalendarId ? true : state.mode === "create",
      calendarSourceId: existingCalendarSourceId ?? "",
    };
  });

  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    const initialStart =
      state.mode === "edit"
        ? formatDatetimeLocalValue(existingItem?.startsAt ?? existingItem?.dueAt ?? existingItem?.endsAt ?? new Date())
        : formatDatetimeLocalValue(state.start);
    const initialEnd =
      state.mode === "edit"
        ? formatDatetimeLocalValue(existingItem?.endsAt ?? existingItem?.startsAt ?? null)
        : formatDatetimeLocalValue(state.end);

    setForm({
      projectId: initialProjectId,
      title: state.mode === "edit" ? existingItem?.title ?? "" : "",
      startInput: initialStart,
      endInput: initialEnd || initialStart,
      status: state.mode === "edit" ? existingItem?.status ?? "planned" : "planned",
      lane:
        state.mode === "edit"
          ? (existingItem?.labels?.lane ? String(existingItem.labels.lane) : "")
          : "",
      timezone: state.mode === "edit" ? existingItem?.timezone ?? defaultTimezone : defaultTimezone,
      syncToCalendar: existingCalendarId ? true : state.mode === "create",
      calendarSourceId: existingCalendarSourceId ?? "",
    });
    setValidationError(null);
  }, [state, existingItem, existingCalendarId, existingCalendarSourceId, defaultTimezone, initialProjectId]);

  useEffect(() => {
    if (!form.projectId) return;
    onRequestProjectData(form.projectId);
  }, [form.projectId, onRequestProjectData]);

  const laneDefinitions = laneDefinitionsByProject[form.projectId] ?? [];
  const accessibleSources = filterAccessibleCalendarSources(projectSourcesMap[form.projectId] ?? [], userId);

  useEffect(() => {
    if (!form.syncToCalendar) return;
    if (accessibleSources.length === 0) {
      setForm((prev) => ({ ...prev, syncToCalendar: false, calendarSourceId: "" }));
      return;
    }
    if (!form.calendarSourceId || !accessibleSources.some((source) => source.id === form.calendarSourceId)) {
      setForm((prev) => ({ ...prev, calendarSourceId: accessibleSources[0].id }));
    }
  }, [accessibleSources, form.syncToCalendar, form.calendarSourceId]);

  const handleFieldChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type, checked } = event.target;
    setForm((prev) => {
      if (name === "syncToCalendar") {
        const next = type === "checkbox" ? checked : Boolean(value);
        if (!next || accessibleSources.length === 0 || existingCalendarId) {
          return {
            ...prev,
            syncToCalendar: existingCalendarId ? true : accessibleSources.length > 0 ? next : false,
            calendarSourceId: existingCalendarId
              ? prev.calendarSourceId
              : accessibleSources.length > 0
              ? accessibleSources[0].id
              : "",
          };
        }
        return {
          ...prev,
          syncToCalendar: true,
          calendarSourceId: prev.calendarSourceId || accessibleSources[0].id,
        };
      }
      if (type === "checkbox") {
        return { ...prev, [name]: checked } as CalendarEventFormState;
      }
      return { ...prev, [name]: value } as CalendarEventFormState;
    });
  };

  const handleProjectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextProject = event.target.value;
    setForm((prev) => ({ ...prev, projectId: nextProject }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);
    if (!form.projectId) {
      setValidationError("Select a project to continue.");
      return;
    }
    const trimmedTitle = form.title.trim();
    if (!trimmedTitle) {
      setValidationError("Title is required.");
      return;
    }
    const startIso = toIsoFromDatetimeLocal(form.startInput);
    if (!startIso) {
      setValidationError("Start time is required.");
      return;
    }
    const endIso = toIsoFromDatetimeLocal(form.endInput);
    if (endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setValidationError("End time must be after the start time.");
      return;
    }

    const payload: CalendarEventSubmission = {
      mode: state.mode,
      projectId: form.projectId,
      itemId: state.mode === "edit" ? state.item.id : undefined,
      title: trimmedTitle,
      startsAt: startIso,
      endsAt: endIso,
      status: form.status,
      lane: form.lane || null,
      timezone: form.timezone || null,
      syncToCalendar: form.syncToCalendar && (existingCalendarId ? true : accessibleSources.length > 0),
      calendarSourceId: null,
    };

    if (payload.syncToCalendar) {
      const resolvedSourceId = form.calendarSourceId || accessibleSources[0]?.id || null;
      payload.calendarSourceId = resolvedSourceId;
      if (!resolvedSourceId) {
        setValidationError("Select a Google Calendar before mirroring.");
        return;
      }
    }

    await onSubmit(payload);
  };

  const syncDisabled = existingCalendarId ? true : accessibleSources.length === 0;
  const selectedProjectName = projects.find((project) => project.id === form.projectId)?.name ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {state.mode === "create" ? "Create calendar event" : "Edit calendar event"}
            </h2>
            <p className="text-sm text-gray-500">
              {state.mode === "create"
                ? "Add a new timeline item and mirror it to Google Calendar."
                : "Update the timeline item details and sync any linked calendar invite."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Project
            <select
              value={form.projectId}
              onChange={handleProjectChange}
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Select a project
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Title
            <input
              name="title"
              value={form.title}
              onChange={handleFieldChange}
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Session name, hold, interview"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">
              Starts
              <input
                type="datetime-local"
                name="startInput"
                value={form.startInput}
                onChange={handleFieldChange}
                required
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-medium text-gray-700">
              Ends
              <input
                type="datetime-local"
                name="endInput"
                value={form.endInput}
                onChange={handleFieldChange}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">
              Lane
              <select
                name="lane"
                value={form.lane}
                onChange={handleFieldChange}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Auto</option>
                {laneDefinitions.map((lane) => (
                  <option key={lane.slug} value={lane.slug}>
                    {lane.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">
              Status
              <select
                name="status"
                value={form.status}
                onChange={handleFieldChange}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-sm font-medium text-gray-700">
            Timezone
            <input
              name="timezone"
              value={form.timezone}
              onChange={handleFieldChange}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                name="syncToCalendar"
                checked={form.syncToCalendar}
                onChange={handleFieldChange}
                disabled={syncDisabled}
                className="h-4 w-4 rounded border-gray-300"
              />
              Mirror to Google Calendar
            </label>
            {existingCalendarId ? (
              <p className="mt-2 text-xs text-gray-500">
                Linked event will be updated automatically ({existingCalendarId.slice(0, 8)}…).
              </p>
            ) : accessibleSources.length > 0 ? (
              <div className="mt-2">
                <label className="text-xs font-semibold uppercase text-gray-500">
                  Calendar source
                  <select
                    name="calendarSourceId"
                    value={form.calendarSourceId}
                    onChange={handleFieldChange}
                    disabled={!form.syncToCalendar}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    {accessibleSources.map((source) => {
                      const metadata = (source.metadata ?? {}) as Record<string, unknown>;
                      const label =
                        source.title ||
                        (metadata.calendarSummary as string | undefined) ||
                        metadata.calendarId ||
                        source.externalId;
                      return (
                        <option key={source.id} value={source.id}>
                          {label}{selectedProjectName ? ` • ${selectedProjectName}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                Connect your Google Calendar for this project to enable mirroring.
              </p>
            )}
          </div>

          {validationError ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {validationError}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {submitting ? "Saving…" : state.mode === "create" ? "Create" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const { session, user } = useAuth();
  const accessToken = session?.access_token ?? null;
  const userId = user?.id ?? null;
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
  const [projectSourcesMap, setProjectSourcesMap] = useState<Record<string, ProjectSourceRecord[]>>({});
  const [laneDefinitionsMap, setLaneDefinitionsMap] = useState<Record<string, TimelineLaneDefinition[]>>({});
  const [selection, setSelection] = useState<CalendarSelectionState | null>(null);
  const selectionRef = useRef<CalendarSelectionState | null>(null);
  const selectionLastMinutesRef = useRef<number | null>(null);
  const [modalState, setModalState] = useState<CalendarModalState | null>(null);
  const modalStateRef = useRef<CalendarModalState | null>(null);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const hasUserAdjustedRef = useRef(false);

  const { projects, error: projectError } = useProjects(accessToken);

  const activeProjectId = projectId && projectId !== "all" ? projectId : null;

  const loadCalendarData = useCallback(
    async (projectOverride?: string) => {
      const targetProjectId = projectOverride ?? activeProjectId;
      if (!accessToken || !targetProjectId) {
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
      try {
        const response = await fetchTimelineExplorer({
          accessToken,
          projectId: targetProjectId,
          rangeStart: start.toISOString(),
          rangeEnd: end.toISOString(),
        });
        const projectLookup = projectNameLookup(projects);
        setItems(buildCalendarItems(response, projectLookup));
        setLanes(response.lanes ?? []);
        setLaneDefinitionsMap((prev) => ({ ...prev, [targetProjectId]: response.lanes ?? [] }));
      } catch (err: any) {
        setError(err?.message || "Failed to load timeline events");
      } finally {
        setLoading(false);
      }
    },
    [accessToken, activeProjectId, viewMode, anchorDate, projects]
  );

  useEffect(() => {
    void loadCalendarData();
  }, [loadCalendarData]);

  useEffect(() => {
    modalStateRef.current = modalState;
  }, [modalState]);

  const ensureProjectContext = useCallback(
    async (projectIdToLoad: string) => {
      if (!accessToken || !projectIdToLoad) return;

      if (!projectSourcesMap[projectIdToLoad]) {
        try {
          const sources = await fetchProjectSources(projectIdToLoad, accessToken);
          setProjectSourcesMap((prev) => ({ ...prev, [projectIdToLoad]: sources }));
        } catch (err) {
          setProjectSourcesMap((prev) => ({ ...prev, [projectIdToLoad]: prev[projectIdToLoad] ?? [] }));
        }
      }

      if (!laneDefinitionsMap[projectIdToLoad]) {
        try {
          const hub = await fetchProjectHub(projectIdToLoad, accessToken);
          setLaneDefinitionsMap((prev) => ({ ...prev, [projectIdToLoad]: hub.laneDefinitions ?? [] }));
        } catch (err) {
          setLaneDefinitionsMap((prev) => ({ ...prev, [projectIdToLoad]: prev[projectIdToLoad] ?? [] }));
        }
      }
    },
    [accessToken, projectSourcesMap, laneDefinitionsMap]
  );

  const openCreateModalFromSelection = useCallback(
    (draft: { date: Date; startMinutes: number; endMinutes: number }) => {
      const startMinutes = Math.min(draft.startMinutes, draft.endMinutes);
      let endMinutes = Math.max(draft.startMinutes, draft.endMinutes);
      if (endMinutes - startMinutes < 30) {
        endMinutes = startMinutes + 60;
      }
      const base = new Date(draft.date);
      base.setHours(0, 0, 0, 0);
      const startDate = new Date(base.getTime() + startMinutes * 60_000);
      const endDate = new Date(base.getTime() + endMinutes * 60_000);
      const defaultProject = activeProjectId ?? projects[0]?.id ?? null;
      if (!defaultProject) {
        setActionError("Select a project before creating events.");
      }
      setModalError(null);
      setModalState({
        mode: "create",
        projectId: defaultProject,
        start: startDate,
        end: endDate,
      });
      if (defaultProject) {
        void ensureProjectContext(defaultProject);
      }
    },
    [activeProjectId, projects, ensureProjectContext]
  );

  const cancelSelection = useCallback(() => {
    selectionRef.current = null;
    selectionLastMinutesRef.current = null;
    setSelection(null);
  }, []);

  const beginSelection = useCallback(
    (date: Date, minutes: number) => {
      const draft: CalendarSelectionState = {
        date,
        dateKey: date.toISOString().slice(0, 10),
        startMinutes: minutes,
        endMinutes: minutes,
        active: true,
      };
      selectionRef.current = draft;
      selectionLastMinutesRef.current = minutes;
      setSelection(draft);
    },
    []
  );

  const updateSelection = useCallback((minutes: number) => {
    selectionLastMinutesRef.current = minutes;
    setSelection((prev) => {
      if (!prev) return prev;
      const next = { ...prev, endMinutes: minutes };
      selectionRef.current = next;
      return next;
    });
  }, []);

  const completeSelection = useCallback(
    (minutes?: number) => {
      const current = selectionRef.current;
      if (!current) return;
      const finalEnd = minutes ?? selectionLastMinutesRef.current ?? current.endMinutes;
      selectionRef.current = null;
      selectionLastMinutesRef.current = null;
      setSelection(null);
      openCreateModalFromSelection({
        date: current.date,
        startMinutes: current.startMinutes,
        endMinutes: finalEnd,
      });
    },
    [openCreateModalFromSelection]
  );

  const handleCreateAllDay = useCallback(
    (date: Date) => {
      const base = new Date(date);
      base.setHours(0, 0, 0, 0);
      openCreateModalFromSelection({ date: base, startMinutes: 9 * 60, endMinutes: 10 * 60 });
    },
    [openCreateModalFromSelection]
  );

  const handleSelectItem = useCallback(
    (item: CalendarItem) => {
      if (item.kind !== "timeline" || !item.record) return;
      setModalError(null);
      setModalState({ mode: "edit", projectId: item.record.projectId, item: item.record });
      void ensureProjectContext(item.record.projectId);
    },
    [ensureProjectContext]
  );

  const closeModal = useCallback(() => {
    setModalError(null);
    setModalState(null);
  }, []);

  const handleModalSubmit = useCallback(
    async (payload: CalendarEventSubmission) => {
      if (!accessToken) return;
      setModalError(null);
      setActionError(null);
      setActionMessage(null);
      setModalSaving(true);
      try {
        if (payload.mode === "create") {
          const created = await createTimelineItem(
            payload.projectId,
            {
              title: payload.title,
              type: DEFAULT_EVENT_TYPE,
              startsAt: payload.startsAt,
              endsAt: payload.endsAt,
              status: payload.status,
              lane: payload.lane,
              timezone: payload.timezone,
            },
            accessToken
          );
          if (payload.syncToCalendar && payload.calendarSourceId) {
            await createCalendarEventForTimelineItem(
              payload.projectId,
              created.id,
              { sourceId: payload.calendarSourceId },
              accessToken
            );
          }
          setActionMessage("Event created");
          if (projectId !== payload.projectId) {
            setProjectId(payload.projectId);
          }
          await loadCalendarData(payload.projectId);
        } else {
          const currentModal = modalStateRef.current as EditModalState | null;
          await updateTimelineItem(
            payload.projectId,
            payload.itemId!,
            {
              title: payload.title,
              startsAt: payload.startsAt ?? undefined,
              endsAt: payload.endsAt ?? undefined,
              status: payload.status,
              lane: payload.lane ?? undefined,
              timezone: payload.timezone ?? undefined,
            },
            accessToken
          );

          if (payload.syncToCalendar && payload.calendarSourceId) {
            const existingLinks = (currentModal?.item.links ?? {}) as Record<string, any>;
            if (existingLinks?.calendarId) {
              await updateCalendarEventForTimelineItem(
                payload.projectId,
                payload.itemId!,
                { sourceId: payload.calendarSourceId },
                accessToken
              );
            } else {
              await createCalendarEventForTimelineItem(
                payload.projectId,
                payload.itemId!,
                { sourceId: payload.calendarSourceId },
                accessToken
              );
            }
          }
          setActionMessage("Event updated");
          await loadCalendarData(payload.projectId);
        }
        setModalState(null);
      } catch (err: any) {
        setModalError(err?.message || "Failed to save event");
      } finally {
        setModalSaving(false);
      }
    },
    [accessToken, loadCalendarData, projectId]
  );

  useEffect(() => {
    if (!selection || !selection.active) return;
    const handleMouseUp = () => {
      completeSelection();
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [selection, completeSelection]);

  useEffect(() => {
    if (activeProjectId) {
      void ensureProjectContext(activeProjectId);
    }
  }, [activeProjectId, ensureProjectContext]);

  useEffect(() => {
    cancelSelection();
  }, [cancelSelection, activeProjectId, viewMode]);

  useEffect(() => {
    setActionMessage(null);
    setActionError(null);
  }, [activeProjectId, viewMode, anchorDate]);


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
      hasUserAdjustedRef.current = true;
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
          <Link
            href="/calendar/inbox"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Open calendar inbox
          </Link>
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
      {actionMessage ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{actionMessage}</div>
      ) : null}
      {actionError ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{actionError}</div>
      ) : null}

      {loading ? (
        <p className="rounded border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 shadow-sm">Loading calendar…</p>
      ) : filteredItems.length === 0 ? (
        <p className="rounded border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 shadow-sm">
          No items fall within the selected range. Pull calendar events or adjust filters.
        </p>
      ) : null}

      {!loading ? (
        <CalendarGrid
          items={filteredItems}
          viewMode={viewMode}
          start={start}
          end={end}
          onSelectItem={handleSelectItem}
          onBeginSelection={beginSelection}
          onUpdateSelection={updateSelection}
          onCompleteSelection={completeSelection}
          onCancelSelection={cancelSelection}
          selection={selection}
          onCreateAllDay={handleCreateAllDay}
        />
      ) : null}

      {modalState ? (
        <CalendarEventModal
          state={modalState}
          projects={projects}
          onClose={closeModal}
          onSubmit={handleModalSubmit}
          submitting={modalSaving}
          error={modalError}
          laneDefinitionsByProject={laneDefinitionsMap}
          projectSourcesMap={projectSourcesMap}
          userId={userId}
          onRequestProjectData={ensureProjectContext}
        />
      ) : null}
    </section>
  );
}
