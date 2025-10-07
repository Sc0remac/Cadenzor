"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import {
  fetchDriveAccountStatus,
  startDriveOAuth,
  disconnectDriveAccount,
} from "../lib/supabaseClient";

interface DriveAccountDetails {
  id: string;
  email: string;
  scopes: string[];
  expiresAt: string;
}

export default function ProfileDriveIntegration() {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [driveAccount, setDriveAccount] = useState<DriveAccountDetails | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  const hasAccessToken = Boolean(accessToken);

  const refreshDriveAccountStatus = useCallback(async () => {
    if (!accessToken) {
      setDriveAccount(null);
      return;
    }

    setDriveLoading(true);
    setDriveError(null);
    try {
      const status = await fetchDriveAccountStatus(accessToken);
      if (status.connected && status.account) {
        setDriveAccount({
          id: status.account.id,
          email: status.account.email,
          scopes: status.account.scopes,
          expiresAt: status.account.expiresAt,
        });
      } else {
        setDriveAccount(null);
      }
    } catch (err: any) {
      setDriveError(err?.message || "Failed to load Drive status");
    } finally {
      setDriveLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void refreshDriveAccountStatus();
  }, [refreshDriveAccountStatus]);

  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent) {
      if (!event?.data || typeof event.data !== "object") return;
      if ((event.data as Record<string, unknown>).source !== "cadenzor-drive") return;

      if (event.data.status === "success") {
        setDriveError(null);
        setDriveAccount({
          id: event.data.accountId ?? "",
          email: event.data.accountEmail,
          scopes: event.data.scopes ?? [],
          expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
        });
        void refreshDriveAccountStatus();
      } else if (event.data.status === "error") {
        setDriveError(event.data.message ?? "Drive connection failed");
      }
    }

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [refreshDriveAccountStatus]);

  const expiresInMinutes = useMemo(() => {
    if (!driveAccount?.expiresAt) return null;
    const expiresAt = Date.parse(driveAccount.expiresAt);
    if (Number.isNaN(expiresAt)) return null;
    const diffMs = expiresAt - Date.now();
    return Math.max(Math.floor(diffMs / 60000), 0);
  }, [driveAccount?.expiresAt]);

  async function handleStartOAuth() {
    if (!accessToken) return;
    setDriveError(null);
    setDriveLoading(true);
    try {
      const redirectTo = typeof window !== "undefined" ? window.location.pathname : "/profile";
      const { authUrl } = await startDriveOAuth({ redirectTo }, accessToken);
      window.open(authUrl, "cadenzor-drive-oauth", "width=480,height=640");
    } catch (err: any) {
      setDriveError(err?.message || "Failed to start Drive connection");
    } finally {
      setDriveLoading(false);
    }
  }

  async function handleDisconnect() {
    if (!accessToken) return;
    setDriveLoading(true);
    setDriveError(null);
    try {
      await disconnectDriveAccount(accessToken);
      setDriveAccount(null);
    } catch (err: any) {
      setDriveError(err?.message || "Failed to disconnect Drive");
    } finally {
      setDriveLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <header className="mb-3 space-y-1">
        <h2 className="text-lg font-semibold text-gray-900">Google Drive</h2>
        <p className="text-sm text-gray-600">
          Authorise Cadenzor to access Drive so you can attach folders and files across all of your projects.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-sm text-gray-700">
          {driveAccount ? (
            <>
              <p>
                Connected as <span className="font-medium text-gray-900">{driveAccount.email}</span>.
              </p>
              <p className="text-xs text-gray-500">
                Access token refreshes automatically{expiresInMinutes != null ? ` (expires in ~${expiresInMinutes} min)` : ""}.
              </p>
            </>
          ) : (
            <p>No Google Drive account is connected yet.</p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            Cadenzor requests read access so you can index folders and select files without leaving the workspace.
          </p>
          {driveError ? <p className="mt-2 text-sm text-red-600">{driveError}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshDriveAccountStatus()}
            disabled={driveLoading || !hasAccessToken}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
          >
            {driveLoading ? "Refreshing…" : "Refresh status"}
          </button>
          {driveAccount ? (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={driveLoading || !hasAccessToken}
              className="rounded border border-red-500 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartOAuth}
              disabled={driveLoading || !hasAccessToken}
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              Connect Google Drive
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
