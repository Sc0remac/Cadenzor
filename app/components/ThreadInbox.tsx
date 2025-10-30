"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_EMAIL_LABELS } from "@kazador/shared";
import type { EmailLabel, ThreadEmailMessage } from "@kazador/shared";
import {
  fetchProjects,
  fetchThreadDetail,
  fetchThreads,
  updateEmailTriage,
  type EmailPagination,
  type ProjectListItem,
  type ThreadDetail,
  type ThreadRecord,
} from "../lib/supabaseClient";
import { useAuth } from "./AuthProvider";

type ThreadFilters = {
  label: EmailLabel | "all";
  projectId: string | "all";
  search: string;
};

type ThreadAction = "mark-done" | "mark-read" | "open-gmail";

const THREADS_PER_PAGE = 15;

export default function ThreadInbox() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [pagination, setPagination] = useState<EmailPagination>({
    page: 1,
    perPage: THREADS_PER_PAGE,
    total: 0,
    totalPages: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<ThreadFilters>({
    label: "all",
    projectId: "all",
    search: "",
  });

  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [threadDetails, setThreadDetails] = useState<Record<string, ThreadDetail>>({});
  const [threadDetailLoading, setThreadDetailLoading] = useState<Record<string, boolean>>({});
  const [threadDetailError, setThreadDetailError] = useState<Record<string, string | null>>({});
  const [threadActionLoading, setThreadActionLoading] = useState<Record<string, boolean>>({});

  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const loadThreads = useCallback(
    async (page: number, currentFilters: ThreadFilters) => {
      if (!accessToken) {
        setThreads([]);
        setPagination((prev) => ({
          ...prev,
          page,
          total: 0,
          totalPages: 0,
          hasMore: false,
        }));
        setError("Authentication required.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { threads: items, pagination: nextPagination } = await fetchThreads({
          accessToken,
          page,
          perPage: THREADS_PER_PAGE,
          label: currentFilters.label !== "all" ? currentFilters.label : undefined,
          projectId: currentFilters.projectId !== "all" ? currentFilters.projectId : undefined,
        });

        setThreads(items);
        setPagination(nextPagination);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load threads.";
        setError(message);
        setThreads([]);
      } finally {
        setLoading(false);
      }
    },
    [accessToken]
  );

  const ensureThreadDetail = useCallback(
    async (threadId: string, force = false): Promise<ThreadDetail | null> => {
      if (!accessToken) {
        return null;
      }

      if (!force && threadDetails[threadId]) {
        return threadDetails[threadId];
      }

      setThreadDetailLoading((prev) => ({ ...prev, [threadId]: true }));
      setThreadDetailError((prev) => ({ ...prev, [threadId]: null }));

      try {
        const detail = await fetchThreadDetail(threadId, { accessToken });
        setThreadDetails((prev) => ({ ...prev, [threadId]: detail }));
        return detail;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load thread details.";
        setThreadDetailError((prev) => ({ ...prev, [threadId]: message }));
        return null;
      } finally {
        setThreadDetailLoading((prev) => ({ ...prev, [threadId]: false }));
      }
    },
    [accessToken, threadDetails]
  );

  useEffect(() => {
    if (!accessToken || projectsLoaded) {
      return;
    }

    let cancelled = false;
    setProjectsLoaded(false);
    setProjectsError(null);

    fetchProjects({ accessToken })
      .then((items) => {
        if (cancelled) return;
        setProjects(items);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unable to load projects.";
        setProjectsError(message);
      })
      .finally(() => {
        if (cancelled) return;
        setProjectsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, projectsLoaded]);

  useEffect(() => {
    void loadThreads(1, filters);
    setExpandedThreadId(null);
  }, [filters, loadThreads]);

  const projectLookup = useMemo(() => {
    const map = new Map<string, ProjectListItem["project"]>();
    projects.forEach((entry) => {
      if (entry.project?.id) {
        map.set(entry.project.id, entry.project);
      }
    });
    return map;
  }, [projects]);

  const displayThreads = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    if (!query) {
      return threads;
    }

    return threads.filter((thread) => {
      if (thread.subjectCanonical.toLowerCase().includes(query)) {
        return true;
      }

      return thread.participants.some((participant) => {
        const identifier = (participant.name || participant.email || "").toLowerCase();
        return identifier.includes(query);
      });
    });
  }, [filters.search, threads]);

  const handleFilterChange = (partial: Partial<ThreadFilters>) => {
    setFilters((prev) => ({
      ...prev,
      ...partial,
    }));
  };

  const handlePagination = (direction: "next" | "prev") => {
    if (direction === "next" && pagination.hasMore) {
      const nextPage = pagination.page + 1;
      setPagination((prev) => ({ ...prev, page: nextPage }));
      void loadThreads(nextPage, filters);
      return;
    }

    if (direction === "prev" && pagination.page > 1) {
      const nextPage = pagination.page - 1;
      setPagination((prev) => ({ ...prev, page: nextPage }));
      void loadThreads(nextPage, filters);
    }
  };

  const handleThreadToggle = (threadId: string) => {
    setExpandedThreadId((prev) => {
      const next = prev === threadId ? null : threadId;
      if (next === threadId) {
        void ensureThreadDetail(threadId);
      }
      return next;
    });
  };

  const handleThreadAction = async (thread: ThreadRecord, action: ThreadAction) => {
    if (action === "open-gmail") {
      if (thread.gmailThreadId) {
        const threadUrl = `https://mail.google.com/mail/u/0/#inbox/${thread.gmailThreadId}`;
        window.open(threadUrl, "_blank", "noopener");
      }
      return;
    }

    if (!accessToken) {
      setError("Authentication required.");
      return;
    }

    setThreadActionLoading((prev) => ({ ...prev, [thread.id]: true }));

    try {
      const detail = await ensureThreadDetail(thread.id);
      if (!detail) {
        throw new Error("Thread detail is unavailable.");
      }

      const emails = detail.emails ?? [];
      if (emails.length === 0) {
        return;
      }

      if (action === "mark-done") {
        await Promise.all(
          emails.map((email) =>
            updateEmailTriage(email.id, {
              accessToken,
              triageState: "resolved",
              isRead: true,
            })
          )
        );
      }

      if (action === "mark-read") {
        await Promise.all(
          emails.map((email) =>
            updateEmailTriage(email.id, {
              accessToken,
              isRead: true,
            })
          )
        );
      }

      await ensureThreadDetail(thread.id, true);
      await loadThreads(pagination.page, filters);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Thread action failed. Please try again.";
      setError(message);
    } finally {
      setThreadActionLoading((prev) => ({ ...prev, [thread.id]: false }));
    }
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Threaded Inbox</h1>
            <p className="text-sm text-gray-500">
              Review conversations with rolling summaries and focus on the latest context.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative">
              <input
                type="search"
                value={filters.search}
                onChange={(event) => handleFilterChange({ search: event.target.value })}
                placeholder="Search subject or participants"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 md:w-64"
              />
            </div>

            <select
              value={filters.label}
              onChange={(event) =>
                handleFilterChange({ label: event.target.value as ThreadFilters["label"] })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 md:w-48"
            >
              <option value="all">All labels</option>
              {DEFAULT_EMAIL_LABELS.map((label) => (
                <option key={label} value={label}>
                  {formatLabel(label)}
                </option>
              ))}
            </select>

            <select
              value={filters.projectId}
              onChange={(event) =>
                handleFilterChange({ projectId: event.target.value as ThreadFilters["projectId"] })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 md:w-48"
            >
              <option value="all">All projects</option>
              {projects.map(({ project }) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {projectsError && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {projectsError}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <ThreadSkeleton />
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">
            {error}
          </div>
        ) : displayThreads.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-500">
            No threads match your filters yet.
          </div>
        ) : (
          <div className="space-y-4">
            {displayThreads.map((thread) => {
              const detail = threadDetails[thread.id] ?? null;
              const isExpanded = expandedThreadId === thread.id;
              const detailLoading = threadDetailLoading[thread.id] ?? false;
              const detailError = threadDetailError[thread.id] ?? null;
              const actionLoading = threadActionLoading[thread.id] ?? false;
              const linkedProject =
                thread.primaryProjectId && projectLookup.get(thread.primaryProjectId);

              return (
                <ThreadListItem
                  key={thread.id}
                  thread={thread}
                  detail={detail}
                  expanded={isExpanded}
                  detailLoading={detailLoading}
                  detailError={detailError}
                  actionLoading={actionLoading}
                  linkedProjectName={linkedProject?.name ?? null}
                  onToggle={() => handleThreadToggle(thread.id)}
                  onAction={(action) => handleThreadAction(thread, action)}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Page {pagination.page} • Showing {displayThreads.length} of {pagination.total} threads
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handlePagination("prev")}
              disabled={pagination.page === 1 || loading}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => handlePagination("next")}
              disabled={!pagination.hasMore || loading}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ThreadListItemProps {
  thread: ThreadRecord;
  detail: ThreadDetail | null;
  expanded: boolean;
  detailLoading: boolean;
  detailError: string | null;
  actionLoading: boolean;
  linkedProjectName: string | null;
  onToggle: () => void;
  onAction: (action: ThreadAction) => void;
}

function ThreadListItem({
  thread,
  detail,
  expanded,
  detailLoading,
  detailError,
  actionLoading,
  linkedProjectName,
  onToggle,
  onAction,
}: ThreadListItemProps) {
  const participants = getParticipantLabel(thread.participants);
  const summary = thread.rollingSummary?.summary ?? "";
  const outstanding = thread.rollingSummary?.outstandingQuestions ?? [];

  return (
    <article className="rounded-xl border border-gray-200 bg-white shadow-sm transition hover:border-indigo-200">
      <header className="cursor-pointer px-5 py-4" onClick={onToggle}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-gray-900">
                {thread.subjectCanonical || "No subject"}
              </h2>
              {thread.unreadCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
                  {thread.unreadCount} unread
                </span>
              )}
              {thread.priorityScore != null && (
                <PriorityBadge score={thread.priorityScore} />
              )}
            </div>
            <p className="mt-1 truncate text-sm text-gray-600">{participants}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span>{thread.messageCount} messages</span>
              <span>Last activity {formatRelativeTime(thread.lastMessageAt)}</span>
              {linkedProjectName && <span>Primary project • {linkedProjectName}</span>}
              {thread.primaryLabel && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                  {formatLabel(thread.primaryLabel)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAction("open-gmail");
              }}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50"
            >
              <svg
                className="h-4 w-4 text-gray-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16v16H4z" />
                <path d="M22 6l-10 7L2 6" />
              </svg>
              Gmail
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAction("mark-read");
              }}
              disabled={actionLoading}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLoading ? "Updating…" : "Mark read"}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onAction("mark-done");
              }}
              disabled={actionLoading}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLoading ? "Updating…" : "Mark done"}
            </button>
          </div>
        </div>

        {summary && (
          <p className="mt-3 line-clamp-3 text-sm text-gray-700">{summary}</p>
        )}

        {!summary && outstanding.length > 0 && (
          <div className="mt-3 text-sm text-gray-700">
            <span className="font-medium text-gray-900">Outstanding:</span>{" "}
            {outstanding.slice(0, 3).join("; ")}
            {outstanding.length > 3 ? "…" : ""}
          </div>
        )}
      </header>

      {expanded && (
        <section className="border-t border-gray-200 px-5 py-4">
          {detailLoading ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
              Loading conversation…
            </div>
          ) : detailError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {detailError}
            </div>
          ) : detail ? (
            <div className="space-y-4">
              {detail.emails.map((email) => (
                <MessageCard key={email.id} message={email} />
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
              No messages available.
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function MessageCard({ message }: { message: ThreadEmailMessage }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {message.fromName || message.fromEmail}
          </p>
          <p className="text-xs text-gray-500">
            {formatRelativeTime(message.receivedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          {message.category && (
            <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">
              {formatLabel(message.category)}
            </span>
          )}
          {message.triageState && (
            <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700">
              {formatTriageLabel(message.triageState)}
            </span>
          )}
          {typeof message.priorityScore === "number" && (
            <PriorityBadge score={message.priorityScore} subtle />
          )}
        </div>
      </div>

      <p className="mt-2 text-sm font-medium text-gray-900">{message.subject}</p>

      {message.summary && (
        <p className="mt-2 text-sm text-gray-700">{message.summary}</p>
      )}
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="animate-pulse rounded-xl border border-gray-200 bg-white px-5 py-4">
          <div className="flex flex-col gap-3">
            <div className="h-4 w-1/2 rounded bg-gray-200" />
            <div className="h-3 w-2/3 rounded bg-gray-200" />
            <div className="h-3 w-3/4 rounded bg-gray-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (Number.isNaN(diffMs)) {
    return "unknown";
  }

  const diffMinutes = Math.round(diffMs / (1000 * 60));
  if (diffMinutes < 1) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatLabel(label: string): string {
  return label.replace(/\//g, " · ").replace(/_/g, " ");
}

function getParticipantLabel(participants: ThreadRecord["participants"]): string {
  if (!participants.length) {
    return "No participants recorded";
  }

  const names = participants
    .filter((participant) => !participant.isUser)
    .map((participant) => participant.name || participant.email)
    .filter(Boolean);

  if (names.length === 0) {
    return participants.map((participant) => participant.email).join(", ");
  }

  if (names.length === 1) {
    return names[0]!;
  }

  return `${names[0]}, ${names[1]}${names.length > 2 ? ` +${names.length - 2}` : ""}`;
}

function PriorityBadge({ score, subtle = false }: { score: number; subtle?: boolean }) {
  let color = subtle ? "bg-gray-200 text-gray-700" : "bg-gray-900 text-white";
  let label = "Low";

  if (score >= 90) {
    color = subtle ? "bg-red-100 text-red-700" : "bg-red-600 text-white";
    label = "Critical";
  } else if (score >= 75) {
    color = subtle ? "bg-orange-100 text-orange-700" : "bg-orange-500 text-white";
    label = "High";
  } else if (score >= 55) {
    color = subtle ? "bg-yellow-100 text-yellow-700" : "bg-yellow-500 text-white";
    label = "Medium";
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

function formatTriageLabel(state: string): string {
  switch (state) {
    case "resolved":
      return "Resolved";
    case "snoozed":
      return "Snoozed";
    case "acknowledged":
      return "Acknowledged";
    default:
      return "Needs review";
  }
}
