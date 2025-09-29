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
import type { EmailStatsScope } from "../lib/supabaseClient";
import type {
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
  return label
    .replace(/[_\-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatLabel(label: EmailLabel): string {
  if (!label) return "Unlabelled";
  return startCase(label);
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
          fetchEmailStats({ accessToken, scope: statsScope }),
          fetchRecentEmails({
            page: targetPage,
            perPage:
              emailPagination.perPage > 0
                ? emailPagination.perPage
                : DEFAULT_EMAILS_PER_PAGE,
            accessToken,
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
    [accessToken, applyEmailResponse, emailPagination.perPage, statsScope]
  );

  const handleScopeChange = useCallback((nextScope: EmailStatsScope) => {
    setStatsScope(nextScope);
  }, []);

  const handleLabelFilterChange = useCallback((nextValue: LabelFilterValue) => {
    setLabelFilter(nextValue);
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

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    DEFAULT_EMAIL_LABELS.forEach((label) => {
      if (!seen.has(label)) {
        ordered.push(label);
        seen.add(label);
      }
    });
    Object.keys(stats)
      .filter((label) => !!label && !seen.has(label))
      .forEach((label) => {
        ordered.push(label);
        seen.add(label);
    });
    return ordered;
  }, [stats]);

  const labelFilterOptions = useMemo(() => {
    const values: LabelFilterValue[] = ["all"];
    categories.forEach((label) => {
      if (label) {
        values.push(label as EmailLabel);
      }
    });
    return values;
  }, [categories]);

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
    if (visibleEmails.length === 0) {
      if (emails.length === 0) {
        return "Showing 0 emails";
      }
      if (hasLabelFilter) {
        return `No emails labelled ${activeLabelFilterLabel}`;
      }
      return "Showing 0 emails";
    }

    if (hasLabelFilter) {
      const count = visibleEmails.length;
      return `Showing ${count} ${count === 1 ? "email" : "emails"} labelled ${activeLabelFilterLabel}`;
    }

    return `Showing ${rangeStart}-${rangeEnd} of ${totalEmails} emails`;
  }, [
    activeLabelFilterLabel,
    emails.length,
    hasLabelFilter,
    rangeEnd,
    rangeStart,
    totalEmails,
    visibleEmails.length,
  ]);

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
                ({activeScopeLabel} · {activeLabelFilterLabel})
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {categories.map((category) => {
          const count = stats[category] ?? 0;
          return (
            <div
              key={category || "uncategorised"}
              className="rounded border border-gray-200 bg-white p-4 shadow"
            >
              <h3 className="text-lg font-semibold">{formatLabel(category)}</h3>
              <p className="mt-2 text-2xl font-bold text-indigo-600">{count}</p>
            </div>
          );
        })}
      </div>

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
                  <th scope="col" className="px-4 py-3">Labels</th>
                  <th scope="col" className="px-4 py-3">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
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
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {formatReceivedAt(email.receivedAt)}
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
                        {email.summary ? email.summary : <span className="text-gray-400">No summary available.</span>}
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
    </div>
  );
}
