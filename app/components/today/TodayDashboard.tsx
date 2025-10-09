"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DigestPayload,
  DigestRecord,
  DigestTopAction,
  ProjectDigestMetrics,
  DigestProjectSnapshot,
  UserPreferenceRecord,
} from "@kazador/shared";
import { useAuth } from "../AuthProvider";
import {
  fetchTodayDigest,
  fetchDigestHistory,
  type TodayDigestResponse,
} from "../../lib/supabaseClient";

interface LoadState {
  digest: DigestPayload | null;
  preferences: UserPreferenceRecord | null;
  generatedFor: string | null;
  history: DigestRecord[];
}

const DEFAULT_STATE: LoadState = {
  digest: null,
  preferences: null,
  generatedFor: null,
  history: [],
};

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

function TopActionsPanel({ actions }: { actions: DigestTopAction[] }) {
  if (!actions || actions.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Top Actions</h3>
        <p className="mt-2 text-sm text-gray-500">No urgent items detected. Enjoy the clear runway.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Top Actions</h3>
        <span className="text-xs uppercase tracking-wide text-gray-400">Prioritised by urgency & impact</span>
      </div>
      <ul className="mt-4 space-y-4">
        {actions.slice(0, 6).map((action) => (
          <li key={action.id} className="rounded border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{action.title}</p>
                <p className="text-xs text-gray-500">
                  {action.projectName} • {action.entityType === "email" ? "Email" : action.entityType === "timeline" ? "Timeline" : "Task"}
                  {action.startsAt
                    ? ` • ${formatDate(action.startsAt)}`
                    : action.dueAt
                    ? ` • ${formatDate(action.dueAt)}`
                    : ""}
                </p>
              </div>
              <span className="rounded bg-gray-900 px-2 py-1 text-xs font-semibold text-white">{Math.round(action.score)}</span>
            </div>
            {action.rationale && action.rationale.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-gray-500">
                {action.rationale.slice(0, 3).map((reason) => (
                  <li key={`${action.id}-${reason}`}>{reason}</li>
                ))}
                {action.rationale.length > 3 ? (
                  <li className="italic text-gray-400">+{action.rationale.length - 3} more factors</li>
                ) : null}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectCard({ snapshot }: { snapshot: DigestProjectSnapshot }) {
  const { project, metrics, topActions, approvals } = snapshot;
  const metricsList = [
    { label: "Open tasks", value: metrics.openTasks },
    { label: "Upcoming timeline", value: metrics.upcomingTimeline },
    { label: "Linked emails", value: metrics.linkedEmails },
    { label: "Conflicts", value: metrics.conflicts },
  ];

  const approvalsToShow = approvals.slice(0, 3);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-gray-900">{project.name}</h4>
          <p className="text-xs text-gray-500">
            {project.status === "archived" ? "Archived" : project.status === "paused" ? "Paused" : "Active"}
            {project.labels?.territory ? ` • ${String(project.labels.territory)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <span className="text-sm font-semibold text-gray-900">Health {metrics.healthScore ?? "—"}</span>
          <p className="text-xs text-gray-500">Trend: {formatTrend(metrics.trend)}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {metricsList.map((entry) => (
          <div key={entry.label} className="rounded border border-gray-100 bg-gray-50 p-3">
            <dt className="text-xs uppercase tracking-wide text-gray-500">{entry.label}</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900">{entry.value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h5 className="text-sm font-semibold text-gray-900">Focus items</h5>
        {topActions.length === 0 ? (
          <p className="mt-1 text-xs text-gray-500">No open tasks ranking in the Top 5.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-xs text-gray-600">
            {topActions.map((action) => (
              <li key={action.id} className="rounded border border-gray-100 bg-gray-50 p-2">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium text-gray-900">{action.title}</span>
                  <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {Math.round(action.score)}
                  </span>
                </div>
                {action.rationale && action.rationale.length > 0 ? (
                  <p className="mt-1 text-[11px] text-gray-500">{action.rationale[0]}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h5 className="text-sm font-semibold text-gray-900">Pending approvals</h5>
        {approvalsToShow.length === 0 ? (
          <p className="mt-1 text-xs text-gray-500">Nothing awaiting sign-off.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-xs text-gray-600">
            {approvalsToShow.map((approval) => (
              <li key={approval.id} className="rounded border border-amber-100 bg-amber-50 p-2">
                <div className="font-medium text-gray-900">
                  {approval.type.replace(/_/g, " ")}
                </div>
                <div className="text-[11px] text-gray-500">
                  Requested {approval.createdAt ? formatDate(approval.createdAt) : "recently"}
                </div>
              </li>
            ))}
            {approvals.length > approvalsToShow.length ? (
              <li className="text-[11px] italic text-gray-400">
                +{approvals.length - approvalsToShow.length} additional approvals queued
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function TodayDashboard() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [state, setState] = useState<LoadState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!accessToken) {
        setError("Authentication required. Please sign in again.");
        setLoading(false);
        return;
      }

      if (!opts.silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const [today, history] = await Promise.all([
          fetchTodayDigest({ accessToken }),
          fetchDigestHistory({ accessToken }),
        ] as [Promise<TodayDigestResponse>, Promise<DigestRecord[]>]);

        setState({
          digest: today.digest,
          preferences: today.preferences,
          generatedFor: today.generatedFor,
          history,
        });
      } catch (err: any) {
        setError(err?.message || "Failed to load digest overview");
      } finally {
        if (!opts.silent) {
          setLoading(false);
        }
      }
    },
    [accessToken]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const digest = state.digest;
  const topActions = digest?.topActions ?? [];
  const projectSnapshots = digest?.projects ?? [];

  const frequencyLabel = useMemo(() => {
    const freq = state.preferences?.digestFrequency ?? "daily";
    switch (freq) {
      case "weekly":
        return "Weekly";
      case "off":
        return "Disabled";
      default:
        return "Daily";
    }
  }, [state.preferences]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load({ silent: true });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !digest) {
    return (
      <div className="space-y-6">
        <header>
          <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-80 animate-pulse rounded bg-gray-100" />
        </header>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="h-48 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-48 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-48 animate-pulse rounded-lg bg-gray-100" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
        <button
          type="button"
          onClick={() => load({ silent: false })}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Today</h1>
          <p className="mt-1 text-sm text-gray-600">
            {frequencyLabel} digest • Generated {state.generatedFor ? formatDate(state.generatedFor) : "now"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing || !accessToken}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {refreshing ? "Refreshing…" : "Refresh digest"}
          </button>
        </div>
      </header>

      <TopActionsPanel actions={topActions} />

      <div className="grid gap-6 lg:grid-cols-2">
        {projectSnapshots.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">No active projects yet</h3>
            <p className="mt-2 text-sm text-gray-600">Create a project to start receiving prioritised actions and approvals.</p>
          </div>
        ) : (
          projectSnapshots.map((snapshot) => <ProjectCard key={snapshot.project.id} snapshot={snapshot} />)
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Digest history</h3>
        {state.history.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No previous digests captured yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Generated for</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Channel</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Top actions</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Created at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {state.history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-3 py-2 text-gray-900">{entry.generatedFor}</td>
                    <td className="px-3 py-2 text-gray-600 capitalize">{entry.channel}</td>
                    <td className="px-3 py-2 text-gray-600 capitalize">{entry.status}</td>
                    <td className="px-3 py-2 text-gray-600">{entry.payload?.topActions?.length ?? 0}</td>
                    <td className="px-3 py-2 text-gray-500">{formatDate(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
