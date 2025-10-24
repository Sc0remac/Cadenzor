"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DigestPayload,
  DigestTopAction,
  ProjectDigestMetrics,
  DigestProjectSnapshot,
  UserPreferenceRecord,
  EmailRecord,
  CalendarEventRecord,
} from "@kazador/shared";
import { useAuth } from "../AuthProvider";
import {
  fetchTodayDigest,
  fetchRecentEmails,
  fetchCalendarEvents,
  type TodayDigestResponse,
} from "../../lib/supabaseClient";

interface DigestState {
  digest: DigestPayload | null;
  preferences: UserPreferenceRecord | null;
  generatedFor: string | null;
}

interface EmailsState {
  items: EmailRecord[];
  loading: boolean;
  error: string | null;
}

interface TodayEventsState {
  items: CalendarEventRecord[];
  loading: boolean;
  error: string | null;
}

const INITIAL_DIGEST: DigestState = {
  digest: null,
  preferences: null,
  generatedFor: null,
};

const INITIAL_EMAILS: EmailsState = {
  items: [],
  loading: false,
  error: null,
};

const INITIAL_TODAY_EVENTS: TodayEventsState = {
  items: [],
  loading: false,
  error: null,
};

const EMAIL_WINDOWS = [
  { value: "24h", label: "Last 24h" },
  { value: "72h", label: "Last 3d" },
  { value: "all", label: "All time" },
] as const;

type EmailWindow = (typeof EMAIL_WINDOWS)[number]["value"];

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatTrend(trend: ProjectDigestMetrics["trend"]): string {
  if (!trend) return "—";
  switch (trend) {
    case "improving":
      return "Improving";
    case "steady":
      return "Steady";
    case "slipping":
      return "Slipping";
    default:
      return trend;
  }
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, amount: number): Date {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + amount);
  return clone;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function eventIntersectsRange(event: CalendarEventRecord, rangeStart: Date, rangeEnd: Date): boolean {
  const start = parseDate(event.startAt) ?? parseDate(event.endAt);
  const end = parseDate(event.endAt) ?? parseDate(event.startAt) ?? start;
  if (!start && !end) return false;
  const eventStart = start ?? end ?? rangeStart;
  const eventEnd = end ?? start ?? rangeEnd;
  return eventEnd >= rangeStart && eventStart < rangeEnd;
}

