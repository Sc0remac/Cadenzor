"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EmailLabel, EmailRecord } from "@cadenzor/shared";
import { DEFAULT_EMAIL_LABELS } from "@cadenzor/shared";
import { fetchEmailStats, fetchRecentEmails } from "../lib/supabaseClient";

type StatsState = Record<string, number>;

const POLL_INTERVAL_MS = 60 * 1000;

type StatusMessage = {
  type: "success" | "error";
  message: string;
};

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

export default function EmailDashboard() {
  const [stats, setStats] = useState<StatsState>({});
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const [statsData, emailData] = await Promise.all([
        fetchEmailStats(),
        fetchRecentEmails(),
      ]);
      setStats(statsData);
      setEmails(emailData);
      setError(null);
    } catch (err) {
      console.error("Failed to load dashboard data", err);
      const message = err instanceof Error ? err.message : "Failed to load statistics";
      setError(message);
    } finally {
      if (!silent) {
        setLoading(false);
      }
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      loadData({ silent: true }).catch((err) => console.error("Refresh failed", err));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleClassifyClick = async () => {
    setStatusMessage(null);
    setClassifying(true);
    try {
      const response = await fetch("/api/classify-emails", { method: "POST" });
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

  if (!initialized && loading) {
    return <p>Loading email statistics…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold">Unread by category</h2>
        <div className="flex items-center gap-3">
          {initialized && loading && (
            <span className="text-xs text-gray-500">Refreshing…</span>
          )}
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
          <span className="text-xs text-gray-500">
            Showing {emails.length} {emails.length === 1 ? "email" : "emails"}
          </span>
        </div>
        {emails.length === 0 ? (
          <p className="text-sm text-gray-600">No recent emails to display.</p>
        ) : (
          <ul className="space-y-4">
            {emails.map((email) => (
              <li key={email.id} className="rounded border border-gray-200 bg-white p-4 shadow">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{email.subject}</p>
                    <p className="text-sm text-gray-600">
                      {email.fromName || email.fromEmail} · {formatReceivedAt(email.receivedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
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
                </div>
                {email.summary && (
                  <p className="mt-3 text-sm text-gray-700">{email.summary}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
