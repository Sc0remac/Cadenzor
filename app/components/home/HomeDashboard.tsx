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
<<<<<<< ours
<<<<<<< ours
      <div className="glass-surface animate-pulse rounded-2xl p-6">
        <div className="h-5 w-40 rounded-full bg-white/30" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <div className="h-3 w-24 rounded-full bg-white/20" />
              <div className="mt-3 h-6 w-16 rounded-full bg-white/30" />
=======
      <div className="surface-panel animate-pulse p-8">
        <div className="h-5 w-40 rounded-full bg-white/20" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="surface-card p-4">
              <div className="h-3 w-24 rounded-full bg-white/15" />
              <div className="mt-3 h-6 w-16 rounded-full bg-white/20" />
>>>>>>> theirs
=======
      <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="h-5 w-32 rounded bg-gray-200" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded border border-gray-100 bg-gray-50 p-4">
              <div className="h-3 w-20 rounded bg-gray-200" />
              <div className="mt-2 h-6 w-16 rounded bg-gray-200" />
>>>>>>> theirs
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!state.digest) {
    return (
<<<<<<< ours
<<<<<<< ours
      <div className="glass-surface rounded-2xl border border-dashed border-white/20 px-6 py-6 text-slate-200">
        <h3 className="text-lg font-semibold text-white">Daily digest</h3>
        <p className="mt-2 text-sm text-slate-300">
=======
      <div className="surface-panel border border-dashed border-white/15 px-8 py-8 text-secondary">
        <h3 className="font-display text-xl tracking-[0.18em] text-primary">Daily digest</h3>
        <p className="mt-3 text-sm text-tertiary">
>>>>>>> theirs
          No digest available yet. Link projects and rerun the worker to populate insights.
        </p>
=======
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-gray-500 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Daily digest</h3>
        <p className="mt-2 text-sm">No digest available yet. Link projects and rerun the worker to populate insights.</p>
>>>>>>> theirs
      </div>
    );
  }

  const { digest, preferences, generatedFor } = state;

  return (
<<<<<<< ours
<<<<<<< ours
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
=======
    <div className="surface-hero overflow-hidden px-8 py-8 text-secondary">
      <div className="pointer-events-none absolute -top-32 right-12 h-64 w-64 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,201,245,0.25),transparent_60%)] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 left-16 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_center,rgba(217,70,239,0.16),transparent_70%)] blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-2">
          <h3 className="font-display text-[1.75rem] tracking-[0.2em] text-primary">
            Daily digest
          </h3>
          <p className="text-sm text-tertiary">
=======
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Daily digest</h3>
          <p className="text-sm text-gray-500">
>>>>>>> theirs
            Generated {generatedFor ? formatDate(generatedFor) : formatDate(digest.generatedAt)} • Frequency {preferences?.digestFrequency ?? "daily"}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          <span>{digest.meta.totalProjects} projects</span>
<<<<<<< ours
          <span className="text-white/60">•</span>
>>>>>>> theirs
=======
          <span>•</span>
>>>>>>> theirs
          <span>{digest.meta.totalPendingApprovals} approvals</span>
        </div>
      </div>

<<<<<<< ours
<<<<<<< ours
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
=======
      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="surface-card p-5">
          <p className="text-xs uppercase tracking-[0.35em] text-tertiary">Highlighted projects</p>
          <p className="mt-3 font-display text-3xl tracking-[0.12em] text-primary">{digest.meta.highlightedProjects}</p>
=======
      <div className="mt-4 grid gap-4 md:grid-cols-4">
        <div className="rounded border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Highlighted projects</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{digest.meta.highlightedProjects}</p>
>>>>>>> theirs
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
<<<<<<< ours
        <div className="surface-card p-5">
          <p className="text-xs uppercase tracking-[0.35em] text-tertiary">
            Digest hour ({preferences?.timezone ?? "UTC"})
          </p>
          <p className="mt-3 font-display text-3xl tracking-[0.12em] text-primary">{preferences?.digestHour ?? 8}:00</p>
>>>>>>> theirs
=======
        <div className="rounded border border-gray-100 bg-gray-50 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Digest hour ({preferences?.timezone ?? "UTC"})</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{preferences?.digestHour ?? 8}:00</p>
>>>>>>> theirs
        </div>
      </div>
    </div>
  );
}