function formatEventTimeRange(event: CalendarEventRecord): string {
  if (event.isAllDay) {
    return "All day";
  }

  const start = parseDate(event.startAt);
  const end = parseDate(event.endAt);

  if (start && end) {
    const sameDay = isSameDay(start, end);
    const startLabel = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const endLabel = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return sameDay ? `${startLabel} – ${endLabel}` : `${startLabel} → ${endLabel}`;
  }

  if (start) {
    return start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  if (end) {
    return end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  return "—";
}

function formatEventDateRange(event: CalendarEventRecord): string {
  const start = parseDate(event.startAt);
  const end = parseDate(event.endAt);

  if (event.isAllDay && start && end) {
    const adjustedEnd = addDays(end, -1);
    if (isSameDay(start, adjustedEnd)) {
      return start.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }

    const startLabel = start.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const endLabel = adjustedEnd.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startLabel} – ${endLabel}`;
  }

  if (start && end) {
    const sameDay = isSameDay(start, end);
    const dateLabel = sameDay
      ? start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : `${start.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })} – ${end.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`;
    const timeRange = `${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString(
      undefined,
      { hour: "numeric", minute: "2-digit" }
    )}`;
    return `${dateLabel}\n${timeRange}`;
  }

  if (start) {
    return start.toLocaleString();
  }

  if (end) {
    return end.toLocaleString();
  }

  return "—";
}

function getEventLink(event: CalendarEventRecord): string | null {
  const raw = event.raw as Record<string, unknown>;
  if (typeof raw?.htmlLink === "string") {
    return raw.htmlLink as string;
  }
  return null;
}

function resolveEventCalendarName(event: CalendarEventRecord): string {
  const sourceMetadata = (event.source?.metadata as Record<string, unknown> | null) ?? null;
  if (typeof sourceMetadata?.calendarSummary === "string" && sourceMetadata.calendarSummary.trim() !== "") {
    return sourceMetadata.calendarSummary as string;
  }
  if (event.source?.title) {
    return event.source.title;
  }
  if (event.userSource?.summary) {
    return event.userSource.summary;
  }
  if (event.userSource?.calendarId) {
    return event.userSource.calendarId;
  }
  return "Calendar";
}

function formatEventStatus(status: string | null): string {
  if (!status) return "Scheduled";
  return status
    .replace(/_/g, " ")
    .split(" ")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function TodayEventsWidget({
  events,
  loading,
  error,
}: {
  events: CalendarEventRecord[];
  loading: boolean;
  error: string | null;
}) {
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRecord | null>(null);

  useEffect(() => {
    if (!selectedEvent) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedEvent(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEvent]);

  const closeModal = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Today's meetings</h3>
        <p className="mt-2 text-sm text-gray-500">Loading calendar data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Today's meetings</h3>
        <p className="mt-2 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-center text-gray-500 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Today's meetings</h3>
        <p className="mt-2 text-sm">No calendar events on the horizon. Pull a calendar to keep this view populated.</p>
      </div>
    );
  }

  const modalContent = !selectedEvent
    ? null
    : (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="today-event-modal-title"
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 id="today-event-modal-title" className="text-lg font-semibold text-gray-900">
                  {selectedEvent.summary || "Untitled event"}
                </h4>
                <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{formatEventDateRange(selectedEvent)}</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close event details"
              >
                ×
              </button>
            </div>
            <dl className="mt-4 space-y-3 text-sm text-gray-700">
              <div className="flex items-start gap-3">
                <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-gray-500">Calendar</dt>
                <dd className="flex-1 font-medium text-gray-900">{resolveEventCalendarName(selectedEvent)}</dd>
              </div>
              <div className="flex items-start gap-3">
                <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-gray-500">Status</dt>
                <dd className="flex-1 text-gray-700">{formatEventStatus(selectedEvent.status)}</dd>
              </div>
              {selectedEvent.location ? (
                <div className="flex items-start gap-3">
                  <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-gray-500">Location</dt>
                  <dd className="flex-1 text-gray-700">{selectedEvent.location}</dd>
                </div>
              ) : null}
              {selectedEvent.description ? (
                <div className="flex items-start gap-3">
                  <dt className="w-20 shrink-0 text-xs uppercase tracking-wide text-gray-500">Notes</dt>
                  <dd className="flex-1 whitespace-pre-line text-gray-700">{selectedEvent.description}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                {selectedEvent.origin === "google" ? "Google Calendar" : "Kazador"}
              </span>
              <div className="flex items-center gap-2">
                {selectedEvent.hangoutLink ? (
                  <a
                    href={selectedEvent.hangoutLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-700"
                  >
                    Join call
                    <span aria-hidden>↗</span>
                  </a>
                ) : null}
                {(() => {
                  const htmlLink = getEventLink(selectedEvent);
                  return htmlLink ? (
                    <a
                      href={htmlLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:border-gray-400 hover:text-gray-900"
                    >
                      Open in calendar
                      <span aria-hidden>↗</span>
                    </a>
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        </div>
      );

  return (
    <div className="relative rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Today's meetings</h3>
      <ul className="mt-4 space-y-3">
        {events.map((event) => {
          const calendarName = resolveEventCalendarName(event);
          return (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => setSelectedEvent(event)}
                className="flex w-full flex-col gap-2 rounded border border-gray-100 bg-gray-50 px-4 py-3 text-left text-sm text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{event.summary || "Untitled event"}</p>
                    <p className="text-xs text-gray-500">{calendarName}</p>
                  </div>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 uppercase">
                    {formatEventStatus(event.status)}
                  </span>
                </div>
                <p className="text-xs text-gray-600">{formatEventTimeRange(event)}</p>
              </button>
            </li>
          );
        })}
      </ul>
      {modalContent}
    </div>
  );
}

function DigestSummary({
  state,
  loading,
}: {
  state: DigestState;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="h-5 w-32 rounded bg-gray-200" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded border border-gray-100 bg-gray-50 p-4">
              <div className="h-3 w-20 rounded bg-gray-200" />
              <div className="mt-2 h-6 w-16 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!state.digest) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-gray-500 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Daily digest</h3>
        <p className="mt-2 text-sm">No digest available yet. Link projects and rerun the worker to populate insights.</p>
      </div>
    );
  }

  const { digest, preferences, generatedFor } = state;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Daily digest</h3>
          <p className="text-sm text-gray-500">
            Generated {generatedFor ? formatDate(generatedFor) : formatDate(digest.generatedAt)} • Frequency {preferences?.digestFrequency ?? "daily"}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          <span>{digest.meta.totalProjects} projects</span>
          <span>•</span>
          <span>{digest.meta.totalPendingApprovals} approvals</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <div className="rounded border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Highlighted projects</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{digest.meta.highlightedProjects}</p>
        </div>
        <div className="rounded border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Top actions surfaced</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{digest.topActions.length}</p>
        </div>
        <div className="rounded border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Delivery channel</p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            {(preferences?.channels ?? ["web"]).join(", ")}
          </p>
        </div>
        <div className="rounded border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Digest hour ({preferences?.timezone ?? "UTC"})</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{preferences?.digestHour ?? 8}:00</p>
        </div>
      </div>
    </div>
  );
}

function TopPriorityGrid({ actions }: { actions: DigestTopAction[] }) {
  if (!actions.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-gray-500 shadow-sm">
        No ranked priorities yet. As projects accumulate tasks, high-impact work will appear here.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {actions.slice(0, 4).map((action) => (
        <div key={action.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">{action.title}</p>
              <p className="text-xs text-gray-500">
                {action.projectName} • {action.entityType === "email" ? "Email" : action.entityType === "timeline" ? "Timeline" : "Task"}
              </p>
            </div>
            <span className="rounded bg-gray-900 px-2 py-1 text-xs font-semibold text-white">{Math.round(action.score)}</span>
          </div>
          {action.rationale && action.rationale.length > 0 ? (
            <p className="mt-2 text-xs text-gray-600">{action.rationale[0]}</p>
          ) : null}
          {(action.startsAt || action.dueAt) && (
            <p className="mt-3 text-xs text-gray-500">
              Target {formatDate(action.startsAt || action.dueAt)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function UpcomingDeadlines({ actions }: { actions: DigestTopAction[] }) {
  if (!actions.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-gray-500 shadow-sm h-full">
        Upcoming timeline items will land here once the priority engine has fresh data.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Upcoming deadlines</h3>
        <span className="text-xs uppercase tracking-wide text-gray-400">Timeline focus</span>
      </div>
      <ul className="mt-4 space-y-3">
        {actions.map((action) => (
          <li key={action.id} className="rounded border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{action.title}</p>
                <p className="text-xs text-gray-500">{action.projectName}</p>
              </div>
              <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                {formatDate(action.startsAt || action.dueAt)}
              </span>
            </div>
            {action.rationale && action.rationale.length > 0 ? (
              <p className="mt-2 text-xs text-gray-500">{action.rationale[0]}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmailWidget({
  emails,
  windowValue,
  onWindowChange,
  labelOptions,
  selectedLabel,
  onLabelChange,
  loading,
  error,
}: {
  emails: EmailRecord[];
  windowValue: EmailWindow;
  onWindowChange: (value: EmailWindow) => void;
  labelOptions: string[];
  selectedLabel: string;
  onLabelChange: (value: string) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900">Recent emails</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1 text-gray-500">
            Window
            <select
              value={windowValue}
              onChange={(event) => onWindowChange(event.target.value as EmailWindow)}
              className="rounded border border-gray-300 bg-white px-2 py-1"
            >
              {EMAIL_WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-gray-500">
            Label
            <select
              value={selectedLabel}
              onChange={(event) => onLabelChange(event.target.value)}
              className="rounded border border-gray-300 bg-white px-2 py-1"
            >
              <option value="all">All labels</option>
              {labelOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      ) : null}
      <div className="mt-4 overflow-hidden rounded border border-gray-100">
        <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Received</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={`loading-${index}`} className="animate-pulse">
                  <td className="px-4 py-3">
                    <div className="h-3 w-40 rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-24 rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-20 rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-24 rounded bg-gray-200" />
                  </td>
                </tr>
              ))
            ) : emails.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">
                  No emails match the current filters.
                </td>
              </tr>
            ) : (
              emails.map((email) => (
                <tr key={email.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{email.subject || "(no subject)"}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {email.fromName ? `${email.fromName} • ${email.fromEmail}` : email.fromEmail}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-gray-600">{email.category}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(email.receivedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function HomeDashboard() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [digestState, setDigestState] = useState<DigestState>(INITIAL_DIGEST);
  const [digestLoading, setDigestLoading] = useState(true);
  const [digestError, setDigestError] = useState<string | null>(null);

  const [emailsState, setEmailsState] = useState<EmailsState>(INITIAL_EMAILS);
  const [emailWindow, setEmailWindow] = useState<EmailWindow>("24h");
  const [selectedLabel, setSelectedLabel] = useState<string>("all");
  const [todayEventsState, setTodayEventsState] = useState<TodayEventsState>(INITIAL_TODAY_EVENTS);

  const loadDigest = useCallback(async () => {
    if (!accessToken) {
      setDigestLoading(false);
      setDigestError("Authentication required to load overview.");
      return;
    }

    setDigestLoading(true);
    setDigestError(null);
    try {
      const response = await fetchTodayDigest({ accessToken });
      setDigestState({
        digest: response.digest,
        preferences: response.preferences,
        generatedFor: response.generatedFor,
      });
    } catch (err: any) {
      setDigestError(err?.message || "Failed to load digest overview");
      setDigestState(INITIAL_DIGEST);
    } finally {
      setDigestLoading(false);
    }
  }, [accessToken]);

  const loadEmails = useCallback(async () => {
    if (!accessToken) {
      setEmailsState({ items: [], loading: false, error: "Authentication required" });
      return;
    }

    setEmailsState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetchRecentEmails({ accessToken, perPage: 25 });
      setEmailsState({ items: response.items, loading: false, error: null });
    } catch (err: any) {
      setEmailsState({ items: [], loading: false, error: err?.message || "Failed to load emails" });
    }
  }, [accessToken]);

  const loadTodayEvents = useCallback(async () => {
    if (!accessToken) {
      setTodayEventsState(INITIAL_TODAY_EVENTS);
      return;
    }

    setTodayEventsState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const todayStart = startOfDay(new Date());
      const tomorrowStart = addDays(todayStart, 1);

      const response = await fetchCalendarEvents({
        accessToken,
        rangeStart: todayStart.toISOString(),
        rangeEnd: tomorrowStart.toISOString(),
        assigned: "all",
        includeIgnored: false,
        limit: 20,
      });

      const filtered = response.events
        .filter((event) => !event.ignore && eventIntersectsRange(event, todayStart, tomorrowStart))
        .sort((a, b) => {
          const aStart = parseDate(a.startAt) ?? parseDate(a.endAt);
          const bStart = parseDate(b.startAt) ?? parseDate(b.endAt);
          const aTime = aStart ? aStart.getTime() : Number.POSITIVE_INFINITY;
          const bTime = bStart ? bStart.getTime() : Number.POSITIVE_INFINITY;
          return aTime - bTime;
        })
        .slice(0, 6);

      setTodayEventsState({ items: filtered, loading: false, error: null });
    } catch (err: any) {
      setTodayEventsState({ items: [], loading: false, error: err?.message || "Failed to load today's events" });
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setDigestLoading(false);
      setEmailsState((prev) => ({ ...prev, loading: false }));
      setTodayEventsState(INITIAL_TODAY_EVENTS);
      return;
    }
    void loadDigest();
    void loadEmails();
    void loadTodayEvents();
  }, [accessToken, loadDigest, loadEmails, loadTodayEvents]);

  const topActions = digestState.digest?.topActions ?? [];
  const timelineActions = useMemo(
    () => topActions.filter((action) => action.entityType === "timeline").slice(0, 5),
    [topActions]
  );

  const labelOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const email of emailsState.items) {
      if (email.category) {
        unique.add(email.category);
      }
    }
    return Array.from(unique).sort();
  }, [emailsState.items]);

  const filteredEmails = useMemo(() => {
    const cutoff = (() => {
      if (emailWindow === "24h") {
        return Date.now() - 24 * 60 * 60 * 1000;
      }
      if (emailWindow === "72h") {
        return Date.now() - 72 * 60 * 60 * 1000;
      }
      return null;
    })();

    return emailsState.items
      .filter((email) => {
        if (selectedLabel !== "all" && email.category !== selectedLabel) {
          return false;
        }
        if (cutoff != null) {
          const received = new Date(email.receivedAt).getTime();
          if (Number.isNaN(received) || received < cutoff) {
            return false;
          }
        }
        return true;
      })
      .slice(0, 10);
  }, [emailsState.items, emailWindow, selectedLabel]);

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Home</h1>
          <p className="mt-1 text-sm text-gray-600">
            Pulse across projects, urgent priorities, and inbox signals generated by the priority engine.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => {
              void loadDigest();
              void loadEmails();
              void loadTodayEvents();
            }}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
          >
            Refresh snapshot
          </button>
          <span className="rounded-full bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600">
            {digestState.digest ? `${topActions.length} priorities surfaced` : "Awaiting fresh data"}
          </span>
        </div>
      </header>

      {digestError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{digestError}</div>
      ) : null}

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-3">
          <DigestSummary state={digestState} loading={digestLoading} />
        </div>

        <div className="lg:col-span-3">
          <EmailWidget
            emails={filteredEmails}
            windowValue={emailWindow}
            onWindowChange={setEmailWindow}
            labelOptions={labelOptions}
            selectedLabel={selectedLabel}
            onLabelChange={setSelectedLabel}
            loading={emailsState.loading}
            error={emailsState.error}
          />
        </div>

        <div className="lg:col-span-2 grid gap-8">
          <TopPriorityGrid actions={topActions} />
          <UpcomingDeadlines actions={timelineActions} />
        </div>

        <div className="lg:col-span-1">
          <TodayEventsWidget
            events={todayEventsState.items}
            loading={todayEventsState.loading}
            error={todayEventsState.error}
          />
        </div>

        <div className="lg:col-span-3">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Project focus</h3>
            <p className="mt-1 text-sm text-gray-600">
              Digest snapshots surface trending health and approvals per project. Deeper drilldowns live inside each hub.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {(digestState.digest?.projects ?? []).slice(0, 3).map((snapshot: DigestProjectSnapshot) => (
                <div key={snapshot.project.id} className="rounded border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{snapshot.project.name}</p>
                      <p className="text-xs text-gray-500">
                        Health {snapshot.metrics.healthScore} • Trend {formatTrend(snapshot.metrics.trend)}
                      </p>
                    </div>
                    <span className="rounded bg-gray-900 px-2 py-1 text-xs font-semibold text-white">
                      {snapshot.topActions.length} top items
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div>
                      <dt className="uppercase tracking-wide text-gray-500">Open tasks</dt>
                      <dd className="text-sm font-semibold text-gray-900">{snapshot.metrics.openTasks}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-gray-500">Upcoming</dt>
                      <dd className="text-sm font-semibold text-gray-900">{snapshot.metrics.upcomingTimeline}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-gray-500">Linked emails</dt>
                      <dd className="text-sm font-semibold text-gray-900">{snapshot.metrics.linkedEmails}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wide text-gray-500">Approvals</dt>
                      <dd className="text-sm font-semibold text-gray-900">{snapshot.approvals.length}</dd>
                    </div>
                  </dl>
                </div>
              ))}
              {(digestState.digest?.projects?.length ?? 0) === 0 ? (
                <div className="rounded border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
                  Attach projects to see health summaries and top actions aggregate here.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
