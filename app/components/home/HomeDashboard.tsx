"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DigestPayload,
  DigestTopAction,
  ProjectDigestMetrics,
  DigestProjectSnapshot,
  UserPreferenceRecord,
  EmailRecord,
  TimelineItemRecord,
} from "@kazador/shared";
import { useAuth } from "../AuthProvider";
import {
  fetchTodayDigest,
  fetchRecentEmails,
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

function getMeetingUrl(item: TimelineItemRecord): string | null {
  const links = item.links ?? {};
  const labels = item.labels ?? {};
  const link = (links as Record<string, any>).meetingUrl || (labels as Record<string, any>).meetingUrl;
  return typeof link === "string" ? link : null;
}

function formatMeetingTime(value: string | null): string {
  if (!value) return "TBC";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface UpcomingMeeting {
  id: string;
  title: string;
  projectName: string;
  startsAt: string | null;
  meetingUrl: string | null;
  lane?: string | null;
  status: string;
}

function MeetingsSnapshot({ meetings, loading }: { meetings: UpcomingMeeting[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Today's meetings</h3>
        <p className="mt-2 text-sm text-gray-500">Loading calendar data…</p>
      </div>
    );
  }

  if (meetings.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-center text-gray-500 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Today's meetings</h3>
        <p className="mt-2 text-sm">No calendar events on the horizon. Pull a calendar to keep this view populated.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Today's meetings</h3>
      <ul className="mt-4 space-y-3">
        {meetings.map((meeting) => (
          <li key={meeting.id} className="flex flex-col gap-2 rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">{meeting.title}</p>
                <p className="text-xs text-gray-500">
                  {meeting.projectName} • {formatMeetingTime(meeting.startsAt)}
                </p>
              </div>
              <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600 uppercase">
                {meeting.status}
              </span>
            </div>
            {meeting.meetingUrl ? (
              <div>
                <a
                  href={meeting.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-700"
                >
                  Join meeting
                  <span aria-hidden>↗</span>
                </a>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
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

  useEffect(() => {
    if (!accessToken) {
      setDigestLoading(false);
      setEmailsState((prev) => ({ ...prev, loading: false }));
      return;
    }
    void loadDigest();
    void loadEmails();
  }, [accessToken, loadDigest, loadEmails]);

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

  const calendarMeetings = useMemo(() => {
    const digestProjects = digestState.digest?.projects ?? [];
    if (digestProjects.length === 0) return [];
    const now = Date.now();
    const windowEnd = now + 24 * 60 * 60 * 1000; // next 24h

    const meetings: UpcomingMeeting[] = [];
    for (const snapshot of digestProjects) {
      const projectName = snapshot.project.name;
      for (const item of snapshot.timelineItems ?? []) {
        const meetingUrl = getMeetingUrl(item);
        const hasCalendarLink = Boolean((item.links as Record<string, any>)?.calendarId);
        if (!hasCalendarLink) continue;
        if (!item.startsAt) continue;
        const startMs = Date.parse(item.startsAt);
        if (Number.isNaN(startMs)) continue;
        if (startMs < now - 60 * 60 * 1000) continue; // ignore items older than 1h
        if (startMs > windowEnd) continue;
        meetings.push({
          id: item.id,
          title: item.title,
          projectName,
          startsAt: item.startsAt,
          meetingUrl,
          lane: item.lane,
          status: item.status,
        });
      }
    }

    return meetings.sort((a, b) => {
      const aMs = a.startsAt ? Date.parse(a.startsAt) : Number.POSITIVE_INFINITY;
      const bMs = b.startsAt ? Date.parse(b.startsAt) : Number.POSITIVE_INFINITY;
      return aMs - bMs;
    }).slice(0, 5);
  }, [digestState.digest]);

  return (
    <section className="space-y-8">
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

      <DigestSummary state={digestState} loading={digestLoading} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          <TopPriorityGrid actions={topActions} />
          <UpcomingDeadlines actions={timelineActions} />
        </div>
        <MeetingsSnapshot meetings={calendarMeetings} loading={digestLoading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Project focus</h3>
          <p className="mt-1 text-sm text-gray-600">
            Digest snapshots surface trending health and approvals per project. Deeper drilldowns live inside each hub.
          </p>
          <div className="mt-4 grid gap-4">
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
    </section>
  );
}