function TopPriorityGrid({ actions }: { actions: DigestTopAction[] }) {
  if (!actions.length) {
    return (
<<<<<<< ours
<<<<<<< ours
      <div className="glass-surface rounded-2xl border border-dashed border-white/30 px-6 py-6 text-sm text-slate-200">
=======
      <div className="surface-panel border border-dashed border-white/20 px-7 py-7 text-sm text-tertiary">
>>>>>>> theirs
=======
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-gray-500 shadow-sm">
>>>>>>> theirs
        No ranked priorities yet. As projects accumulate tasks, high-impact work will appear here.
      </div>
    );
  }

  return (
<<<<<<< ours
<<<<<<< ours
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
=======
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
>>>>>>> theirs
              {Math.round(action.score)}
            </span>
          </div>
          {action.rationale && action.rationale.length > 0 ? (
<<<<<<< ours
            <p className="mt-3 text-xs text-slate-200/80">{action.rationale[0]}</p>
          ) : null}
          {(action.startsAt || action.dueAt) && (
            <p className="mt-4 text-xs uppercase tracking-widest text-slate-400">
=======
            <p className="mt-3 text-sm text-secondary/90">{action.rationale[0]}</p>
          ) : null}
          {(action.startsAt || action.dueAt) && (
            <p className="mt-4 text-xs uppercase tracking-[0.4em] text-tertiary">
>>>>>>> theirs
=======
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
>>>>>>> theirs
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
<<<<<<< ours
<<<<<<< ours
      <div className="glass-surface h-full rounded-2xl border border-dashed border-white/20 px-6 py-6 text-sm text-slate-200">
=======
      <div className="surface-panel h-full border border-dashed border-white/20 px-7 py-7 text-sm text-tertiary">
>>>>>>> theirs
=======
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-gray-500 shadow-sm h-full">
>>>>>>> theirs
        Upcoming timeline items will land here once the priority engine has fresh data.
      </div>
    );
  }

  return (
<<<<<<< ours
<<<<<<< ours
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
=======
    <div className="surface-panel px-7 py-7">
=======
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
>>>>>>> theirs
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
<<<<<<< ours
              <span className="rounded-full border border-white/15 bg-[rgba(59,201,245,0.12)] px-3 py-1 text-xs font-semibold text-primary">
>>>>>>> theirs
=======
              <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
>>>>>>> theirs
                {formatDate(action.startsAt || action.dueAt)}
              </span>
            </div>
            {action.rationale && action.rationale.length > 0 ? (
<<<<<<< ours
<<<<<<< ours
              <p className="mt-3 text-xs text-slate-200/80">{action.rationale[0]}</p>
=======
              <p className="mt-3 text-sm text-secondary/90">{action.rationale[0]}</p>
>>>>>>> theirs
=======
              <p className="mt-2 text-xs text-gray-500">{action.rationale[0]}</p>
>>>>>>> theirs
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
<<<<<<< ours
<<<<<<< ours
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
=======
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
>>>>>>> theirs
=======
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
>>>>>>> theirs
            >
              {EMAIL_WINDOWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
<<<<<<< ours
          <label className="flex items-center gap-2">
<<<<<<< ours
            <span className="text-slate-200">Label</span>
            <select
              value={selectedLabel}
              onChange={(event) => onLabelChange(event.target.value)}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-slate-100 transition hover:border-white/40"
=======
            <span className="text-secondary">Label</span>
            <select
              value={selectedLabel}
              onChange={(event) => onLabelChange(event.target.value)}
              className="rounded-full border border-white/10 bg-[rgba(25,31,52,0.8)] px-3 py-1 text-secondary transition hover:border-white/30 hover:text-primary"
>>>>>>> theirs
=======
          <label className="flex items-center gap-1 text-gray-500">
            Label
            <select
              value={selectedLabel}
              onChange={(event) => onLabelChange(event.target.value)}
              className="rounded border border-gray-300 bg-white px-2 py-1"
>>>>>>> theirs
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
<<<<<<< ours
<<<<<<< ours
        <p className="mt-3 text-sm text-rose-200">{error}</p>
      ) : null}
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-[0.3em] text-slate-200">
=======
        <p className="mt-3 text-sm text-primary">{error}</p>
      ) : null}
      <div className="mt-5 overflow-hidden rounded-[18px] border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
          <thead className="bg-[rgba(22,28,43,0.75)] text-xs uppercase tracking-[0.35em] text-tertiary">
>>>>>>> theirs
=======
        <p className="mt-3 text-sm text-red-600">{error}</p>
      ) : null}
      <div className="mt-4 overflow-hidden rounded border border-gray-100">
        <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
