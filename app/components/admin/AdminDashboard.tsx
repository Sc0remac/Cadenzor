"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../AuthProvider";
import AdminUsersPanel from "./AdminUsersPanel";
import AdminProjectsPanel from "./AdminProjectsPanel";
import AdminDataPanel from "./AdminDataPanel";

interface OverviewStats {
  totalUsers: number;
  adminUsers: number;
  totalProjects: number;
  activeProjects: number;
  totalEmails: number;
  unreadEmails: number;
  seededEmails: number;
  recentProjects: Array<{
    id: string;
    name: string;
    status: string;
    updatedAt: string | null;
  }>;
}

const OVERVIEW_DEFAULT: OverviewStats = {
  totalUsers: 0,
  adminUsers: 0,
  totalProjects: 0,
  activeProjects: 0,
  totalEmails: 0,
  unreadEmails: 0,
  seededEmails: 0,
  recentProjects: [],
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "projects", label: "Projects" },
  { id: "data", label: "Data ops" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export default function AdminDashboard() {
  const { session, profile, loading } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [overview, setOverview] = useState<OverviewStats>(OVERVIEW_DEFAULT);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const isAdmin = profile?.isAdmin ?? false;

  const fetchOverview = useCallback(async () => {
    if (!accessToken || !isAdmin) {
      return;
    }

    setOverviewLoading(true);
    setOverviewError(null);

    try {
      const response = await fetch("/api/admin/overview", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load overview");
      }

      setOverview((payload?.overview as OverviewStats) ?? OVERVIEW_DEFAULT);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setOverviewError(err?.message || "Failed to load overview");
      setOverview(OVERVIEW_DEFAULT);
    } finally {
      setOverviewLoading(false);
    }
  }, [accessToken, isAdmin]);

  useEffect(() => {
    if (!isAdmin || !accessToken) {
      return;
    }

    void fetchOverview();
  }, [fetchOverview, isAdmin, accessToken]);

  const handleChildChange = useCallback(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const overviewCards = useMemo(
    () => [
      { label: "Total users", value: overview.totalUsers },
      { label: "Admins", value: overview.adminUsers },
      { label: "Projects", value: overview.totalProjects },
      { label: "Active projects", value: overview.activeProjects },
      { label: "Emails", value: overview.totalEmails },
      { label: "Unread emails", value: overview.unreadEmails },
      { label: "Seeded emails", value: overview.seededEmails },
    ],
    [overview]
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-600">
        Checking permissions…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-sm text-amber-800 shadow-sm">
        <h2 className="text-lg font-semibold">Admin access required</h2>
        <p className="mt-2">
          Your account does not have administrator privileges. Ask an existing admin to promote you from the Users panel.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-gray-900">Admin console</h1>
        <p className="text-sm text-gray-600">
          Configure teams, projects, and demo data from a single secure hub.
        </p>
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {activeTab === "overview" ? (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <button
              type="button"
              onClick={() => void fetchOverview()}
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:text-gray-900"
            >
              Refresh
            </button>
            {overviewLoading ? <span>Loading metrics…</span> : null}
            {lastRefreshed ? (
              <span>Last updated {lastRefreshed.toLocaleString()}</span>
            ) : null}
            {overviewError ? <span className="text-red-600">{overviewError}</span> : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {overviewCards.map((card) => (
              <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{card.label}</p>
                <p className="mt-2 text-3xl font-semibold text-gray-900">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-semibold text-gray-900">Recent project activity</h2>
              <p className="text-xs text-gray-500">
                Latest updates across the workspace. Use this feed to verify seeding operations.
              </p>
            </div>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Project</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-6 py-3 text-left font-semibold text-gray-700">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {overview.recentProjects.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-6 text-center text-sm text-gray-500">
                      No recent activity yet.
                    </td>
                  </tr>
                ) : (
                  overview.recentProjects.map((project) => (
                    <tr key={project.id}>
                      <td className="px-6 py-4 text-gray-900">{project.name}</td>
                      <td className="px-6 py-4 text-gray-600">{project.status}</td>
                      <td className="px-6 py-4 text-gray-500">{formatDate(project.updatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "users" ? (
        <AdminUsersPanel
          accessToken={accessToken}
          currentUserId={profile?.id ?? null}
          onChange={handleChildChange}
        />
      ) : null}

      {activeTab === "projects" ? (
        <AdminProjectsPanel accessToken={accessToken} onChange={handleChildChange} />
      ) : null}

      {activeTab === "data" ? (
        <AdminDataPanel accessToken={accessToken} onChange={handleChildChange} />
      ) : null}
    </section>
  );
}
