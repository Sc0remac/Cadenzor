"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DigestPayload,
  DigestTopAction,
  ProjectDigestMetrics,
  DigestProjectSnapshot,
  UserPreferenceRecord,
  EmailRecord,
} from "@cadenzor/shared";
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

function DigestSummary({
  state,
  loading,
}: {
  state: DigestState;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="glass-surface animate-pulse rounded-2xl p-6">
        <div className="h-5 w-40 rounded-full bg-white/30" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <div className="h-3 w-24 rounded-full bg-white/20" />
              <div className="mt-3 h-6 w-16 rounded-full bg-white/30" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!state.digest) {
    return (
      <div className="glass-surface rounded-2xl border border-dashed border-white/20 px-6 py-6 text-slate-200">
        <h3 className="text-lg font-semibold text-white">Daily digest</h3>
        <p className="mt-2 text-sm text-slate-300">
          No digest available yet. Link projects and rerun the worker to populate insights.
        </p>
      </div>
    );
  }

  const { digest, preferences, generatedFor } = state;

  return (
    <div className="glass-surface rounded-2xl px-6 py-6 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-xl font-semibold text-white">Daily digest</h3>
          <p className="text-sm text-slate-300">
            Generated {generatedFor ? formatDate(generatedFor) : formatDate(digest.generatedAt)} • Frequency {preferences?.digestFrequency ?? "daily"}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-brand-300/40 bg-brand-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-brand-200">
          <span>{digest.meta.totalProjects} projects</span>
          <span className="text-white/50">•</span>
          <span>{digest.meta.totalPendingApprovals} approvals</span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Highlighted projects</p>
          <p className="mt-2 text-3xl font-semibold text-white">{digest.meta.highlightedProjects}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Top actions surfaced</p>
          <p className="mt-2 text-3xl font-semibold text-white">{digest.topActions.length}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Delivery channel</p>
          <p className="mt-2 text-base font-semibold text-white">
            {(preferences?.channels ?? ["web"]).join(", ")}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Digest hour ({preferences?.timezone ?? "UTC"})</p>
          <p className="mt-2 text-3xl font-semibold text-white">{preferences?.digestHour ?? 8}:00</p>
        </div>
      </div>
    </div>
  );
}