>>>>>>> theirs
            <tr>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Received</th>
            </tr>
          </thead>
<<<<<<< ours
<<<<<<< ours
          <tbody className="divide-y divide-white/5 bg-white/0 text-slate-100">
=======
          <tbody className="divide-y divide-white/5 bg-[rgba(12,16,32,0.35)] text-secondary">
>>>>>>> theirs
=======
          <tbody className="divide-y divide-gray-100 bg-white">
>>>>>>> theirs
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={`loading-${index}`} className="animate-pulse">
                  <td className="px-4 py-3">
<<<<<<< ours
<<<<<<< ours
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
=======
                    <div className="h-3 w-40 rounded-full bg-white/15" />
=======
                    <div className="h-3 w-40 rounded bg-gray-200" />
>>>>>>> theirs
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-24 rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-20 rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
<<<<<<< ours
                    <div className="h-3 w-24 rounded-full bg-white/15" />
>>>>>>> theirs
=======
                    <div className="h-3 w-24 rounded bg-gray-200" />
>>>>>>> theirs
                  </td>
                </tr>
              ))
            ) : emails.length === 0 ? (
              <tr>
<<<<<<< ours
<<<<<<< ours
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-300">
=======
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-tertiary">
>>>>>>> theirs
=======
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-500">
>>>>>>> theirs
                  No emails match the current filters.
                </td>
              </tr>
            ) : (
              emails.map((email) => (
<<<<<<< ours
<<<<<<< ours
                <tr key={email.id} className="transition duration-200 ease-gentle-spring hover:bg-white/5">
                  <td className="px-4 py-3 text-sm font-semibold text-white">{email.subject || "(no subject)"}</td>
                  <td className="px-4 py-3 text-sm text-slate-200">
                    {email.fromName ? `${email.fromName} • ${email.fromEmail}` : email.fromEmail}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-brand-200">{email.category}</td>
                  <td className="px-4 py-3 text-xs text-slate-300">{formatDate(email.receivedAt)}</td>
=======
                <tr key={email.id} className="transition duration-200 ease-gentle-spring hover:bg-[rgba(26,32,52,0.45)]">
                  <td className="px-4 py-3 text-sm font-semibold text-primary tracking-[0.06em]">{email.subject || "(no subject)"}</td>
                  <td className="px-4 py-3 text-sm text-secondary">
                    {email.fromName ? `${email.fromName} • ${email.fromEmail}` : email.fromEmail}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-primary">{email.category}</td>
                  <td className="px-4 py-3 text-xs text-tertiary">{formatDate(email.receivedAt)}</td>
>>>>>>> theirs
=======
                <tr key={email.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{email.subject || "(no subject)"}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {email.fromName ? `${email.fromName} • ${email.fromEmail}` : email.fromEmail}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-gray-600">{email.category}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(email.receivedAt)}</td>
>>>>>>> theirs
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
<<<<<<< ours
<<<<<<< ours
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
=======
    <div className="surface-panel relative h-full overflow-hidden px-7 py-7 text-secondary">
      <div className="pointer-events-none absolute -top-24 right-0 h-48 w-48 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,201,245,0.24),transparent_70%)] blur-3xl" />
      <h3 className="font-display text-lg tracking-[0.22em] text-primary">Calendar snapshot</h3>
      <p className="mt-3 text-sm text-secondary">
=======
    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-5 text-gray-500 shadow-sm h-full">
      <h3 className="text-lg font-semibold text-gray-900">Calendar snapshot</h3>
      <p className="mt-2 text-sm">
>>>>>>> theirs
        Calendar integrations are on deck. Upcoming meetings, holds, and travel windows will populate this panel once
        connected.
      </p>
      <div className="mt-4 space-y-2 text-sm">
        <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span>Hook up Google Calendar to surface interviews, travel holds, and rehearsals.</span>
        </div>
<<<<<<< ours
        <div className="surface-card flex items-center gap-3 p-4 text-secondary">
          <span className="h-2.5 w-2.5 rounded-full bg-[rgba(148,63,255,0.65)]" />
>>>>>>> theirs
=======
        <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
>>>>>>> theirs
          <span>Link agency itineraries to blend external invites alongside Cadenzor deadlines.</span>
        </div>
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

  return (
<<<<<<< ours
<<<<<<< ours
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
=======
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
>>>>>>> theirs
=======
    <section className="space-y-8">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Home</h1>
          <p className="mt-1 text-sm text-gray-600">
            Pulse across projects, urgent priorities, and inbox signals generated by the priority engine.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
>>>>>>> theirs
          <button
            type="button"
            onClick={() => {
              void loadDigest();
              void loadEmails();
            }}
<<<<<<< ours
<<<<<<< ours
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
=======
            className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full border border-white/10 bg-[rgba(59,201,245,0.16)] px-6 py-2 text-sm font-semibold text-primary shadow-[0_32px_80px_-38px_rgba(59,201,245,0.65)] transition duration-300 ease-gentle-spring hover:-translate-y-0.5 hover:shadow-[0_36px_90px_-36px_rgba(59,201,245,0.75)]"
=======
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
>>>>>>> theirs
          >
            Refresh snapshot
          </button>
<<<<<<< ours
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[rgba(17,23,40,0.7)] px-4 py-2 text-xs font-semibold text-secondary">
            <span className="h-2 w-2 rounded-full bg-[rgba(59,201,245,0.7)]" aria-hidden />
>>>>>>> theirs
=======
          <span className="rounded-full bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600">
>>>>>>> theirs
            {digestState.digest ? `${topActions.length} priorities surfaced` : "Awaiting fresh data"}
          </span>
        </div>
      </header>

      {digestError ? (
<<<<<<< ours
<<<<<<< ours
        <div className="glass-surface rounded-2xl border border-rose-500/40 px-4 py-3 text-sm text-rose-100 shadow-glow">{digestError}</div>
=======
        <div className="surface-panel border border-[rgba(217,70,239,0.45)] px-4 py-3 text-sm text-primary">{digestError}</div>
>>>>>>> theirs
=======
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{digestError}</div>
>>>>>>> theirs
      ) : null}

      <DigestSummary state={digestState} loading={digestLoading} />

<<<<<<< ours
<<<<<<< ours
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
=======
      <div className="h-px w-full bg-[linear-gradient(90deg,rgba(59,201,245,0)_0%,rgba(59,201,245,0.3)_50%,rgba(217,70,239,0)_100%)]" />

      <div className="grid gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
>>>>>>> theirs
=======
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
>>>>>>> theirs
          <TopPriorityGrid actions={topActions} />
          <UpcomingDeadlines actions={timelineActions} />
        </div>
        <CalendarPlaceholder />
      </div>

<<<<<<< ours
<<<<<<< ours
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
=======
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="surface-hero relative overflow-hidden px-7 py-7">
          <div className="pointer-events-none absolute -top-20 right-16 h-52 w-52 rounded-full bg-[radial-gradient(circle_at_center,rgba(59,201,245,0.24),transparent_68%)] blur-3xl" />
          <h3 className="font-display text-lg tracking-[0.24em] text-primary">Project focus</h3>
          <p className="mt-2 text-sm text-secondary">
=======
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Project focus</h3>
          <p className="mt-1 text-sm text-gray-600">
>>>>>>> theirs
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
<<<<<<< ours
                    <dt className="uppercase tracking-[0.34em] text-tertiary">Approvals</dt>
                    <dd className="font-display text-xl tracking-[0.12em] text-primary">{snapshot.approvals.length}</dd>
>>>>>>> theirs
=======
                    <dt className="uppercase tracking-wide text-gray-500">Approvals</dt>
                    <dd className="text-sm font-semibold text-gray-900">{snapshot.approvals.length}</dd>
>>>>>>> theirs
                  </div>
                </dl>
              </div>
            ))}
            {(digestState.digest?.projects?.length ?? 0) === 0 ? (
<<<<<<< ours
<<<<<<< ours
              <div className="rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-slate-300">
=======
              <div className="surface-card border border-dashed border-white/15 p-5 text-sm text-tertiary">
>>>>>>> theirs
=======
              <div className="rounded border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
>>>>>>> theirs
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
