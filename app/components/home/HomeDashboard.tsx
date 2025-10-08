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
      <div className="surface-panel animate-pulse p-8">
        <div className="h-5 w-40 rounded-full bg-white/20" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="surface-card p-4">
              <div className="h-3 w-24 rounded-full bg-white/15" />
              <div className="mt-3 h-6 w-16 rounded-full bg-white/20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!state.digest) {
    return (
      <div className="surface-panel border border-dashed border-white/15 px-8 py-8 text-secondary">
        <h3 className="font-display text-xl tracking-[0.18em] text-primary">Daily digest</h3>
        <p className="mt-3 text-sm text-tertiary">
          No digest available yet. Link projects and rerun the worker to populate insights.
        </p>
      </div>
    );
  }

  const { digest, preferences, generatedFor } = state;

  return (
    <div className="surface-hero overflow-hidden px-8 py-8 text-secondary">
      <div className="pointer-events-none absolute -top-32 right-12 h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,201,245,0.25),transparent_60%)] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 left-16 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(217,70,239,0.16),transparent_70%)] blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-2">
          <h3 className="font-display text-[1.75rem] tracking-[0.2em] text-primary">
            Daily digest
          </h3>
          <p className="text-sm text-tertiary">
            Generated {generatedFor ? formatDate(generatedFor) : formatDate(digest.generatedAt)} • Frequency {preferences?.digestFrequency ?? "daily"}
          </p>
        </div>
        <div className="relative inline-flex items-center gap-3 rounded-full border border-white/10 bg-[rgba(31,122,224,0.18)] px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
          <span>{digest.meta.totalProjects} projects</span>
          <span className="text-white/60">•</span>
          <span>{digest.meta.totalPendingApprovals} approvals</span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="surface-card p-5">
          <p className="text-xs uppercase tracking-[0.35em] text-tertiary">Highlighted projects</p>
          <p className="mt-3 font-display text-3xl tracking-[0.12em] text-primary">{digest.meta.highlightedProjects}</p>
        </div>
        <div className="surface-card p-5">
          <p className="text-xs uppercase tracking-[0.35em] text-tertiary">Top actions surfaced</p>
          <p className="mt-3 font-display text-3xl tracking-[0.12em] text-primary">{digest.topActions.length}</p>
        </div>
        <div className="surface-card p-5">
          <p className="text-xs uppercase tracking-[0.35em] text-tertiary">Delivery channel</p>
          <p className="mt-3 text-sm font-semibold text-primary">
            {(preferences?.channels ?? ["web"]).join(", ")}
          </p>
        </div>
        <div className="surface-card p-5">
          <p className="text-xs uppercase tracking-[0.35em] text-tertiary">
            Digest hour ({preferences?.timezone ?? "UTC"})
          </p>
          <p className="mt-3 font-display text-3xl tracking-[0.12em] text-primary">{preferences?.digestHour ?? 8}:00</p>
        </div>
      </div>
    </div>
  );
}

