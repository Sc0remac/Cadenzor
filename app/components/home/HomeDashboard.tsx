"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../AuthProvider";
import {
  fetchTodayDigest,
  fetchRecentEmails,
  fetchCalendarEvents,
  fetchThreads,
  type ThreadRecord,
} from "../../lib/supabaseClient";
import { featureFlags } from "../../lib/featureFlags";
import type {
  DigestPayload,
  UserPreferenceRecord,
  EmailRecord,
  CalendarEventRecord,
  DigestTopAction,
  DigestProjectSnapshot,
} from "@kazador/shared";

import { TodayAgendaCard } from "./dashboard-cards/TodayAgendaCard";
import { InboxSnapshotCard } from "./dashboard-cards/InboxSnapshotCard";
import { ProjectsPulseCard } from "./dashboard-cards/ProjectsPulseCard";
import { TimelineGlimpseCard } from "./dashboard-cards/TimelineGlimpseCard";
import { QuickActionsCard } from "./dashboard-cards/QuickActionsCard";
import { GreetingHeader } from "./dashboard-cards/GreetingHeader";

interface DashboardState {
  digest: DigestPayload | null;
  preferences: UserPreferenceRecord | null;
  emails: EmailRecord[];
  threads: ThreadRecord[];
  calendarEvents: CalendarEventRecord[];
  loading: {
    digest: boolean;
    emails: boolean;
    calendar: boolean;
  };
  error: {
    digest: string | null;
    emails: string | null;
    calendar: string | null;
  };
}

const INITIAL_STATE: DashboardState = {
  digest: null,
  preferences: null,
  emails: [],
  threads: [],
  calendarEvents: [],
  loading: {
    digest: true,
    emails: true,
    calendar: true,
  },
  error: {
    digest: null,
    emails: null,
    calendar: null,
  },
};

export default function HomeDashboard() {
  const { session, user } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [state, setState] = useState<DashboardState>(INITIAL_STATE);
  const threadedInboxEnabled = featureFlags.threadedInbox;

  const loadDashboardData = useCallback(async () => {
    if (!accessToken) {
      setState((prev) => ({
        ...prev,
        loading: { digest: false, emails: false, calendar: false },
        error: {
          digest: "Authentication required.",
          emails: "Authentication required.",
          calendar: "Authentication required.",
        },
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      loading: { digest: true, emails: true, calendar: true },
      error: { digest: null, emails: null, calendar: null },
    }));

    try {
      const [digestRes, emailsRes, calendarRes] = await Promise.allSettled([
        fetchTodayDigest({ accessToken }),
        threadedInboxEnabled
          ? fetchThreads({ accessToken, perPage: 5 })
          : fetchRecentEmails({ accessToken, perPage: 10 }),
        fetchCalendarEvents({
          accessToken,
          rangeStart: new Date().toISOString(),
          rangeEnd: new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
          limit: 10,
        }),
      ]);

      setState((prev) => ({
        ...prev,
        digest: digestRes.status === "fulfilled" ? digestRes.value.digest : prev.digest,
        preferences: digestRes.status === "fulfilled" ? digestRes.value.preferences : prev.preferences,
        emails:
          !threadedInboxEnabled && emailsRes.status === "fulfilled"
            ? emailsRes.value.items
            : [],
        threads:
          threadedInboxEnabled && emailsRes.status === "fulfilled"
            ? emailsRes.value.threads.slice(0, 5)
            : threadedInboxEnabled
            ? prev.threads
            : [],
        calendarEvents: calendarRes.status === "fulfilled" ? calendarRes.value.events : prev.calendarEvents,
        loading: { digest: false, emails: false, calendar: false },
        error: {
          digest: digestRes.status === "rejected" ? (digestRes.reason as Error).message : null,
          emails: emailsRes.status === "rejected" ? (emailsRes.reason as Error).message : null,
          calendar: calendarRes.status === "rejected" ? (calendarRes.reason as Error).message : null,
        },
      }));
    } catch (err) {
      // This catch block might be redundant due to Promise.allSettled, but it's a good safeguard.
      setState((prev) => ({
        ...prev,
        loading: { digest: false, emails: false, calendar: false },
        error: {
          digest: "An unexpected error occurred.",
          emails: "An unexpected error occurred.",
          calendar: "An unexpected error occurred.",
        },
      }));
    }
  }, [accessToken, threadedInboxEnabled]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const { digest, emails, threads, calendarEvents, loading, error } = state;

  const timelineActions = useMemo(
    () => (digest?.topActions ?? []).filter((action) => action.entityType === "timeline").slice(0, 5),
    [digest]
  );

  const projectSnapshots = useMemo(
    () => (digest?.projects ?? []).slice(0, 3),
    [digest]
  );

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <GreetingHeader user={user} onRefresh={loadDashboardData} />

        <main className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Main Column */}
          <div className="grid grid-cols-1 gap-8 lg:col-span-2">
            <QuickActionsCard />

            <InboxSnapshotCard
              emails={emails}
              threads={threads}
              loading={loading.emails}
              error={error.emails}
              mode={threadedInboxEnabled ? "threads" : "emails"}
            />

            <ProjectsPulseCard
              projects={projectSnapshots}
              loading={loading.digest}
              error={error.digest}
            />
          </div>

          {/* Sidebar Column */}
          <div className="grid grid-cols-1 gap-8">
            <TodayAgendaCard
              events={calendarEvents}
              loading={loading.calendar}
              error={error.calendar}
            />

            <TimelineGlimpseCard
              actions={timelineActions}
              loading={loading.digest}
              error={error.digest}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
