"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  CalendarAccountStatus,
  DriveAccountStatus,
  GmailAccountStatus,
} from "@/lib/supabaseClient";

import { useAuth } from "../AuthProvider";

type IntegrationStatus = DriveAccountStatus | GmailAccountStatus | CalendarAccountStatus;

interface GoogleIntegrationCardProps {
  title: string;
  description: string;
  messageChannel: string;
  fetchStatus: (accessToken?: string) => Promise<IntegrationStatus>;
  startOAuth: (options: { redirectTo?: string }, accessToken?: string) => Promise<{ authUrl: string; state: string }>;
  disconnect: (accessToken?: string) => Promise<void>;
  connectLabel?: string;
  additionalDetails?: ReactNode;
}

interface AccountDetails {
  id: string;
  email: string;
  scopes: string[];
  expiresAt: string;
}

function parseAccount(status: IntegrationStatus | null): AccountDetails | null {
  if (!status || !status.connected || !status.account) {
    return null;
  }
  return status.account;
}

export default function GoogleIntegrationCard(props: GoogleIntegrationCardProps) {
  const { title, description, messageChannel, fetchStatus, startOAuth, disconnect, connectLabel = "Connect" } = props;
  const { session } = useAuth();
  const accessToken = session?.access_token;

  const [account, setAccount] = useState<AccountDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!accessToken) {
      setAccount(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const status = await fetchStatus(accessToken);
      setAccount(parseAccount(status));
    } catch (err: any) {
      setError(err?.message || "Failed to load account status");
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, fetchStatus]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent) {
      if (!event?.data || typeof event.data !== "object") return;
      const source = (event.data as Record<string, unknown>).source;
      if (source !== messageChannel) return;

      if ((event.data as Record<string, unknown>).status === "success") {
        setError(null);
        void refreshStatus();
      } else if ((event.data as Record<string, unknown>).status === "error") {
        const message = (event.data as Record<string, unknown>).message;
        setError(typeof message === "string" ? message : "Connection failed");
      }
    }

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [messageChannel, refreshStatus]);

  const expiresInMinutes = useMemo(() => {
    if (!account?.expiresAt) return null;
    const timestamp = Date.parse(account.expiresAt);
    if (Number.isNaN(timestamp)) return null;
    const diffMs = timestamp - Date.now();
    return Math.max(Math.floor(diffMs / 60000), 0);
  }, [account?.expiresAt]);

  const handleStartOAuth = async () => {
    if (!accessToken) return;
    setError(null);
    setLoading(true);
    try {
      const redirectTo = typeof window !== "undefined" ? window.location.pathname : "/settings/integrations";
      const { authUrl } = await startOAuth({ redirectTo }, accessToken);
      window.open(authUrl, `${messageChannel}-oauth`, "width=480,height=640");
    } catch (err: any) {
      setError(err?.message || "Failed to start OAuth flow");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      await disconnect(accessToken);
      setAccount(null);
    } catch (err: any) {
      setError(err?.message || "Failed to disconnect account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <header className="mb-3 space-y-1">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-600">{description}</p>
      </header>

      {props.additionalDetails ? (
        <div className="mb-4 text-sm text-gray-600">{props.additionalDetails}</div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-700">
          {account ? (
            <div className="space-y-1">
              <p>
                Connected as <span className="font-medium text-gray-900">{account.email}</span>.
              </p>
              <p className="text-xs text-gray-500">
                Scopes granted: {account.scopes.length > 0 ? account.scopes.join(", ") : "None"}
              </p>
              {expiresInMinutes != null ? (
                <p className="text-xs text-gray-500">Access token refreshes automatically (expires in ~{expiresInMinutes} min).</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-gray-600">No account connected yet.</p>
          )}
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshStatus()}
            disabled={loading || !accessToken}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
          >
            {loading ? "Refreshing…" : "Refresh status"}
          </button>
          {account ? (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={loading || !accessToken}
              className="rounded border border-red-500 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartOAuth}
              disabled={loading || !accessToken}
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {connectLabel}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