function TopPriorityGrid({ actions }: { actions: DigestTopAction[] }) {
  if (!actions.length) {
    return (
      <div className="surface-panel border border-dashed border-white/20 px-7 py-7 text-sm text-tertiary">
        No ranked priorities yet. As projects accumulate tasks, high-impact work will appear here.
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {actions.slice(0, 4).map((action, index) => (
        <div
          key={action.id}
          className={`group relative overflow-hidden surface-card p-6 text-secondary transition duration-300 ease-gentle-spring hover:-translate-y-1 hover:shadow-ambient-md ${
            index % 2 === 1 ? "lg:-translate-y-2" : "lg:translate-y-1"
          }`}
        >
          <div className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 ease-gentle-spring group-hover:opacity-100">
            <div className="absolute -right-6 -top-12 h-32 w-32 rotate-12 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,201,245,0.32),transparent_65%)] blur-2xl" />
          </div>
          <div className="relative flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-primary tracking-[0.08em]">{action.title}</p>
              <p className="text-xs uppercase tracking-[0.3em] text-tertiary">
                {action.projectName} • {action.entityType === "email" ? "Email" : action.entityType === "timeline" ? "Timeline" : "Task"}
              </p>
            </div>
            <span className="inline-flex items-center rounded-full border border-white/15 bg-[rgba(59,201,245,0.12)] px-3 py-1 text-xs font-semibold text-primary">
              {Math.round(action.score)}
            </span>
          </div>
          {action.rationale && action.rationale.length > 0 ? (
            <p className="mt-3 text-sm text-secondary/90">{action.rationale[0]}</p>
          ) : null}
          {(action.startsAt || action.dueAt) && (
            <p className="mt-4 text-xs uppercase tracking-[0.4em] text-tertiary">
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
      <div className="surface-panel h-full border border-dashed border-white/20 px-7 py-7 text-sm text-tertiary">
        Upcoming timeline items will land here once the priority engine has fresh data.
      </div>
    );
  }

  return (
    <div className="surface-panel px-7 py-7">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg tracking-[0.22em] text-primary">Upcoming deadlines</h3>
        <span className="rounded-full bg-[rgba(59,201,245,0.14)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.38em] text-primary">Timeline focus</span>
      </div>
      <ul className="mt-5 space-y-3">
        {actions.map((action) => (
          <li key={action.id} className="surface-card p-4 text-secondary transition duration-300 ease-gentle-spring hover:border-white/20 hover:text-primary">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-primary tracking-[0.08em]">{action.title}</p>
                <p className="text-xs uppercase tracking-[0.28em] text-tertiary">{action.projectName}</p>
              </div>
              <span className="rounded-full border border-white/15 bg-[rgba(59,201,245,0.12)] px-3 py-1 text-xs font-semibold text-primary">
                {formatDate(action.startsAt || action.dueAt)}
              </span>
            </div>
            {action.rationale && action.rationale.length > 0 ? (
              <p className="mt-3 text-sm text-secondary/90">{action.rationale[0]}</p>
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
    <div className="surface-panel px-7 py-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="font-display text-lg tracking-[0.22em] text-primary">Recent emails</h3>
        <div className="flex flex-wrap items-center gap-3 text-xs text-secondary">
          <label className="flex items-center gap-2">
            <span className="text-secondary">Window</span>
            <select
              value={windowValue}
              onChange={(event) => onWindowChange(event.target.value as EmailWindow)}
              className="rounded-full border border-white/10 bg-[rgba(25,31,52,0.8)] px-3 py-1 text-secondary transition hover:border-white/30 hover:text-primary"
            >
              {EMAIL_WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-secondary">Label</span>
            <select
              value={selectedLabel}
              onChange={(event) => onLabelChange(event.target.value)}
              className="rounded-full border border-white/10 bg-[rgba(25,31,52,0.8)] px-3 py-1 text-secondary transition hover:border-white/30 hover:text-primary"
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
        <p className="mt-3 text-sm text-primary">{error}</p>
      ) : null}
      <div className="mt-5 overflow-hidden rounded-[18px] border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
          <thead className="bg-[rgba(22,28,43,0.75)] text-xs uppercase tracking-[0.35em] text-tertiary">
            <tr>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Received</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 bg-[rgba(12,16,32,0.35)] text-secondary">
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={`loading-${index}`} className="animate-pulse">
                  <td className="px-4 py-3">
                    <div className="h-3 w-40 rounded-full bg-white/15" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-24 rounded-full bg-white/15" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-20 rounded-full bg-white/15" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-24 rounded-full bg-white/15" />
                  </td>
                </tr>
              ))
            ) : emails.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-tertiary">
                  No emails match the current filters.
                </td>
              </tr>
            ) : (
              emails.map((email) => (
                <tr key={email.id} className="transition duration-200 ease-gentle-spring hover:bg-[rgba(26,32,52,0.45)]">
                  <td className="px-4 py-3 text-sm font-semibold text-primary tracking-[0.06em]">{email.subject || "(no subject)"}</td>
                  <td className="px-4 py-3 text-sm text-secondary">
                    {email.fromName ? `${email.fromName} • ${email.fromEmail}` : email.fromEmail}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-primary">{email.category}</td>
                  <td className="px-4 py-3 text-xs text-tertiary">{formatDate(email.receivedAt)}</td>
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
    <div className="surface-panel relative h-full overflow-hidden px-7 py-7 text-secondary">
      <div className="pointer-events-none absolute -top-24 right-0 h-48 w-48 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,201,245,0.24),transparent_70%)] blur-3xl" />
      <h3 className="font-display text-lg tracking-[0.22em] text-primary">Calendar snapshot</h3>
      <p className="mt-3 text-sm text-secondary">
        Calendar integrations are on deck. Upcoming meetings, holds, and travel windows will populate this panel once
        connected.
      </p>
      <div className="mt-5 space-y-3 text-sm">
        <div className="surface-card flex items-center gap-3 p-4 text-secondary">
          <span className="h-2.5 w-2.5 rounded-full bg-[rgba(59,201,245,0.8)]" />
          <span>Hook up Google Calendar to surface interviews, travel holds, and rehearsals.</span>
        </div>
        <div className="surface-card flex items-center gap-3 p-4 text-secondary">
          <span className="h-2.5 w-2.5 rounded-full bg-[rgba(148,63,255,0.65)]" />
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
    <section className="space-y-14 text-secondary">
      <header className="surface-hero relative overflow-hidden px-8 py-8 md:flex md:items-center md:justify-between">
        <div className="pointer-events-none absolute -top-28 left-10 h-56 w-56 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,201,245,0.24),transparent_70%)] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-16 h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,rgba(148,63,255,0.22),transparent_70%)] blur-3xl" />
        <div className="relative space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[rgba(31,122,224,0.2)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.42em] text-primary">
            Pulse overview
          </div>
          <h1 className="font-display text-[2.5rem] tracking-[0.28em] text-primary sm:text-[2.75rem]">
            Welcome back, {user?.user_metadata?.full_name?.split(" ")[0] ?? "team"}
          </h1>
          <p className="max-w-2xl text-sm text-secondary">
            Pulse across projects, urgent priorities, and inbox signals generated by the priority engine.
          </p>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-3 text-xs md:mt-0">
          <button
            type="button"
            onClick={() => {
              void loadDigest();
              void loadEmails();
            }}
            className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full border border-white/10 bg-[rgba(59,201,245,0.16)] px-6 py-2 text-sm font-semibold text-primary shadow-[0_32px_80px_-38px_rgba(59,201,245,0.65)] transition duration-300 ease-gentle-spring hover:-translate-y-0.5 hover:shadow-[0_36px_90px_-36px_rgba(59,201,245,0.75)]"
          >
            <span className="absolute inset-0 bg-[linear-gradient(120deg,rgba(59,201,245,0.85),rgba(31,122,224,0.65))] opacity-70 transition duration-300 ease-gentle-spring group-hover:opacity-100" />
            <span className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.45)_45%,rgba(255,255,255,0)_75%)] bg-[length:220%_100%] opacity-0 transition duration-500 ease-linear group-hover:opacity-100" />
            <span className="relative flex items-center gap-2 tracking-[0.24em] uppercase">
              <span className="h-2 w-2 rounded-full bg-[rgba(59,201,245,0.9)] animate-pulse" aria-hidden />
              Refresh snapshot
            </span>
          </button>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[rgba(17,23,40,0.7)] px-4 py-2 text-xs font-semibold text-secondary">
            <span className="h-2 w-2 rounded-full bg-[rgba(59,201,245,0.7)]" aria-hidden />
            {digestState.digest ? `${topActions.length} priorities surfaced` : "Awaiting fresh data"}
          </span>
        </div>
      </header>

      {digestError ? (
        <div className="surface-panel border border-[rgba(217,70,239,0.45)] px-4 py-3 text-sm text-primary">{digestError}</div>
      ) : null}

      <DigestSummary state={digestState} loading={digestLoading} />

      <div className="h-px w-full bg-[linear-gradient(90deg,rgba(59,201,245,0)_0%,rgba(59,201,245,0.3)_50%,rgba(217,70,239,0)_100%)]" />

      <div className="grid gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          <TopPriorityGrid actions={topActions} />
          <UpcomingDeadlines actions={timelineActions} />
        </div>
        <CalendarPlaceholder />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="surface-hero relative overflow-hidden px-7 py-7">
          <div className="pointer-events-none absolute -top-20 right-16 h-52 w-52 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,201,245,0.24),transparent_68%)] blur-3xl" />
          <h3 className="font-display text-lg tracking-[0.24em] text-primary">Project focus</h3>
          <p className="mt-2 text-sm text-secondary">
            Digest snapshots surface trending health and approvals per project. Deeper drilldowns live inside each hub.
          </p>
          <div className="mt-6 grid gap-4">
            {(digestState.digest?.projects ?? []).slice(0, 3).map((snapshot: DigestProjectSnapshot) => (
              <div key={snapshot.project.id} className="surface-card p-5 text-secondary">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-primary tracking-[0.08em]">{snapshot.project.name}</p>
                    <p className="text-xs uppercase tracking-[0.3em] text-tertiary">
                      Health {snapshot.metrics.healthScore} • Trend {formatTrend(snapshot.metrics.trend)}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/15 bg-[rgba(59,201,245,0.12)] px-3 py-1 text-xs font-semibold text-primary">
                    {snapshot.topActions.length} top items
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-secondary">
                  <div>
                    <dt className="uppercase tracking-[0.34em] text-tertiary">Open tasks</dt>
                    <dd className="font-display text-xl tracking-[0.12em] text-primary">{snapshot.metrics.openTasks}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.34em] text-tertiary">Upcoming</dt>
                    <dd className="font-display text-xl tracking-[0.12em] text-primary">{snapshot.metrics.upcomingTimeline}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.34em] text-tertiary">Linked emails</dt>
                    <dd className="font-display text-xl tracking-[0.12em] text-primary">{snapshot.metrics.linkedEmails}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.34em] text-tertiary">Approvals</dt>
                    <dd className="font-display text-xl tracking-[0.12em] text-primary">{snapshot.approvals.length}</dd>
                  </div>
                </dl>
              </div>
            ))}
            {(digestState.digest?.projects?.length ?? 0) === 0 ? (
              <div className="surface-card border border-dashed border-white/15 p-5 text-sm text-tertiary">
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