function TopPriorityGrid({ actions }: { actions: DigestTopAction[] }) {
  if (!actions.length) {
    return (
      <div className="glass-surface rounded-2xl border border-dashed border-white/30 px-6 py-6 text-sm text-slate-200">
        No ranked priorities yet. As projects accumulate tasks, high-impact work will appear here.
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {actions.slice(0, 4).map((action) => (
        <div
          key={action.id}
          className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 text-slate-100 shadow-glow transition duration-300 ease-gentle-spring hover:-translate-y-1 hover:border-white/20 hover:bg-white/10"
        >
          <div className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 ease-gentle-spring group-hover:opacity-100">
            <div className="absolute -right-6 -top-10 h-32 w-32 rotate-12 rounded-full bg-hero-gradient opacity-40 blur-2xl" />
          </div>
          <div className="relative flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-white">{action.title}</p>
              <p className="text-xs text-slate-300">
                {action.projectName} • {action.entityType === "email" ? "Email" : action.entityType === "timeline" ? "Timeline" : "Task"}
              </p>
            </div>
            <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-2 py-1 text-xs font-semibold text-brand-200">
              {Math.round(action.score)}
            </span>
          </div>
          {action.rationale && action.rationale.length > 0 ? (
            <p className="mt-3 text-xs text-slate-200/80">{action.rationale[0]}</p>
          ) : null}
          {(action.startsAt || action.dueAt) && (
            <p className="mt-4 text-xs uppercase tracking-widest text-slate-400">
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
      <div className="glass-surface h-full rounded-2xl border border-dashed border-white/20 px-6 py-6 text-sm text-slate-200">
        Upcoming timeline items will land here once the priority engine has fresh data.
      </div>
    );
  }

  return (
    <div className="glass-surface rounded-2xl px-6 py-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Upcoming deadlines</h3>
        <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-200">Timeline focus</span>
      </div>
      <ul className="mt-5 space-y-3">
        {actions.map((action) => (
          <li key={action.id} className="rounded-xl border border-white/10 bg-white/5 p-4 text-slate-100 transition duration-300 ease-gentle-spring hover:border-white/20 hover:bg-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">{action.title}</p>
                <p className="text-xs text-slate-300">{action.projectName}</p>
              </div>
              <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
                {formatDate(action.startsAt || action.dueAt)}
              </span>
            </div>
            {action.rationale && action.rationale.length > 0 ? (
              <p className="mt-3 text-xs text-slate-200/80">{action.rationale[0]}</p>
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
    <div className="glass-surface rounded-2xl px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-white">Recent emails</h3>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
          <label className="flex items-center gap-2">
            <span className="text-slate-200">Window</span>
            <select
              value={windowValue}
              onChange={(event) => onWindowChange(event.target.value as EmailWindow)}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-slate-100 transition hover:border-white/40"
            >
              {EMAIL_WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-slate-200">Label</span>
            <select
              value={selectedLabel}
              onChange={(event) => onLabelChange(event.target.value)}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-slate-100 transition hover:border-white/40"
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
        <p className="mt-3 text-sm text-rose-200">{error}</p>
      ) : null}
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-[0.3em] text-slate-200">
            <tr>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Received</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-white/0 text-slate-100">
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={`loading-${index}`} className="animate-pulse">
                  <td className="px-4 py-3">
                    <div className="h-3 w-40 rounded-full bg-white/20" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-24 rounded-full bg-white/20" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-20 rounded-full bg-white/20" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-24 rounded-full bg-white/20" />
                  </td>
                </tr>
              ))
            ) : emails.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-300">
                  No emails match the current filters.
                </td>
              </tr>
            ) : (
              emails.map((email) => (
                <tr key={email.id} className="transition duration-200 ease-gentle-spring hover:bg-white/5">
                  <td className="px-4 py-3 text-sm font-semibold text-white">{email.subject || "(no subject)"}</td>
                  <td className="px-4 py-3 text-sm text-slate-200">
                    {email.fromName ? `${email.fromName} • ${email.fromEmail}` : email.fromEmail}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-brand-200">{email.category}</td>
                  <td className="px-4 py-3 text-xs text-slate-300">{formatDate(email.receivedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CalendarPlaceholder() {
  return (
    <div className="glass-surface h-full rounded-2xl px-6 py-6 text-slate-100">
      <h3 className="text-lg font-semibold text-white">Calendar snapshot</h3>
      <p className="mt-2 text-sm text-slate-300">
        Calendar integrations are on deck. Upcoming meetings, holds, and travel windows will populate this panel once
        connected.
      </p>
      <div className="mt-4 space-y-3 text-sm">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span>Hook up Google Calendar to surface interviews, travel holds, and rehearsals.</span>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100">
          <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
          <span>Link agency itineraries to blend external invites alongside Cadenzor deadlines.</span>
        </div>
      </div>
    </div>
  );
}

export default function HomeDashboard() {
  const { session, user } = useAuth();
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

  return (
    <section className="space-y-10 text-slate-100">
      <header className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-glow md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-200">
            Pulse overview
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Welcome back, {user?.user_metadata?.full_name?.split(" ")[0] ?? "team"}
          </h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Pulse across projects, urgent priorities, and inbox signals generated by the priority engine.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => {
              void loadDigest();
              void loadEmails();
            }}
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-white/15 bg-white/10 px-5 py-2 text-sm font-semibold text-white shadow-glow transition duration-300 ease-gentle-spring hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/20"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-brand-500 via-rose-500 to-sky-500 opacity-70 transition duration-300 ease-gentle-spring group-hover:opacity-90" />
            <span className="relative flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-300 animate-ping" aria-hidden />
              Refresh snapshot
            </span>
          </button>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200">
            <span className="h-2 w-2 rounded-full bg-brand-400" aria-hidden />
            {digestState.digest ? `${topActions.length} priorities surfaced` : "Awaiting fresh data"}
          </span>
        </div>
      </header>

      {digestError ? (
        <div className="glass-surface rounded-2xl border border-rose-500/40 px-4 py-3 text-sm text-rose-100 shadow-glow">{digestError}</div>
      ) : null}

      <DigestSummary state={digestState} loading={digestLoading} />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <TopPriorityGrid actions={topActions} />
          <UpcomingDeadlines actions={timelineActions} />
        </div>
        <CalendarPlaceholder />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-surface rounded-2xl px-6 py-6">
          <h3 className="text-lg font-semibold text-white">Project focus</h3>
          <p className="mt-1 text-sm text-slate-300">
            Digest snapshots surface trending health and approvals per project. Deeper drilldowns live inside each hub.
          </p>
          <div className="mt-5 grid gap-4">
            {(digestState.digest?.projects ?? []).slice(0, 3).map((snapshot: DigestProjectSnapshot) => (
              <div key={snapshot.project.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-slate-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">{snapshot.project.name}</p>
                    <p className="text-xs text-slate-300">
                      Health {snapshot.metrics.healthScore} • Trend {formatTrend(snapshot.metrics.trend)}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-brand-500/20 px-3 py-1 text-xs font-semibold text-brand-100">
                    {snapshot.topActions.length} top items
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-200">
                  <div>
                    <dt className="uppercase tracking-[0.3em] text-slate-400">Open tasks</dt>
                    <dd className="text-lg font-semibold text-white">{snapshot.metrics.openTasks}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.3em] text-slate-400">Upcoming</dt>
                    <dd className="text-lg font-semibold text-white">{snapshot.metrics.upcomingTimeline}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.3em] text-slate-400">Linked emails</dt>
                    <dd className="text-lg font-semibold text-white">{snapshot.metrics.linkedEmails}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.3em] text-slate-400">Approvals</dt>
                    <dd className="text-lg font-semibold text-white">{snapshot.approvals.length}</dd>
                  </div>
                </dl>
              </div>
            ))}
            {(digestState.digest?.projects?.length ?? 0) === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-slate-300">
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
