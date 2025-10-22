"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EmailLabel,
  EmailRecord,
  EmailProjectContext,
  PriorityEmailActionRule,
} from "@kazador/shared";
import { useAuth } from "./AuthProvider";
import {
  DEFAULT_EMAIL_LABELS,
  EMAIL_FALLBACK_LABEL,
  DEFAULT_PRIORITY_CONFIG,
  calculateEmailInboxPriority,
  clonePriorityConfig,
  type PriorityConfig,
} from "@kazador/shared";
import {
  DEFAULT_EMAILS_PER_PAGE,
  fetchEmailStats,
  fetchRecentEmails,
  updateEmailTriage,
  type UpdateEmailTriageOptions,
  type EmailStatsScope,
  type EmailSourceFilter,
  type EmailPagination,
} from "../lib/supabaseClient";
import { fetchPriorityConfig } from "../lib/priorityConfigClient";
import { CompactFilterToolbar, type SavedView, type FilterState } from "./inbox/CompactFilterToolbar";
import { CollapsiblePrioritySection, type PriorityZone } from "./inbox/CollapsiblePrioritySection";
import { PersistentPreviewPanel } from "./inbox/PersistentPreviewPanel";
import {
  EmailTableSkeleton,
  StatsBarSkeleton,
  InboxZeroState,
  NoResultsState,
  LoadingState,
  ErrorState
} from "./inbox/LoadingStates";

type StatusMessage = {
  type: "success" | "error";
  message: string;
};

