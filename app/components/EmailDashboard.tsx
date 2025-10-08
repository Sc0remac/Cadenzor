"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EmailLabel, EmailRecord } from "@cadenzor/shared";
import { useAuth } from "./AuthProvider";
import { DEFAULT_EMAIL_LABELS } from "@cadenzor/shared";
import {
  DEFAULT_EMAILS_PER_PAGE,
  fetchEmailStats,
  fetchRecentEmails,
} from "../lib/supabaseClient";
import type {
  EmailStatsScope,
  EmailSourceFilter,
  EmailListResponse,
  EmailPagination,
} from "../lib/supabaseClient";

type StatsState = Record<string, number>;

const POLL_INTERVAL_MS = 60 * 1000;

type StatusMessage = {
  type: "success" | "error";
  message: string;
};

type LabelFilterValue = EmailLabel | "all";

function startCase(label: string): string {
  if (!label) return "";
  if (label === label.toUpperCase()) {
    return label;
  }

  return label
    .replace(/[_\-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatLabel(label: EmailLabel): string {
  if (!label) return "Unlabelled";
  const segments = label.split("/");
  if (segments.length === 1) {
    return startCase(segments[0]);
  }

  const [prefix, ...rest] = segments;

  const formatSegment = (segment: string, isPrefix = false) => {
    if (!segment) {
      return "";
    }

    if (!isPrefix && /^\d{4}-\d{2}-\d{2}$/.test(segment)) {
      return segment;
    }

    if (segment === segment.toUpperCase()) {
      return segment;
    }

    return startCase(segment);
  };

  const formatted = [formatSegment(prefix, true), ...rest.map((part) => formatSegment(part))].filter(
    Boolean
  );

  return formatted.join(" / ");
}

function formatReceivedAt(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch (err) {
    console.error("Failed to format date", err);
    return value;
  }
}

function formatLastRefreshed(value: Date | null): string {
  if (!value) {
    return "Never";
  }

  try {
    return value.toLocaleString();
  } catch (err) {
    console.error("Failed to format timestamp", err);
    return value.toISOString();
  }
}

export default function EmailDashboard() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [stats, setStats] = useState<StatsState>({});
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [emailPagination, setEmailPagination] = useState<EmailPagination>({
    page: 1,
    perPage: DEFAULT_EMAILS_PER_PAGE,
    total: 0,
    totalPages: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [statsScope, setStatsScope] = useState<EmailStatsScope>("unread");
  const [sourceFilter, setSourceFilter] = useState<EmailSourceFilter>("all");
  const [labelFilter, setLabelFilter] = useState<LabelFilterValue>("all");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const emailPageRef = useRef<number>(1);

  const applyEmailResponse = useCallback(
    (response: EmailListResponse, requestedPage: number) => {
      setEmails(response.items);

      const pagination = response.pagination;
      const nextPage = pagination.page > 0 ? pagination.page : requestedPage;
      const perPage = pagination.perPage > 0 ? pagination.perPage : DEFAULT_EMAILS_PER_PAGE;
      const total = pagination.total >= 0 ? pagination.total : response.items.length;
      const totalPages = pagination.totalPages >= 0 ? pagination.totalPages : 0;

      emailPageRef.current = nextPage;
      setEmailPagination({
        page: nextPage,
        perPage,
        total,
        totalPages,
        hasMore: Boolean(pagination.hasMore),
      });
    },
    []
  );

  const loadData = useCallback(
    async ({ silent = false, page }: { silent?: boolean; page?: number } = {}) => {
      const targetPage =
        typeof page === "number" && page > 0 ? page : emailPageRef.current || 1;

      if (!accessToken) {
        setError("Authentication required. Please sign in again.");
        setInitialized(true);
        if (!silent) {
          setLoading(false);
        }
        return;
      }

      if (!silent) {
        setLoading(true);
      }

      try {
        const [statsData, emailData] = await Promise.all([
          fetchEmailStats({ accessToken, scope: statsScope, source: sourceFilter }),
          fetchRecentEmails({
            page: targetPage,
            perPage:
              emailPagination.perPage > 0
                ? emailPagination.perPage
                : DEFAULT_EMAILS_PER_PAGE,
            accessToken,
            label: labelFilter !== "all" ? labelFilter : undefined,
            source: sourceFilter,
          }),
        ]);
        setStats(statsData);
        applyEmailResponse(emailData, targetPage);
        setLastRefreshedAt(new Date());
        setError(null);
      } catch (err) {
        console.error("Failed to load dashboard data", err);
        const message =
          err instanceof Error ? err.message : "Failed to load statistics";
        setError(message);
      } finally {
        if (!silent) {
          setLoading(false);
        }
        setInitialized(true);
      }
    },
    [
      accessToken,
      applyEmailResponse,
      emailPagination.perPage,
      statsScope,
      labelFilter,
      sourceFilter,
    ]
  );

  const handleScopeChange = useCallback((nextScope: EmailStatsScope) => {
    setStatsScope(nextScope);
  }, []);

  const handleSourceChange = useCallback((nextSource: EmailSourceFilter) => {
    emailPageRef.current = 1;
    setSourceFilter(nextSource);
    setLabelFilter("all");
    setEmailPagination((prev) => ({
      ...prev,
      page: 1,
    }));
  }, []);

  const handleLabelFilterChange = useCallback((nextValue: LabelFilterValue) => {
    emailPageRef.current = 1;
    setLabelFilter(nextValue);
    setEmailPagination((prev) => ({
      ...prev,
      page: 1,
    }));
  }, []);

  const handleLabelTileClick = useCallback(
    (label: EmailLabel) => {
      const nextValue: LabelFilterValue = labelFilter === label ? "all" : label;
      handleLabelFilterChange(nextValue);
    },
    [handleLabelFilterChange, labelFilter]
  );

  const handleManualRefresh = useCallback(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    loadData();
    const interval = setInterval(() => {
      loadData({ silent: true }).catch((err) => console.error("Refresh failed", err));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [accessToken, loadData]);

  const handleClassifyClick = async () => {
    setStatusMessage(null);
    setClassifying(true);

    if (!accessToken) {
      setStatusMessage({ type: "error", message: "Authentication required. Please sign in again." });
      setClassifying(false);
      return;
    }

    try {
      const response = await fetch("/api/classify-emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to classify emails");
      }

      const processed = typeof payload?.processed === "number" ? payload.processed : 0;
      const failures = Array.isArray(payload?.failures) ? payload.failures.length : 0;
      const messageParts: string[] = [];

      if (processed > 0) {
        messageParts.push(
          `Processed ${processed} ${processed === 1 ? "email" : "emails"}`
        );
      } else if (typeof payload?.message === "string" && payload.message.length > 0) {
        messageParts.push(payload.message);
      } else {
        messageParts.push("No unread emails found");
      }

      if (failures > 0) {
        messageParts.push(`${failures} failed`);
      }

      setStatusMessage({ type: "success", message: messageParts.join(" · ") });
      await loadData({ silent: true });
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        message: err?.message || "Failed to classify emails",
      });
    } finally {
      setClassifying(false);
    }
  };

  const handlePageChange = useCallback(
    (nextPage: number) => {
      const safePage = Math.max(Math.floor(nextPage), 1);
      const currentPage = emailPageRef.current || 1;

      if (safePage === currentPage) {
        return;
      }

      if (emailPagination.totalPages > 0 && safePage > emailPagination.totalPages) {
        return;
      }

      if (
        emailPagination.totalPages === 0 &&
        !emailPagination.hasMore &&
        safePage > 1
      ) {
        return;
      }

      void loadData({ page: safePage });
    },
    [emailPagination.hasMore, emailPagination.totalPages, loadData]
  );

  const handleNextPage = useCallback(() => {
    handlePageChange((emailPageRef.current || 1) + 1);
  }, [handlePageChange]);

  const handlePreviousPage = useCallback(() => {
    handlePageChange((emailPageRef.current || 1) - 1);
  }, [handlePageChange]);

  const labelStatsEntries = useMemo(() => {
    const defaultOrder = new Map<string, number>();
    DEFAULT_EMAIL_LABELS.forEach((label, index) => {
      defaultOrder.set(label, index);
    });

    const aggregated = new Map<string, number>();

    DEFAULT_EMAIL_LABELS.forEach((label) => {
      const count = stats[label];
      aggregated.set(
        label,
        typeof count === "number" && Number.isFinite(count) ? count : 0
      );
    });

    Object.entries(stats).forEach(([label, value]) => {
      if (!label) {
        return;
      }
      const count = typeof value === "number" && Number.isFinite(value) ? value : 0;
      aggregated.set(label, count);
    });

    return Array.from(aggregated.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        const aRank = defaultOrder.has(a.label)
          ? defaultOrder.get(a.label) ?? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER;
        const bRank = defaultOrder.has(b.label)
          ? defaultOrder.get(b.label) ?? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) {
          return aRank - bRank;
        }
        return a.label.localeCompare(b.label);
      });
  }, [stats]);

  const topLabelEntries = labelStatsEntries.slice(0, 3);
  const otherLabelEntries = labelStatsEntries.slice(3);

  const labelFilterOptions = useMemo(() => {
    const values: LabelFilterValue[] = ["all"];
    labelStatsEntries.forEach(({ label }) => {
      if (label) {
        values.push(label as EmailLabel);
      }
    });
    return values;
  }, [labelStatsEntries]);

  const visibleEmails = useMemo(() => {
    if (labelFilter === "all") {
      return emails;
    }

    return emails.filter((email) => {
      const labels = Array.isArray(email.labels) ? email.labels : [];
      if (labels.length === 0) {
        return labelFilter === "unlabelled";
      }
      return labels.includes(labelFilter);
    });
  }, [emails, labelFilter]);

  const hasLabelFilter = labelFilter !== "all";
  const activeScopeLabel = statsScope === "unread" ? "Unread only" : "All emails";
  const activeLabelFilterLabel = hasLabelFilter ? formatLabel(labelFilter as EmailLabel) : "All labels";
  const activeSourceLabel = sourceFilter === "seeded" ? "Seeded only" : "All sources";
  const filterSummary = `${activeScopeLabel} · ${activeLabelFilterLabel} · ${activeSourceLabel}`;
  const lastRefreshedLabel = formatLastRefreshed(lastRefreshedAt);

  const currentPage = emailPagination.page > 0 ? emailPagination.page : 1;
  const perPage = emailPagination.perPage > 0 ? emailPagination.perPage : DEFAULT_EMAILS_PER_PAGE;
  const totalEmails = emailPagination.total >= 0 ? emailPagination.total : emails.length;
  const totalPages = emailPagination.totalPages >= 0 ? emailPagination.totalPages : 0;
  const rangeStart = emails.length > 0 ? (currentPage - 1) * perPage + 1 : 0;
  const rangeEnd = emails.length > 0 ? rangeStart + emails.length - 1 : 0;
  const displayTotalPages =
    totalPages > 0 ? totalPages : totalEmails > 0 ? Math.ceil(totalEmails / perPage) : 1;
  const disablePrevious = loading || currentPage <= 1;
  const disableNext = loading || (totalPages > 0 ? currentPage >= totalPages : !emailPagination.hasMore);

  const tableSummary = useMemo(() => {
    const sourceSummarySuffix = sourceFilter === "seeded" ? " (seeded fixtures)" : "";

    if (visibleEmails.length === 0) {
      if (emails.length === 0) {
        return `Showing 0 emails${sourceSummarySuffix}`;
      }
      if (hasLabelFilter) {
        return `No emails labelled ${activeLabelFilterLabel}${sourceSummarySuffix}`;
      }
      return `Showing 0 emails${sourceSummarySuffix}`;
    }

    if (hasLabelFilter) {
      const count = visibleEmails.length;
      return `Showing ${count} ${count === 1 ? "email" : "emails"} labelled ${activeLabelFilterLabel}${sourceSummarySuffix}`;
    }

    return `Showing ${rangeStart}-${rangeEnd} of ${totalEmails} emails${sourceSummarySuffix}`;
  }, [
    activeLabelFilterLabel,
    emails.length,
    hasLabelFilter,
    rangeEnd,
    rangeStart,
    sourceFilter,
    totalEmails,
    visibleEmails.length,
  ]);

  if (!initialized && loading) {
<<<<<<< ours
    return (
<<<<<<< ours
      <div className="glass-surface animate-pulse rounded-2xl px-6 py-6 text-sm text-slate-200">
=======
      <div className="surface-panel animate-pulse px-8 py-8 text-sm text-secondary">
>>>>>>> theirs
        Loading email intelligence…
      </div>
    );
  }

  return (
<<<<<<< ours
    <div className="space-y-10 text-slate-100">
      <div className="glass-surface space-y-5 rounded-2xl px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-200">
              Inbox intelligence
            </div>
            <h2 className="text-3xl font-semibold text-white">Emails by category</h2>
            <p className="text-sm text-slate-300">{filterSummary}</p>
            <span className="text-xs text-slate-400">Last refreshed: {lastRefreshedLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {initialized && loading ? (
              <span className="text-xs text-slate-300">Refreshing…</span>
=======
    <div className="space-y-12 text-secondary">
      <div className="surface-hero space-y-6 px-7 py-7">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[rgba(31,122,224,0.2)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.42em] text-primary">
              Inbox intelligence
            </div>
            <h2 className="font-display text-[2.1rem] tracking-[0.24em] text-primary">Emails by category</h2>
            <p className="text-sm text-secondary">{filterSummary}</p>
            <span className="text-xs text-tertiary">Last refreshed: {lastRefreshedLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {initialized && loading ? (
              <span className="text-xs text-tertiary">Refreshing…</span>
>>>>>>> theirs
            ) : null}
=======
    return <p>Loading email statistics…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold">
              Emails by category
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({filterSummary})
              </span>
            </h2>
            <span className="text-xs text-gray-500">Last refreshed: {lastRefreshedLabel}</span>
          </div>
          <div className="flex items-center gap-3">
            {initialized && loading && (
              <span className="text-xs text-gray-500">Refreshing…</span>
            )}
>>>>>>> theirs
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={loading}
<<<<<<< ours
<<<<<<< ours
              className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-100 transition duration-200 ease-gentle-spring hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
=======
              className="group relative inline-flex items-center overflow-hidden rounded-full border border-white/10 bg-[rgba(59,201,245,0.14)] px-5 py-2 text-sm font-semibold text-primary shadow-[0_28px_72px_-38px_rgba(59,201,245,0.65)] transition duration-300 ease-gentle-spring hover:-translate-y-0.5 hover:shadow-[0_32px_80px_-36px_rgba(59,201,245,0.75)] disabled:cursor-not-allowed disabled:opacity-60"
>>>>>>> theirs
=======
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
>>>>>>> theirs
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={handleClassifyClick}
              disabled={classifying}
<<<<<<< ours
<<<<<<< ours
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-brand-400/40 bg-brand-500/20 px-5 py-2 text-sm font-semibold text-white shadow-glow transition duration-200 ease-gentle-spring hover:-translate-y-0.5 hover:border-brand-300/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-brand-500 via-rose-500 to-sky-500 opacity-80 transition duration-300 ease-gentle-spring group-hover:opacity-100" />
              <span className="relative">{classifying ? "Classifying…" : "Classify emails"}</span>
=======
              className="group relative inline-flex items-center overflow-hidden rounded-full border border-white/10 bg-[rgba(59,201,245,0.14)] px-5 py-2 text-sm font-semibold text-primary shadow-[0_28px_72px_-38px_rgba(59,201,245,0.65)] transition duration-300 ease-gentle-spring hover:-translate-y-0.5 hover:shadow-[0_32px_80px_-36px_rgba(59,201,245,0.75)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="absolute inset-0 bg-[linear-gradient(120deg,rgba(59,201,245,0.85),rgba(31,122,224,0.6))] opacity-70 transition duration-300 ease-gentle-spring group-hover:opacity-100" />
              <span className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.45)_45%,rgba(255,255,255,0)_75%)] bg-[length:220%_100%] opacity-0 transition duration-500 ease-linear group-hover:opacity-100" />
              <span className="relative tracking-[0.22em] uppercase">{classifying ? "Classifying…" : "Classify emails"}</span>
>>>>>>> theirs
=======
              className="inline-flex items-center rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400"
            >
              {classifying ? "Classifying…" : "Classify emails"}
>>>>>>> theirs
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
<<<<<<< ours
<<<<<<< ours
            <span className="font-medium text-slate-200">Scope:</span>
            <div className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1">
=======
            <span className="font-medium text-secondary">Scope:</span>
            <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[rgba(18,22,38,0.7)] p-1">
>>>>>>> theirs
=======
            <span className="text-sm font-medium text-gray-600">Scope:</span>
            <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 text-sm shadow-sm">
>>>>>>> theirs
              {(["unread", "all"] as EmailStatsScope[]).map((scopeOption) => {
                const isActive = statsScope === scopeOption;
                return (
                  <button
                    key={scopeOption}
                    type="button"
                    onClick={() => handleScopeChange(scopeOption)}
                    aria-pressed={isActive}
                    className={`rounded px-3 py-1 font-medium transition ${
                      isActive
<<<<<<< ours
<<<<<<< ours
                        ? "bg-gradient-to-r from-brand-500 via-brand-400 to-sky-400 text-slate-900 shadow-glow"
                        : "text-slate-200 hover:bg-white/10"
=======
                        ? "bg-[rgba(59,201,245,0.25)] text-primary shadow-[0_18px_40px_-20px_rgba(59,201,245,0.6)]"
                        : "text-secondary hover:bg-white/5 hover:text-primary"
>>>>>>> theirs
=======
                        ? "bg-indigo-600 text-white shadow"
                        : "text-gray-600 hover:bg-gray-100"
>>>>>>> theirs
                    }`}
                  >
                    {scopeOption === "unread" ? "Unread" : "All"}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
<<<<<<< ours
<<<<<<< ours
            <span className="font-medium text-slate-200">Source:</span>
            <div className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1">
=======
            <span className="font-medium text-secondary">Source:</span>
            <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[rgba(18,22,38,0.7)] p-1">
>>>>>>> theirs
=======
            <span className="text-sm font-medium text-gray-600">Source:</span>
            <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 text-sm shadow-sm">
>>>>>>> theirs
              {(["all", "seeded"] as EmailSourceFilter[]).map((sourceOption) => {
                const isActive = sourceFilter === sourceOption;
                return (
                  <button
                    key={sourceOption}
                    type="button"
                    onClick={() => handleSourceChange(sourceOption)}
                    aria-pressed={isActive}
                    className={`rounded px-3 py-1 font-medium transition ${
                      isActive
<<<<<<< ours
<<<<<<< ours
                        ? "bg-gradient-to-r from-brand-500 via-emerald-400 to-sky-400 text-slate-900 shadow-glow"
                        : "text-slate-200 hover:bg-white/10"
=======
                        ? "bg-[rgba(59,201,245,0.25)] text-primary shadow-[0_18px_40px_-20px_rgba(59,201,245,0.6)]"
                        : "text-secondary hover:bg-white/5 hover:text-primary"
>>>>>>> theirs
=======
                        ? "bg-indigo-600 text-white shadow"
                        : "text-gray-600 hover:bg-gray-100"
>>>>>>> theirs
                    }`}
                    title={
                      sourceOption === "seeded"
                        ? "Show only seeded (fake) demo emails"
                        : "Show all emails"
                    }
                  >
                    {sourceOption === "seeded" ? "Seeded" : "All"}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
<<<<<<< ours
<<<<<<< ours
            <span className="font-medium text-slate-200">Label:</span>
            <select
              value={labelFilter}
              onChange={(event) => handleLabelFilterChange(event.target.value as LabelFilterValue)}
              className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-slate-100 transition hover:border-white/30 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/40"
            >
              {labelFilterOptions.map((option) => (
                <option key={option} value={option} className="bg-midnight text-slate-100">
=======
            <span className="font-medium text-secondary">Label:</span>
=======
            <span className="text-sm font-medium text-gray-600">Label:</span>
>>>>>>> theirs
            <select
              value={labelFilter}
              onChange={(event) => handleLabelFilterChange(event.target.value as LabelFilterValue)}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {labelFilterOptions.map((option) => (
<<<<<<< ours
                <option key={option} value={option} className="bg-depth-900 text-secondary">
>>>>>>> theirs
=======
                <option key={option} value={option}>
>>>>>>> theirs
                  {option === "all" ? "All labels" : formatLabel(option as EmailLabel)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

<<<<<<< ours
<<<<<<< ours
      {error ? <p className="text-sm text-rose-200">{error}</p> : null}
=======
      {error ? <p className="text-sm text-primary">{error}</p> : null}
>>>>>>> theirs
=======
      {error && <p className="text-sm text-red-600">{error}</p>}
>>>>>>> theirs

      {statusMessage && (
        <p
          className={`text-sm ${
<<<<<<< ours
<<<<<<< ours
            statusMessage.type === "error" ? "text-rose-200" : "text-emerald-200"
=======
            statusMessage.type === "error"
              ? "text-[rgba(217,70,239,0.9)]"
              : "text-[rgba(59,201,245,0.85)]"
>>>>>>> theirs
=======
            statusMessage.type === "error" ? "text-red-600" : "text-green-600"
>>>>>>> theirs
          }`}
        >
          {statusMessage.message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {topLabelEntries.length === 0 ? (
<<<<<<< ours
<<<<<<< ours
          <div className="col-span-full rounded-2xl border border-dashed border-white/20 bg-white/5 p-6 text-center text-sm text-slate-300">
=======
          <div className="col-span-full surface-panel border border-dashed border-white/20 p-6 text-center text-sm text-tertiary">
>>>>>>> theirs
            No label activity yet.
=======
          <div className="col-span-full rounded border border-dashed border-gray-200 bg-white p-6 text-center shadow">
            <p className="text-sm text-gray-500">No label activity yet.</p>
>>>>>>> theirs
          </div>
        ) : (
          topLabelEntries.map(({ label, count }, index) => {
            const isActive = labelFilter === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => handleLabelTileClick(label as EmailLabel)}
<<<<<<< ours
<<<<<<< ours
                className={`group flex h-full flex-col items-start justify-between rounded-2xl border bg-white/5 p-5 text-left transition duration-300 ease-gentle-spring ${
                  isActive
                    ? "border-brand-400/70 bg-brand-500/15 text-white shadow-glow"
                    : "border-white/10 text-slate-100 hover:border-brand-400/40 hover:bg-white/10"
                }`}
              >
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">#{index + 1}</h3>
                  <p className="text-lg font-semibold text-white">{formatLabel(label)}</p>
                </div>
                <p className="mt-4 text-3xl font-bold text-brand-200">{count}</p>
                <span className="mt-3 text-xs text-slate-300">
=======
                className={`group flex h-full flex-col items-start justify-between surface-card p-5 text-left transition duration-300 ease-gentle-spring hover:-translate-y-1 ${
=======
                className={`flex h-full flex-col items-start justify-between rounded border bg-white p-4 text-left shadow transition ${
>>>>>>> theirs
                  isActive
                    ? "border-indigo-500 ring-1 ring-indigo-200"
                    : "border-gray-200 hover:border-indigo-200 hover:shadow-md"
                }`}
              >
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    #{index + 1}
                  </h3>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{formatLabel(label)}</p>
                </div>
<<<<<<< ours
                <p className="mt-4 font-display text-3xl tracking-[0.14em] text-primary">{count}</p>
                <span className="mt-3 text-xs text-tertiary">
>>>>>>> theirs
=======
                <p className="mt-4 text-3xl font-bold text-indigo-600">{count}</p>
                <span className="mt-2 text-xs text-gray-500">
>>>>>>> theirs
                  {isActive ? "Filtering applied" : "Click to filter by this label"}
                </span>
              </button>
            );
          })
        )}
      </div>

<<<<<<< ours
      {otherLabelEntries.length > 0 ? (
<<<<<<< ours
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200">
          <span className="font-semibold uppercase tracking-[0.3em] text-slate-400">Other labels</span>
=======
        <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
          <span className="font-semibold uppercase tracking-[0.34em] text-tertiary">Other labels</span>
>>>>>>> theirs
=======
      {otherLabelEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Other labels
          </span>
>>>>>>> theirs
          {otherLabelEntries.map(({ label, count }) => {
            const isActive = labelFilter === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => handleLabelTileClick(label as EmailLabel)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isActive
<<<<<<< ours
<<<<<<< ours
                    ? "border-brand-400/70 bg-brand-500/10 text-brand-100 shadow-glow"
                    : "border-white/15 bg-white/5 text-slate-200 hover:border-brand-400/40 hover:text-brand-100"
                }`}
              >
                <span>{formatLabel(label)}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-200">{count}</span>
=======
                    ? "border-white/20 bg-[rgba(59,201,245,0.18)] text-primary shadow-[0_18px_40px_-22px_rgba(59,201,245,0.6)]"
                    : "border-white/12 bg-[rgba(18,22,38,0.7)] text-secondary hover:border-white/30 hover:text-primary"
                }`}
              >
                <span>{formatLabel(label)}</span>
                <span className="rounded-full bg-[rgba(59,201,245,0.18)] px-2 py-0.5 text-[10px] font-semibold text-primary">{count}</span>
>>>>>>> theirs
=======
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-600 hover:border-indigo-200 hover:text-indigo-700"
                }`}
              >
                <span>{formatLabel(label)}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                  {count}
                </span>
>>>>>>> theirs
              </button>
            );
          })}
        </div>
      )}

<<<<<<< ours
<<<<<<< ours
      <section className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-white">Latest emails</h2>
          <span className="text-xs text-slate-300">{tableSummary}</span>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-glow">
          {visibleEmails.length === 0 ? (
            <p className="px-6 py-8 text-sm text-slate-300">
=======
      <section className="space-y-6">
=======
      <section className="space-y-4">
>>>>>>> theirs
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">Latest emails</h2>
          <span className="text-xs text-gray-500">{tableSummary}</span>
        </div>
        <div className="overflow-x-auto rounded border border-gray-200 bg-white shadow">
          {visibleEmails.length === 0 ? (
<<<<<<< ours
            <p className="px-6 py-8 text-sm text-tertiary">
>>>>>>> theirs
=======
            <p className="px-6 py-8 text-sm text-gray-600">
>>>>>>> theirs
              {hasLabelFilter
                ? `No emails labelled ${activeLabelFilterLabel}.`
                : "No recent emails to display."}
            </p>
          ) : (
<<<<<<< ours
<<<<<<< ours
            <table className="min-w-full divide-y divide-white/10 text-sm text-slate-100">
              <thead className="bg-white/5 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-200">
=======
            <table className="min-w-full divide-y divide-white/10 text-sm text-secondary">
              <thead className="bg-[rgba(22,28,43,0.65)] text-left text-xs font-semibold uppercase tracking-[0.34em] text-tertiary">
>>>>>>> theirs
=======
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
>>>>>>> theirs
                <tr>
                  <th scope="col" className="px-4 py-3">Subject</th>
                  <th scope="col" className="px-4 py-3">Sender</th>
                  <th scope="col" className="px-4 py-3">Received</th>
                  <th scope="col" className="px-4 py-3">Labels</th>
                  <th scope="col" className="px-4 py-3">Summary</th>
                </tr>
              </thead>
<<<<<<< ours
<<<<<<< ours
              <tbody className="divide-y divide-white/10">
                {visibleEmails.map((email) => {
                  const senderName = email.fromName?.trim();
                  return (
                    <tr key={email.id} className="align-top transition duration-200 ease-gentle-spring hover:bg-white/5">
                      <td className="px-4 py-3 font-semibold text-white">{email.subject}</td>
                      <td className="px-4 py-3 text-slate-200">
                        <div className="flex flex-col">
                          <span>{senderName || email.fromEmail}</span>
                          {senderName ? (
                            <span className="text-xs text-slate-400">{email.fromEmail}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-300">
=======
              <tbody className="divide-y divide-white/8">
=======
              <tbody className="divide-y divide-gray-200">
>>>>>>> theirs
                {visibleEmails.map((email) => {
                  const senderName = email.fromName?.trim();
                  return (
                    <tr key={email.id} className="align-top">
                      <td className="px-4 py-3 font-semibold text-gray-900">{email.subject}</td>
                      <td className="px-4 py-3 text-gray-700">
                        <div className="flex flex-col">
                          <span>{senderName || email.fromEmail}</span>
                          {senderName && (
                            <span className="text-xs text-gray-500">{email.fromEmail}</span>
                          )}
                        </div>
                      </td>
<<<<<<< ours
                      <td className="whitespace-nowrap px-4 py-3 text-tertiary">
>>>>>>> theirs
=======
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
>>>>>>> theirs
                        {formatReceivedAt(email.receivedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {email.labels && email.labels.length > 0 ? (
                            email.labels.map((label) => (
                              <span
                                key={`${email.id}-${label}`}
<<<<<<< ours
<<<<<<< ours
                                className="rounded-full border border-brand-400/40 bg-brand-500/10 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-brand-100"
=======
                                className="rounded-full border border-white/15 bg-[rgba(59,201,245,0.16)] px-2 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-primary"
>>>>>>> theirs
=======
                                className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium uppercase tracking-wide text-indigo-600"
>>>>>>> theirs
                              >
                                {formatLabel(label)}
                              </span>
                            ))
                          ) : (
<<<<<<< ours
<<<<<<< ours
                            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
=======
                            <span className="rounded-full border border-white/15 bg-[rgba(18,22,38,0.7)] px-2 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-tertiary">
>>>>>>> theirs
=======
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-gray-500">
>>>>>>> theirs
                              Unlabelled
                            </span>
                          )}
                        </div>
                      </td>
<<<<<<< ours
<<<<<<< ours
                      <td className="px-4 py-3 text-sm text-slate-200">
                        {email.summary ? (
                          email.summary
                        ) : (
                          <span className="text-slate-400">No summary available.</span>
=======
                      <td className="px-4 py-3 text-sm text-secondary">
                        {email.summary ? (
                          email.summary
                        ) : (
                          <span className="text-tertiary">No summary available.</span>
>>>>>>> theirs
                        )}
=======
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {email.summary ? email.summary : <span className="text-gray-400">No summary available.</span>}
>>>>>>> theirs
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
<<<<<<< ours
<<<<<<< ours
          <span className="text-xs text-slate-300">
=======
          <span className="text-xs text-tertiary">
>>>>>>> theirs
=======
          <span className="text-xs text-gray-500">
>>>>>>> theirs
            Page {currentPage} of {displayTotalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreviousPage}
              disabled={disablePrevious}
<<<<<<< ours
<<<<<<< ours
              className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-1 text-sm font-semibold text-slate-200 transition duration-200 ease-gentle-spring hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Previous
            </button>
            <span className="text-sm font-semibold text-white">{currentPage}</span>
=======
              className="inline-flex items-center rounded-full border border-white/10 bg-[rgba(18,22,38,0.7)] px-4 py-1 text-sm font-semibold text-secondary transition duration-200 ease-gentle-spring hover:-translate-y-0.5 hover:border-white/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              Previous
            </button>
            <span className="text-sm font-semibold text-primary">{currentPage}</span>
>>>>>>> theirs
=======
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">{currentPage}</span>
>>>>>>> theirs
            <button
              type="button"
              onClick={handleNextPage}
              disabled={disableNext}
<<<<<<< ours
<<<<<<< ours
              className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-1 text-sm font-semibold text-slate-200 transition duration-200 ease-gentle-spring hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
=======
              className="inline-flex items-center rounded-full border border-white/10 bg-[rgba(18,22,38,0.7)] px-4 py-1 text-sm font-semibold text-secondary transition duration-200 ease-gentle-spring hover:-translate-y-0.5 hover:border-white/30 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
>>>>>>> theirs
=======
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
>>>>>>> theirs
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
