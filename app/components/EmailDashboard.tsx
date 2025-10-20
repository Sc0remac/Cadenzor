"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { EmailLabel, EmailRecord } from "@kazador/shared";
import { useAuth } from "./AuthProvider";
import { DEFAULT_EMAIL_LABELS, EMAIL_FALLBACK_LABEL } from "@kazador/shared";
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

const FILTER_STORAGE_KEYS = {
  scope: "kazador:inbox:scope",
  source: "kazador:inbox:source",
  label: "kazador:inbox:label",
} as const;

const SOURCE_FILTER_OPTIONS: Array<{ value: EmailSourceFilter; label: string; description?: string }> = [
  { value: "all", label: "All sources" },
  { value: "gmail", label: "Gmail" },
  { value: "seeded", label: "Seeded fixtures" },
  { value: "manual", label: "Manual imports" },
  { value: "unknown", label: "Unknown" },
];

const SOURCE_LABEL_MAP: Record<EmailSourceFilter, string> = {
  all: "All sources",
  gmail: "Gmail",
  seeded: "Seeded fixtures",
  manual: "Manual imports",
  unknown: "Unknown",
};

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

function formatTriageState(value: EmailRecord["triageState"]): string {
  switch (value) {
    case "acknowledged":
      return "Acknowledged";
    case "snoozed":
      return "Snoozed";
    case "resolved":
      return "Resolved";
    default:
      return "Unassigned";
  }
}

function triageStateClass(value: EmailRecord["triageState"]): string {
  switch (value) {
    case "acknowledged":
      return "bg-sky-50 text-sky-700 border border-sky-100";
    case "snoozed":
      return "bg-amber-50 text-amber-700 border border-amber-100";
    case "resolved":
      return "bg-emerald-50 text-emerald-700 border border-emerald-100";
    default:
      return "bg-gray-100 text-gray-700 border border-gray-200";
  }
}

function priorityBadge(score: EmailRecord["priorityScore"]): { label: string; className: string } | null {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return null;
  }

  if (score >= 80) {
    return { label: `Priority ${score}`, className: "bg-rose-50 text-rose-700 border border-rose-100" };
  }

  if (score >= 50) {
    return { label: `Priority ${score}`, className: "bg-orange-50 text-orange-700 border border-orange-100" };
  }

  if (score > 0) {
    return { label: `Priority ${score}`, className: "bg-indigo-50 text-indigo-700 border border-indigo-100" };
  }

  return { label: "Priority 0", className: "bg-gray-50 text-gray-600 border border-gray-200" };
}