export default function EmailDashboardV2() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  // State
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  // Selection & Preview
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [highlightedEmailId, setHighlightedEmailId] = useState<string | null>(null);
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set());

  // Filters
  const [savedView, setSavedView] = useState<SavedView>("needs-action");
  const [filters, setFilters] = useState<FilterState>({
    scope: "all",
    source: "all",
    label: "all",
    priority: "all",
    project: "all"
  });

  // Priority Config
  const [priorityConfig, setPriorityConfig] = useState<PriorityConfig>(() =>
    clonePriorityConfig(DEFAULT_PRIORITY_CONFIG)
  );
  const [priorityConfigLoading, setPriorityConfigLoading] = useState(true);

  // Stats for view tabs
  const [stats, setStats] = useState({
    unread: 0,
    needsAction: 0,
    today: 0
  });

  // Preview panel state
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Updating email IDs (for loading states)
  const [updatingEmailIds, setUpdatingEmailIds] = useState<Set<string>>(new Set());

  // Pagination
  const [pagination, setPagination] = useState<EmailPagination>({
    page: 1,
    perPage: DEFAULT_EMAILS_PER_PAGE,
    total: 0,
    totalPages: 0,
    hasMore: false
  });

  // Keyboard navigation
  const [currentIndex, setCurrentIndex] = useState(0);

  // ========== Derived State ==========

  const selectedEmail = useMemo(() => {
    return emails.find((e) => e.id === selectedEmailId) ?? null;
  }, [emails, selectedEmailId]);

  const filteredEmails = useMemo(() => {
    let result = emails;

    // Apply saved view filters
    switch (savedView) {
      case "needs-action":
        result = result.filter(
          (e) => e.triageState !== "resolved" && e.triageState !== "acknowledged"
        );
        break;
      case "today":
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        result = result.filter((e) => new Date(e.receivedAt) >= today);
        break;
      case "unread":
        result = result.filter((e) => !e.isRead);
        break;
      case "all":
        // Show all
        break;
      case "inbox":
      default:
        // Default inbox view: exclude resolved
        result = result.filter((e) => e.triageState !== "resolved");
        break;
    }

    // Apply additional filters
    if (filters.scope !== "all") {
      if (filters.scope === "unread") {
        result = result.filter((e) => !e.isRead);
      } else if (filters.scope === "snoozed") {
        result = result.filter((e) => e.triageState === "snoozed");
      } else if (filters.scope === "resolved") {
        result = result.filter((e) => e.triageState === "resolved");
      }
    }

    if (filters.source !== "all") {
      result = result.filter((e) => e.source === filters.source);
    }

    if (filters.label !== "all") {
      result = result.filter((e) => e.category === filters.label);
    }

    if (filters.priority !== "all") {
      result = result.filter((e) => {
        const score = e.priorityScore ?? 0;
        switch (filters.priority) {
          case "critical":
            return score >= 85;
          case "high":
            return score >= 70 && score < 85;
          case "medium":
            return score >= 50 && score < 70;
          case "low":
            return score < 50;
          default:
            return true;
        }
      });
    }

    if (filters.project !== "all") {
      result = result.filter((e) =>
        e.linkedProjects?.some((p) => p.projectId === filters.project)
      );
    }

    return result;
  }, [emails, savedView, filters]);

  const emailsByZone = useMemo(() => {
    const zones: Record<PriorityZone, EmailRecord[]> = {
      critical: [],
      high: [],
      medium: [],
      low: []
    };

    filteredEmails.forEach((email) => {
      const score = email.priorityScore ?? 0;
      if (score >= 85) {
        zones.critical.push(email);
      } else if (score >= 70) {
        zones.high.push(email);
      } else if (score >= 50) {
        zones.medium.push(email);
      } else {
        zones.low.push(email);
      }
    });

    return zones;
  }, [filteredEmails]);

  // ========== Handlers ==========

  const addUpdatingEmail = useCallback((id: string) => {
    setUpdatingEmailIds((prev) => new Set(prev).add(id));
  }, []);

  const removeUpdatingEmail = useCallback((id: string) => {
    setUpdatingEmailIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const updateEmailState = useCallback((updated: EmailRecord) => {
    setEmails((prev) => prev.map((email) => (email.id === updated.id ? updated : email)));
  }, []);

  const performTriageUpdate = useCallback(
    async (emailId: string, updates: Omit<UpdateEmailTriageOptions, "accessToken">, successMessage: string) => {
      if (!accessToken) return;

      addUpdatingEmail(emailId);
      try {
        const updatedEmail = await updateEmailTriage(emailId, { ...updates, accessToken });
        updateEmailState(updatedEmail);
        setStatusMessage({ type: "success", message: successMessage });
        setTimeout(() => setStatusMessage(null), 3000);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setStatusMessage({ type: "error", message: errorMessage });
        setTimeout(() => setStatusMessage(null), 5000);
      } finally {
        removeUpdatingEmail(emailId);
      }
    },
    [accessToken, addUpdatingEmail, removeUpdatingEmail, updateEmailState]
  );

  const handleAcknowledge = useCallback(
    (email: EmailRecord) => {
      void performTriageUpdate(email.id, { triageState: "acknowledged", isRead: true }, "Email acknowledged");
    },
    [performTriageUpdate]
  );

  const handleResolve = useCallback(
    (email: EmailRecord) => {
      void performTriageUpdate(
        email.id,
        { triageState: "resolved", isRead: true, snoozedUntil: null },
        "Email resolved"
      );
    },
    [performTriageUpdate]
  );

  const handleSnooze = useCallback(
    (email: EmailRecord) => {
      // For now, snooze for 24 hours
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      void performTriageUpdate(
        email.id,
        { triageState: "snoozed", snoozedUntil: tomorrow.toISOString(), isRead: false },
        "Email snoozed until tomorrow"
      );
    },
    [performTriageUpdate]
  );

  const handleUnsnooze = useCallback(
    (email: EmailRecord) => {
      void performTriageUpdate(
        email.id,
        { triageState: "unassigned", snoozedUntil: null },
        "Email unsnoozed"
      );
    },
    [performTriageUpdate]
  );

  const handleOpenGmail = useCallback((email: EmailRecord) => {
    const url = `https://mail.google.com/mail/u/0/#inbox/${email.id}`;
    window.open(url, "_blank");
  }, []);

  const handleLinkProject = useCallback((email: EmailRecord) => {
    // TODO: Open project link modal
    console.log("Link to project:", email);
  }, []);

  const handleSelectEmail = useCallback(
    (email: EmailRecord) => {
      setSelectedEmailId(email.id);
      setHighlightedEmailId(email.id);
      const index = filteredEmails.findIndex((e) => e.id === email.id);
      if (index >= 0) {
        setCurrentIndex(index);
      }
    },
    [filteredEmails]
  );

  const handleToggleSelect = useCallback((email: EmailRecord) => {
    setSelectedEmailIds((prev) => {
      const next = new Set(prev);
      if (next.has(email.id)) {
        next.delete(email.id);
      } else {
        next.add(email.id);
      }
      return next;
    });
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({
      scope: "all",
      source: "all",
      label: "all",
      priority: "all",
      project: "all"
    });
  }, []);

  // ========== Keyboard Shortcuts ==========

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case "j": // Next email
          e.preventDefault();
          if (currentIndex < filteredEmails.length - 1) {
            const nextIndex = currentIndex + 1;
            setCurrentIndex(nextIndex);
            handleSelectEmail(filteredEmails[nextIndex]);
          }
          break;

        case "k": // Previous email
          e.preventDefault();
          if (currentIndex > 0) {
            const prevIndex = currentIndex - 1;
            setCurrentIndex(prevIndex);
            handleSelectEmail(filteredEmails[prevIndex]);
          }
          break;

        case "e": // Acknowledge
          e.preventDefault();
          if (selectedEmail) {
            handleAcknowledge(selectedEmail);
          }
          break;

        case "x": // Toggle select
          e.preventDefault();
          if (selectedEmail) {
            handleToggleSelect(selectedEmail);
          }
          break;

        case "r": // Resolve
          e.preventDefault();
          if (selectedEmail) {
            handleResolve(selectedEmail);
          }
          break;

        case "Escape": // Deselect
          e.preventDefault();
          setSelectedEmailId(null);
          setHighlightedEmailId(null);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [currentIndex, filteredEmails, selectedEmail, handleSelectEmail, handleToggleSelect, handleAcknowledge, handleResolve]);

  // ========== Data Fetching ==========

  const loadEmails = useCallback(async () => {
    if (!accessToken) return;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchRecentEmails({
        source: "all",
        label: null,
        page: 1,
        perPage: 200, // Fetch more for better UX
        accessToken
      });

      setEmails(result.items);
      setPagination(result.pagination);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  // Compute stats from emails
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    setStats({
      unread: emails.filter((e) => !e.isRead).length,
      needsAction: emails.filter(
        (e) => e.triageState !== "resolved" && e.triageState !== "acknowledged"
      ).length,
      today: emails.filter((e) => new Date(e.receivedAt) >= today).length
    });
  }, [emails]);

  const loadPriorityConfig = useCallback(async () => {
    if (!accessToken) return;

    setPriorityConfigLoading(true);
    try {
      const result = await fetchPriorityConfig(accessToken);
      if (result.config) {
        setPriorityConfig(result.config);
      }
    } catch (err) {
      console.error("Failed to load priority config:", err);
    } finally {
      setPriorityConfigLoading(false);
    }
  }, [accessToken]);

  // Initial load
  useEffect(() => {
    if (accessToken) {
      void loadEmails();
      void loadPriorityConfig();
    }
  }, [accessToken, loadEmails, loadPriorityConfig]);

  // Poll for updates every 60 seconds
  useEffect(() => {
    if (!accessToken) return;

    const interval = setInterval(() => {
      void loadEmails();
    }, 60000);

    return () => clearInterval(interval);
  }, [accessToken, loadEmails]);

  // ========== Render ==========

  if (loading && emails.length === 0) {
    return (
      <div className="flex h-screen flex-col">
        <div className="flex-1 bg-gray-50">
          <StatsBarSkeleton />
          <EmailTableSkeleton rows={12} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <ErrorState message={error} onRetry={loadEmails} />
      </div>
    );
  }

  const hasEmails = filteredEmails.length > 0;
  const hasActiveFilters = filters.priority !== "all" || filters.source !== "all" || filters.label !== "all" || filters.project !== "all";

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Status Message */}
      {statusMessage && (
        <div
          className={`border-b px-6 py-3 text-sm ${
            statusMessage.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {statusMessage.message}
        </div>
      )}

      {/* Filter Toolbar */}
      <CompactFilterToolbar
        view={savedView}
        onViewChange={setSavedView}
        filters={filters}
        onFiltersChange={(updates) => setFilters((prev) => ({ ...prev, ...updates }))}
        onClearFilters={handleClearFilters}
        stats={stats}
      />

      {/* Stats Bar */}
      <div className="flex items-center gap-6 border-b border-gray-200 bg-white px-6 py-2 text-sm text-gray-600">
        <span>
          <span className="font-semibold text-gray-900">{filteredEmails.length}</span> emails
        </span>
        <span className="text-gray-400">|</span>
        <span>
          <span className="font-semibold text-red-700">{emailsByZone.critical.length}</span> critical
        </span>
        <span>
          <span className="font-semibold text-orange-700">{emailsByZone.high.length}</span> high
        </span>
        <span>
          <span className="font-semibold text-yellow-700">{emailsByZone.medium.length}</span> medium
        </span>
      </div>

      {/* Main Content: Split Panel Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Email List (60%) */}
        <div className="flex-1 overflow-y-auto bg-white">
          {!hasEmails && (
            hasActiveFilters ? (
              <NoResultsState onClearFilters={handleClearFilters} />
            ) : (
              <InboxZeroState />
            )
          )}

          {hasEmails && (
            <>
              <CollapsiblePrioritySection
                zone="critical"
                emails={emailsByZone.critical}
                defaultExpanded={true}
                selectedEmailId={selectedEmailId}
                highlightedEmailId={highlightedEmailId}
                selectedEmailIds={selectedEmailIds}
                onSelectEmail={handleSelectEmail}
                onToggleSelect={handleToggleSelect}
                onAcknowledge={handleAcknowledge}
                onSnooze={handleSnooze}
                onLinkProject={handleLinkProject}
                loading={updatingEmailIds.size > 0}
              />

              <CollapsiblePrioritySection
                zone="high"
                emails={emailsByZone.high}
                defaultExpanded={emailsByZone.high.length > 0}
                selectedEmailId={selectedEmailId}
                highlightedEmailId={highlightedEmailId}
                selectedEmailIds={selectedEmailIds}
                onSelectEmail={handleSelectEmail}
                onToggleSelect={handleToggleSelect}
                onAcknowledge={handleAcknowledge}
                onSnooze={handleSnooze}
                onLinkProject={handleLinkProject}
                loading={updatingEmailIds.size > 0}
              />

              <CollapsiblePrioritySection
                zone="medium"
                emails={emailsByZone.medium}
                defaultExpanded={false}
                selectedEmailId={selectedEmailId}
                highlightedEmailId={highlightedEmailId}
                selectedEmailIds={selectedEmailIds}
                onSelectEmail={handleSelectEmail}
                onToggleSelect={handleToggleSelect}
                onAcknowledge={handleAcknowledge}
                onSnooze={handleSnooze}
                onLinkProject={handleLinkProject}
                loading={updatingEmailIds.size > 0}
              />

              <CollapsiblePrioritySection
                zone="low"
                emails={emailsByZone.low}
                defaultExpanded={false}
                selectedEmailId={selectedEmailId}
                highlightedEmailId={highlightedEmailId}
                selectedEmailIds={selectedEmailIds}
                onSelectEmail={handleSelectEmail}
                onToggleSelect={handleToggleSelect}
                onAcknowledge={handleAcknowledge}
                onSnooze={handleSnooze}
                onLinkProject={handleLinkProject}
                loading={updatingEmailIds.size > 0}
              />
            </>
          )}
        </div>

        {/* Preview Panel (40%) */}
        <PersistentPreviewPanel
          email={selectedEmail}
          onAcknowledge={handleAcknowledge}
          onResolve={handleResolve}
          onSnooze={handleSnooze}
          onUnsnooze={handleUnsnooze}
          onOpenGmail={handleOpenGmail}
          onLinkProject={handleLinkProject}
          loading={selectedEmail ? updatingEmailIds.has(selectedEmail.id) : false}
          priorityConfig={priorityConfig}
          showBreakdown={showBreakdown}
          onToggleBreakdown={() => setShowBreakdown(!showBreakdown)}
        />
      </div>

      {/* Keyboard Shortcuts Help (Bottom Right) */}
      <div className="fixed bottom-4 right-[500px] rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
        <h4 className="mb-2 font-semibold text-gray-900">Keyboard Shortcuts</h4>
        <div className="space-y-1 text-gray-600">
          <div><kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">j</kbd> / <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">k</kbd> Navigate</div>
          <div><kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">e</kbd> Acknowledge</div>
          <div><kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">r</kbd> Resolve</div>
          <div><kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">x</kbd> Select</div>
          <div><kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">Esc</kbd> Deselect</div>
        </div>
      </div>
    </div>
  );
}
