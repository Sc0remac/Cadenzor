"use client";

import { useCallback, useEffect, useState } from "react";
import type { EmailCategory, EmailRecord } from "@cadenzor/shared";
import { fetchEmailStats, fetchRecentEmails } from "../lib/supabaseClient";

interface StatsState {
  [key: string]: number;
}

const CATEGORIES: EmailCategory[] = [
  "booking",
  "promo_time",
  "promo_submission",
  "logistics",
  "assets_request",
  "finance",
  "fan_mail",
  "legal",
  "other",
];

const POLL_INTERVAL_MS = 60 * 1000;

interface StatusMessage {
  type: "success" | "error";
  message: string;
}

function formatLabel(label: EmailCategory): string {
  return label.replace(/_/g, " ");
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
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  const loadData = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const [statsData, emailData] = await Promise.all([
          fetchEmailStats(),
          fetchRecentEmails(),
        ]);
        setStats(statsData);
        setEmails(emailData);
      } catch (err) {
        console.error(err);
        setError("Failed to load statistics");
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    []
  );

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
      await loadData();
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        message: err?.message || "Failed to classify emails",
      });
    } finally {
      setClassifying(false);
    }
  };

  if (loading) {
    return <p>Loading email statistics…</p>;
  }

  if (error) {
    return <p className="text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold">Unread by category</h2>
        <button
          type="button"
          onClick={handleClassifyClick}
          disabled={classifying}
          className="inline-flex items-center rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400"
        >
          {classifying ? "Classifying…" : "Classify emails"}
        </button>
      </div>

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
        {CATEGORIES.map((category) => {
          const count = stats[category] ?? 0;
          return (
            <div
              key={category}
              className="rounded border border-gray-200 bg-white p-4 shadow"
            >
              <h3 className="text-lg font-semibold capitalize">{formatLabel(category)}</h3>
              <p className="mt-2 text-2xl font-bold text-indigo-600">{count}</p>
            </div>
          );
        })}
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Latest emails</h2>
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
                          key={label}
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
