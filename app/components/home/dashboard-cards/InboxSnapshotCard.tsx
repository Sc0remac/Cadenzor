import type { EmailRecord } from "@kazador/shared";
import type { ThreadRecord } from "../../../lib/supabaseClient";

interface InboxSnapshotCardProps {
  emails: EmailRecord[];
  threads: ThreadRecord[];
  loading: boolean;
  error: string | null;
  mode: "emails" | "threads";
}

function formatReceivedAt(isoDate: string) {
  const date = new Date(isoDate);
  const now = new Date();
  const diffInSeconds = (now.getTime() - date.getTime()) / 1000;
  const diffInMinutes = diffInSeconds / 60;
  const diffInHours = diffInMinutes / 60;

  if (diffInHours < 1) {
    return `${Math.round(diffInMinutes)}m ago`;
  }
  if (diffInHours < 24) {
    return `${Math.round(diffInHours)}h ago`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getPriorityInfo(score: number | null | undefined) {
  if (score === null || score === undefined) {
    return { level: "", color: "" };
  }
  if (score >= 90) {
    return { level: "Urgent", color: "bg-red-100 text-red-800" };
  }
  if (score >= 70) {
    return { level: "High", color: "bg-orange-100 text-orange-800" };
  }
  if (score >= 50) {
    return { level: "Medium", color: "bg-yellow-100 text-yellow-800" };
  }
  return { level: "Low", color: "bg-gray-100 text-gray-800" };
}

export function InboxSnapshotCard({ emails, threads, loading, error, mode }: InboxSnapshotCardProps) {
  const items = mode === "threads" ? threads : emails;
  const hasItems = items.length > 0;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Inbox Snapshot</h3>
        <a href="/inbox" className="text-sm font-medium text-blue-600 hover:underline">
          Go to Inbox
        </a>
      </div>

      <div className="mt-4 flow-root">
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 rounded-lg bg-gray-50 p-3">
                <div className="h-8 w-8 rounded-full bg-gray-200"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 rounded bg-gray-200"></div>
                  <div className="h-3 w-1/2 rounded bg-gray-200"></div>
                </div>
                <div className="h-3 w-12 rounded bg-gray-200"></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
          </div>
        ) : !hasItems ? (
          <div className="rounded-md border-2 border-dashed border-gray-200 p-8 text-center">
             <div className="mx-auto h-12 w-12 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-gray-800">Inbox Zero</h3>
            <p className="mt-1 text-sm text-gray-500">No new emails to show right now.</p>
          </div>
        ) : (
          <ul className="-my-3 divide-y divide-gray-200/70">
            {mode === "threads"
              ? threads.map((thread) => {
                  const priority = getPriorityInfo(thread.priorityScore ?? null);
                  return (
                    <li key={thread.id} className="flex items-start gap-4 py-3">
                      <div className="flex-shrink-0">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
                          {thread.participants[0]?.name?.charAt(0) ??
                            thread.participants[0]?.email.charAt(0) ??
                            "@"}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {thread.subjectCanonical || "Untitled thread"}
                        </p>
                        <p className="mt-0.5 truncate text-sm text-gray-600">
                          {getThreadPreview(thread)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span>{thread.messageCount} messages</span>
                          <span>Updated {formatReceivedAt(thread.lastMessageAt)}</span>
                          {thread.unreadCount > 0 && (
                            <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700">
                              {thread.unreadCount} unread
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-end gap-1">
                        {priority.level && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${priority.color}`}>
                            {priority.level}
                          </span>
                        )}
                        {thread.primaryLabel && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                            {thread.primaryLabel.replace(/\//g, " · ").replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })
              : emails.map((email) => {
                  const priority = getPriorityInfo(email.priorityScore);
                  return (
                    <li key={email.id} className="flex items-center gap-4 py-3">
                      <div className="flex-shrink-0">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-600">
                          {email.fromName?.charAt(0) || email.fromEmail.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-800">{email.fromName || email.fromEmail}</p>
                        <p className="truncate text-sm text-gray-500">{email.subject}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-x-2 text-right">
                        {priority.level && (
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${priority.color}`}>
                            {priority.level}
                          </span>
                        )}
                        <span className="text-xs text-gray-500">{formatReceivedAt(email.receivedAt)}</span>
                      </div>
                    </li>
                  );
                })}
          </ul>
        )}
      </div>
    </div>
  );
}

function getThreadPreview(thread: ThreadRecord): string {
  if (thread.rollingSummary?.summary) {
    return thread.rollingSummary.summary;
  }

  if (thread.rollingSummary?.outstandingQuestions?.length) {
    return `Outstanding: ${thread.rollingSummary.outstandingQuestions[0]}`;
  }

  return formatThreadParticipants(thread);
}

function formatThreadParticipants(thread: ThreadRecord): string {
  const participants = thread.participants.filter((p) => !p.isUser);
  if (participants.length === 0) {
    return "No participants recorded";
  }

  const names = participants.map((p) => p.name || p.email).filter(Boolean);
  if (names.length === 1) {
    return names[0]!;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}
