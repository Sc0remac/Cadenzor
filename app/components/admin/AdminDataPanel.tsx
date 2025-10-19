"use client";

import { useCallback, useState } from "react";

interface AdminDataPanelProps {
  accessToken: string | null;
  onChange?: () => void;
}

interface ActionStatus {
  message: string;
  tone: "success" | "error";
}

export default function AdminDataPanel({ accessToken, onChange }: AdminDataPanelProps) {
  const [seedCount, setSeedCount] = useState(10);
  const [status, setStatus] = useState<ActionStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [purgeEmail, setPurgeEmail] = useState("");
  const [purgeUserId, setPurgeUserId] = useState("");
  const [purgeDeleteAuth, setPurgeDeleteAuth] = useState(true);
  const [purgeStatus, setPurgeStatus] = useState<ActionStatus | null>(null);
  const [purgeRunning, setPurgeRunning] = useState(false);

  const requireToken = useCallback(() => {
    if (!accessToken) {
      setStatus({ tone: "error", message: "You need to refresh your session to run admin tasks." });
      return false;
    }
    return true;
  }, [accessToken]);

  const runAction = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!requireToken()) {
        return;
      }

      setRunning(true);
      setStatus(null);

      try {
        const response = await fetch("/api/admin/seed", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result?.error || "Failed to run admin action");
        }

        const summary = Object.entries(result)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" · ");

        setStatus({ tone: "success", message: `Completed. ${summary}` });
        onChange?.();
      } catch (err: any) {
        setStatus({ tone: "error", message: err?.message || "Failed to run admin action" });
      } finally {
        setRunning(false);
      }
    },
    [accessToken, onChange, requireToken]
  );

  const handleGenerate = useCallback(() => {
    const count = Number.isFinite(seedCount) ? Math.max(1, Math.min(200, Math.floor(seedCount))) : 10;
    void runAction({ action: "generateEmails", count });
  }, [seedCount, runAction]);

  const handleMarkRead = useCallback(() => {
    void runAction({ action: "markAllEmailsRead" });
  }, [runAction]);

  const handleDelete = useCallback(() => {
    void runAction({ action: "deleteSeededEmails" });
  }, [runAction]);

  const handlePurge = useCallback(async () => {
    if (!purgeEmail.trim() && !purgeUserId.trim()) {
      setPurgeStatus({ tone: "error", message: "Enter an email or user ID to purge." });
      return;
    }

    if (!requireToken()) {
      return;
    }

    setPurgeRunning(true);
    setPurgeStatus(null);

    try {
      const response = await fetch("/api/admin/users/purge", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: purgeEmail.trim() || undefined,
          userId: purgeUserId.trim() || undefined,
          deleteAuthUser: purgeDeleteAuth,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.error || "Failed to purge user data");
      }

      const parts: string[] = [];
      if (Array.isArray(result?.dataDeletions)) {
        for (const entry of result.dataDeletions as Array<{ table: string; deleted: number }>) {
          parts.push(`${entry.table}: ${entry.deleted}`);
        }
      }

      if (result?.authDeletion) {
        const { status: authStatus, error: authError } = result.authDeletion as {
          status?: string;
          error?: string | null;
        };
        parts.push(
          `Auth: ${authStatus ?? "unknown"}${authError ? ` (${authError})` : ""}`
        );
      }

      setPurgeStatus({
        tone: "success",
        message:
          parts.length > 0
            ? `Purge complete · ${parts.join(" · ")}`
            : "Purge complete.",
      });

      onChange?.();
    } catch (error: any) {
      setPurgeStatus({
        tone: "error",
        message: error?.message || "Failed to purge user data",
      });
    } finally {
      setPurgeRunning(false);
    }
  }, [
    accessToken,
    onChange,
    purgeDeleteAuth,
    purgeEmail,
    purgeUserId,
    requireToken,
  ]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Data operations</h2>
        <p className="text-sm text-gray-600">
          Seed demo emails, bulk-mark messages, and tidy up generated data without leaving the dashboard.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Generate demo emails</h3>
          <p className="text-xs text-gray-500">
            Creates structured fixtures that appear immediately in the inbox and analytics.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <label className="text-xs font-semibold uppercase text-gray-500">
              Count
              <input
                type="number"
                min={1}
                max={200}
                value={seedCount}
                onChange={(event) => setSeedCount(Number(event.target.value))}
                className="mt-1 w-24 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </label>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={running}
              className="ml-auto rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-500"
            >
              {running ? "Working…" : "Create emails"}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Mark all emails read</h3>
          <p className="text-xs text-gray-500">
            Useful after stress-testing workflows—you can reset the inbox state instantly.
          </p>
          <button
            type="button"
            onClick={handleMarkRead}
            disabled={running}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-500"
          >
            {running ? "Working…" : "Mark as read"}
          </button>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Clear seeded emails</h3>
          <p className="text-xs text-gray-500">
            Removes any messages generated from the admin console to keep production tidy.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={running}
            className="mt-4 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-400"
          >
            {running ? "Working…" : "Delete seeded"}
          </button>
        </div>
      </div>

      {status ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            status.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {status.message}
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-gray-900">Reset user account</h3>
        <p className="text-xs text-gray-500">
          Remove app data for a user and optionally delete their Supabase Auth record. Use this before re-testing onboarding flows with the same address.
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold uppercase text-gray-500">
            Email (optional)
            <input
              type="email"
              value={purgeEmail}
              onChange={(event) => setPurgeEmail(event.target.value)}
              placeholder="oran@example.com"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-gray-500">
            User ID (optional)
            <input
              type="text"
              value={purgeUserId}
              onChange={(event) => setPurgeUserId(event.target.value)}
              placeholder="UUID identifier"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={purgeDeleteAuth}
            onChange={(event) => setPurgeDeleteAuth(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
          />
          Also delete Supabase Auth user (requires service role key)
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePurge}
            disabled={purgeRunning}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-red-400"
          >
            {purgeRunning ? "Purging…" : "Purge user"}
          </button>
          <span className="text-xs text-gray-500">
            Provide an email, user ID, or both. Email lookup runs first and falls back to the ID.
          </span>
        </div>

        {purgeStatus ? (
          <div
            className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
              purgeStatus.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {purgeStatus.message}
          </div>
        ) : null}
      </div>
    </section>
  );
}