function formatSourceLabel(source: EmailRecord["source"]): string {
  if (!source) {
    return "Unknown";
  }

  const value = source as EmailSourceFilter;
  if (value in SOURCE_LABEL_MAP) {
    return SOURCE_LABEL_MAP[value];
  }

  return source;
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
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const emailPageRef = useRef<number>(1);
  const filtersHydratedRef = useRef(false);

  useEffect(() => {
    if (filtersHydratedRef.current || typeof window === "undefined") {
      return;
    }

    const storedScope = window.localStorage.getItem(FILTER_STORAGE_KEYS.scope) as
      | EmailStatsScope
      | null;
    if (storedScope === "all" || storedScope === "unread") {
      setStatsScope(storedScope);
    }

    const storedSource = window.localStorage.getItem(FILTER_STORAGE_KEYS.source) as
      | EmailSourceFilter
      | null;
    if (storedSource && SOURCE_LABEL_MAP[storedSource] != null) {
      setSourceFilter(storedSource);
    }

    const storedLabel = window.localStorage.getItem(FILTER_STORAGE_KEYS.label);
    if (storedLabel && storedLabel !== "all") {
      setLabelFilter(storedLabel as EmailLabel);
    }

    filtersHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!filtersHydratedRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(FILTER_STORAGE_KEYS.scope, statsScope);
  }, [statsScope]);

  useEffect(() => {
    if (!filtersHydratedRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(FILTER_STORAGE_KEYS.source, sourceFilter);
  }, [sourceFilter]);

  useEffect(() => {
    if (!filtersHydratedRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(FILTER_STORAGE_KEYS.label, labelFilter);
  }, [labelFilter]);

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

  const handleEmailRowClick = useCallback((email: EmailRecord) => {
    setSelectedEmail(email);
    setIsPreviewOpen(true);
  }, []);

  const handleClosePreview = useCallback(() => {
    setIsPreviewOpen(false);
    setSelectedEmail(null);
  }, []);

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

  useEffect(() => {
    if (!selectedEmail) {
      return;
    }

    const updated = emails.find((email) => email.id === selectedEmail.id) ?? null;
    if (!updated) {
      setSelectedEmail(null);
      setIsPreviewOpen(false);
      return;
    }

    if (updated !== selectedEmail) {
      setSelectedEmail(updated);
    }
  }, [emails, selectedEmail]);

  useEffect(() => {
    if (!isPreviewOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClosePreview();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [handleClosePreview, isPreviewOpen]);

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
  const activeSourceLabel = SOURCE_LABEL_MAP[sourceFilter] ?? SOURCE_LABEL_MAP.all;
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

  const fallbackCount = stats[EMAIL_FALLBACK_LABEL] ?? 0;
  const uncategorisedBannerVisible = fallbackCount > 0 && (labelFilter === "all" || labelFilter === EMAIL_FALLBACK_LABEL);
  const highlightedTopLabel = topLabelEntries.find((entry) => entry.label !== EMAIL_FALLBACK_LABEL);
  const scopeCardTitle = statsScope === "unread" ? "Unread emails" : "Email volume";
  const scopeCardSubtitle = sourceFilter === "all" ? "Across all sources" : SOURCE_LABEL_MAP[sourceFilter];
  const topCategoryLabel = highlightedTopLabel ? formatLabel(highlightedTopLabel.label as EmailLabel) : "No leading category";
  const topCategoryCount = highlightedTopLabel?.count ?? 0;

  const tableSummary = useMemo(() => {
    const sourceSummarySuffix = sourceFilter !== "all" ? ` (${SOURCE_LABEL_MAP[sourceFilter].toLowerCase()})` : "";

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

  const selectedEmailPriority = selectedEmail ? priorityBadge(selectedEmail.priorityScore) : null;

  if (!initialized && loading) {
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
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={loading}
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={handleClassifyClick}
              disabled={classifying}
              className="inline-flex items-center rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400"
            >
              {classifying ? "Classifying…" : "Classify emails"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Scope:</span>
            <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 text-sm shadow-sm">
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
                        ? "bg-indigo-600 text-white shadow"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {scopeOption === "unread" ? "Unread" : "All"}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Source:</span>
            <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 text-sm shadow-sm">
              {SOURCE_FILTER_OPTIONS.map((option) => {
                const isActive = sourceFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSourceChange(option.value)}
                    aria-pressed={isActive}
                    className={`rounded px-3 py-1 font-medium transition ${
                      isActive
                        ? "bg-indigo-600 text-white shadow"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                    title={option.description}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Label:</span>
            <select
              value={labelFilter}
              onChange={(event) => handleLabelFilterChange(event.target.value as LabelFilterValue)}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {labelFilterOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All labels" : formatLabel(option as EmailLabel)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {statusMessage && (
        <p
          className={`text-sm ${
            statusMessage.type === "error" ? "text-red-600" : "text-green-600"
          }`}
        >
          {statusMessage.message}
        </p>
      )}

      {uncategorisedBannerVisible && (
        <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow">
          <span className="font-semibold">{fallbackCount.toLocaleString()} </span>
          {fallbackCount === 1 ? "email" : "emails"} are still uncategorised. Use manual tagging or refine your
          automations to train the classifier.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{scopeCardTitle}</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{totalEmails.toLocaleString()}</p>
          <p className="mt-1 text-xs text-gray-500">{scopeCardSubtitle}</p>
        </div>
        <div
          className={`rounded-lg border p-4 shadow-sm ${
            fallbackCount > 0
              ? "border-amber-200 bg-amber-50"
              : "border-gray-200 bg-white"
          }`}
        >
          <p className="text-sm font-medium text-gray-500">Needs tagging</p>
          <p className={`mt-2 text-3xl font-semibold ${fallbackCount > 0 ? "text-amber-700" : "text-gray-900"}`}>
            {fallbackCount.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {fallbackCount > 0
              ? "Review these to improve future classifications."
              : "All recent emails have a primary label."}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Top category</p>
          <p className="mt-2 text-lg font-semibold text-gray-900">{topCategoryLabel}</p>
          <p className="mt-1 text-xs text-gray-500">
            {topCategoryCount > 0
              ? `${topCategoryCount.toLocaleString()} entr${topCategoryCount === 1 ? "y" : "ies"} this cycle.`
              : "No dominant category yet."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {topLabelEntries.length === 0 ? (
          <div className="col-span-full rounded border border-dashed border-gray-200 bg-white p-6 text-center shadow">
            <p className="text-sm text-gray-500">No label activity yet.</p>
          </div>
        ) : (
          topLabelEntries.map(({ label, count }, index) => {
            const isActive = labelFilter === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => handleLabelTileClick(label as EmailLabel)}
                className={`flex h-full flex-col items-start justify-between rounded border bg-white p-4 text-left shadow transition ${
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
                <p className="mt-4 text-3xl font-bold text-indigo-600">{count}</p>
                <span className="mt-2 text-xs text-gray-500">
                  {isActive ? "Filtering applied" : "Click to filter by this label"}
                </span>
              </button>
            );
          })
        )}
      </div>

      {otherLabelEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Other labels
          </span>
          {otherLabelEntries.map(({ label, count }) => {
            const isActive = labelFilter === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => handleLabelTileClick(label as EmailLabel)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  isActive
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-600 hover:border-indigo-200 hover:text-indigo-700"
                }`}
              >
                <span>{formatLabel(label)}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold">Latest emails</h2>
          <span className="text-xs text-gray-500">{tableSummary}</span>
        </div>
        <div className="overflow-x-auto rounded border border-gray-200 bg-white shadow">
          {visibleEmails.length === 0 ? (
            <p className="px-6 py-8 text-sm text-gray-600">
              {hasLabelFilter
                ? `No emails labelled ${activeLabelFilterLabel}.`
                : "No recent emails to display."}
            </p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Subject</th>
                  <th scope="col" className="px-4 py-3">Sender</th>
                  <th scope="col" className="px-4 py-3">Received</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Labels</th>
                  <th scope="col" className="px-4 py-3">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {visibleEmails.map((email) => {
                  const senderName = email.fromName?.trim();
                  const isFallback = email.category === EMAIL_FALLBACK_LABEL;
                  const triageLabel = formatTriageState(email.triageState);
                  const triageClasses = triageStateClass(email.triageState);
                  const priority = priorityBadge(email.priorityScore);
                  const sourceLabel = formatSourceLabel(email.source);
                  const rowClasses = `align-top transition ${
                    isFallback
                      ? "cursor-pointer border-l-4 border-amber-400 bg-amber-50/60 hover:bg-amber-50"
                      : "cursor-pointer hover:bg-gray-50"
                  }`;
                  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleEmailRowClick(email);
                    }
                  };

                  return (
                    <tr
                      key={email.id}
                      className={rowClasses}
                      onClick={() => handleEmailRowClick(email)}
                      onKeyDown={handleRowKeyDown}
                      role="button"
                      tabIndex={0}
                    >
                      <td className="px-4 py-3 font-semibold text-gray-900">{email.subject}</td>
                      <td className="px-4 py-3 text-gray-700">
                        <div className="flex flex-col">
                          <span>{senderName || email.fromEmail}</span>
                          {senderName && (
                            <span className="text-xs text-gray-500">{email.fromEmail}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {formatReceivedAt(email.receivedAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${triageClasses}`}
                          >
                            {triageLabel}
                          </span>
                          {priority && (
                            <span
                              className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${priority.className}`}
                            >
                              {priority.label}
                            </span>
                          )}
                          <span className="text-xs text-gray-500">Source: {sourceLabel}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {email.labels && email.labels.length > 0 ? (
                            email.labels.map((label) => (
                              <span
                                key={`${email.id}-${label}`}
                                className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium uppercase tracking-wide text-indigo-600"
                              >
                                {formatLabel(label)}
                              </span>
                            ))
                          ) : (
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                              Unlabelled
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {email.summary ? (
                          <span className="block max-h-24 overflow-hidden" title={email.summary}>
                            {email.summary}
                          </span>
                        ) : (
                          <span className="text-gray-400">No summary available.</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-gray-500">
            Page {currentPage} of {displayTotalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreviousPage}
              disabled={disablePrevious}
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">{currentPage}</span>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={disableNext}
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {selectedEmail && (
        <div
          className={`fixed inset-0 z-40 flex items-stretch justify-end transition-opacity duration-150 ${
            isPreviewOpen ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <div
            className="flex-1 bg-black/30"
            role="presentation"
            onClick={handleClosePreview}
          />
          <aside
            className={`relative ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-xl transition-transform duration-200 ${
              isPreviewOpen ? "translate-x-0" : "translate-x-full"
            }`}
            role="dialog"
            aria-modal="true"
          >
            <header className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
              <div className="max-w-md space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {formatReceivedAt(selectedEmail.receivedAt)}
                </p>
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedEmail.subject || "(No subject)"}
                </h3>
                <p className="text-sm text-gray-600">
                  From {selectedEmail.fromName ? `${selectedEmail.fromName} · ${selectedEmail.fromEmail}` : selectedEmail.fromEmail}
                </p>
              </div>
              <button
                type="button"
                onClick={handleClosePreview}
                className="inline-flex items-center rounded border border-gray-200 px-3 py-1 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-100"
              >
                Close
              </button>
            </header>
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${triageStateClass(selectedEmail.triageState)}`}
                  >
                    {formatTriageState(selectedEmail.triageState)}
                  </span>
                  {selectedEmailPriority && (
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${selectedEmailPriority.className}`}
                    >
                      {selectedEmailPriority.label}
                    </span>
                  )}
                  <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600">
                    Source: {formatSourceLabel(selectedEmail.source)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedEmail.labels && selectedEmail.labels.length > 0 ? (
                    selectedEmail.labels.map((label) => (
                      <span
                        key={`${selectedEmail.id}-preview-${label}`}
                        className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-indigo-600"
                      >
                        {formatLabel(label)}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                      Unlabelled
                    </span>
                  )}
                </div>
                {selectedEmail.category === EMAIL_FALLBACK_LABEL && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    This email is uncategorised. Consider applying a label or updating your automations so
                    future messages are classified automatically.
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-700">Summary</h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                  {selectedEmail.summary ?? "No summary available for this email."}
                </p>
              </section>

              <section className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-700">Metadata</h4>
                <dl className="grid grid-cols-1 gap-3 text-sm text-gray-600 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-500">Sender</dt>
                    <dd>{selectedEmail.fromEmail}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-500">Received</dt>
                    <dd>{formatReceivedAt(selectedEmail.receivedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-500">Category</dt>
                    <dd>{formatLabel(selectedEmail.category)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-500">Triage state</dt>
                    <dd>{formatTriageState(selectedEmail.triageState)}</dd>
                  </div>
                </dl>
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
