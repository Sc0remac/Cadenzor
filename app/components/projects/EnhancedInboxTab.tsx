"use client";

import { useMemo, useState } from "react";
import type { EmailRecord, ProjectEmailLinkRecord, ProjectLinkSource } from "@kazador/shared";

interface EmailLinkWithEmail {
  link: ProjectEmailLinkRecord;
  email: EmailRecord | null;
}

interface EnhancedInboxTabProps {
  emailLinks: EmailLinkWithEmail[];
  onUnlink: (linkId: string) => void;
  onFileAttachments?: (email: EmailRecord) => void;
  canFileAttachments?: boolean;
  projectId: string;
}

type ConfidenceFilter = "all" | "high" | "medium" | "low";
type SourceFilter = "all" | "manual" | "rule" | "ai";
type SortBy = "date" | "confidence" | "sender";

function getConfidenceLevel(score: number | null): "high" | "medium" | "low" {
  if (score == null) return "low";
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function getConfidenceBadgeClass(level: "high" | "medium" | "low"): string {
  switch (level) {
    case "high":
      return "bg-emerald-100 text-emerald-700";
    case "medium":
      return "bg-amber-100 text-amber-700";
    case "low":
      return "bg-gray-100 text-gray-600";
  }
}

function getSourceBadgeClass(source: ProjectLinkSource): string {
  switch (source) {
    case "manual":
      return "bg-blue-100 text-blue-700";
    case "rule":
      return "bg-purple-100 text-purple-700";
    case "ai":
      return "bg-pink-100 text-pink-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "Today " + date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) {
    return "Yesterday " + date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function EnhancedInboxTab({
  emailLinks,
  onUnlink,
  onFileAttachments,
  canFileAttachments = false,
  projectId,
}: EnhancedInboxTabProps) {
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredAndSortedEmails = useMemo(() => {
    // Filter out items with null emails
    let filtered = emailLinks.filter((item) => item.email !== null);

    // Apply confidence filter
    if (confidenceFilter !== "all") {
      filtered = filtered.filter((item) => {
        const level = getConfidenceLevel(item.link.confidence);
        return level === confidenceFilter;
      });
    }

    // Apply source filter
    if (sourceFilter !== "all") {
      filtered = filtered.filter((item) => item.link.source === sourceFilter);
    }

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.email!.subject?.toLowerCase().includes(term) ||
          item.email!.fromName?.toLowerCase().includes(term) ||
          item.email!.fromEmail?.toLowerCase().includes(term) ||
          item.email!.summary?.toLowerCase().includes(term)
      );
    }

    // Sort
    const sorted = [...filtered];
    switch (sortBy) {
      case "date":
        sorted.sort((a, b) => new Date(b.email!.receivedAt).getTime() - new Date(a.email!.receivedAt).getTime());
        break;
      case "confidence":
        sorted.sort((a, b) => (b.link.confidence ?? 0) - (a.link.confidence ?? 0));
        break;
      case "sender":
        sorted.sort((a, b) => {
          const nameA = a.email!.fromName ?? a.email!.fromEmail;
          const nameB = b.email!.fromName ?? b.email!.fromEmail;
          return nameA.localeCompare(nameB);
        });
        break;
    }

    return sorted;
  }, [emailLinks, confidenceFilter, sourceFilter, sortBy, searchTerm]);

  const stats = useMemo(() => {
    const total = emailLinks.length;
    const bySource = {
      manual: emailLinks.filter((item) => item.link.source === "manual").length,
      rule: emailLinks.filter((item) => item.link.source === "rule").length,
      ai: emailLinks.filter((item) => item.link.source === "ai").length,
    };
    const byConfidence = {
      high: emailLinks.filter((item) => getConfidenceLevel(item.link.confidence) === "high").length,
      medium: emailLinks.filter((item) => getConfidenceLevel(item.link.confidence) === "medium").length,
      low: emailLinks.filter((item) => getConfidenceLevel(item.link.confidence) === "low").length,
    };
    return { total, bySource, byConfidence };
  }, [emailLinks]);

  return (
    <div className="space-y-6">
      {/* Stats Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">Total Emails</p>
          <p className="text-2xl font-semibold text-gray-900">{stats.total}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">Rule-based</p>
          <p className="text-2xl font-semibold text-purple-700">{stats.bySource.rule}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-600">High Confidence</p>
          <p className="text-2xl font-semibold text-emerald-700">{stats.byConfidence.high}</p>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label htmlFor="search" className="block text-sm font-medium text-gray-700">
              Search
            </label>
            <input
              id="search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Subject, sender, or content..."
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
          <div>
            <label htmlFor="source-filter" className="block text-sm font-medium text-gray-700">
              Source
            </label>
            <select
              id="source-filter"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            >
              <option value="all">All sources</option>
              <option value="manual">Manual ({stats.bySource.manual})</option>
              <option value="rule">Rule-based ({stats.bySource.rule})</option>
              <option value="ai">AI suggestion ({stats.bySource.ai})</option>
            </select>
          </div>
          <div>
            <label htmlFor="confidence-filter" className="block text-sm font-medium text-gray-700">
              Confidence
            </label>
            <select
              id="confidence-filter"
              value={confidenceFilter}
              onChange={(e) => setConfidenceFilter(e.target.value as ConfidenceFilter)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            >
              <option value="all">All levels</option>
              <option value="high">High ({stats.byConfidence.high})</option>
              <option value="medium">Medium ({stats.byConfidence.medium})</option>
              <option value="low">Low ({stats.byConfidence.low})</option>
            </select>
          </div>
          <div>
            <label htmlFor="sort-by" className="block text-sm font-medium text-gray-700">
              Sort by
            </label>
            <select
              id="sort-by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            >
              <option value="date">Date</option>
              <option value="confidence">Confidence</option>
              <option value="sender">Sender</option>
            </select>
          </div>
        </div>
      </div>

      {/* Email List */}
      {filteredAndSortedEmails.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <p className="text-sm text-gray-600">
            {emailLinks.length === 0
              ? "No emails linked to this project yet."
              : "No emails match your current filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAndSortedEmails.map(({ link, email }) => {
            if (!email) return null;

            const confidenceLevel = getConfidenceLevel(link.confidence);
            const ruleName = link.metadata?.rule_name as string | undefined;
            const ruleNote = link.metadata?.note as string | undefined;
            const confidenceValue = link.confidence != null ? Math.round(link.confidence * 100) : null;

            return (
              <div key={link.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    {/* Header with badges */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getSourceBadgeClass(link.source)}`}>
                        {link.source}
                      </span>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${getConfidenceBadgeClass(confidenceLevel)}`}>
                        {confidenceLevel} {confidenceValue != null ? `(${confidenceValue}%)` : ""}
                      </span>
                      {ruleName && (
                        <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700">
                          Rule: {ruleName}
                        </span>
                      )}
                      {email.category && (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                          {email.category}
                        </span>
                      )}
                      {email.attachmentCount != null && email.attachmentCount > 0 && (
                        <span className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700">
                          📎 {email.attachmentCount}
                        </span>
                      )}
                    </div>

                    {/* Subject and sender */}
                    <div>
                      <h4 className="font-semibold text-gray-900">{email.subject || "(No subject)"}</h4>
                      <p className="mt-1 text-sm text-gray-600">
                        From: <span className="font-medium">{email.fromName ?? email.fromEmail}</span>
                      </p>
                    </div>

                    {/* Summary */}
                    {email.summary && (
                      <p className="text-sm text-gray-600 line-clamp-2">{email.summary}</p>
                    )}

                    {/* Rule note if present */}
                    {ruleNote && (
                      <p className="text-xs italic text-gray-500">
                        Note: {ruleNote}
                      </p>
                    )}

                    {/* Date and metadata */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>{formatDate(email.receivedAt)}</span>
                      {link.createdAt && (
                        <span>Linked: {formatDate(link.createdAt)}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    {canFileAttachments && onFileAttachments && email.attachmentCount && email.attachmentCount > 0 && (
                      <button
                        type="button"
                        onClick={() => onFileAttachments(email)}
                        className="rounded-md border border-blue-300 px-3 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-50"
                      >
                        File attachments
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onUnlink(link.id)}
                      className="rounded-md border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
                    >
                      Unlink
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Results count */}
      {filteredAndSortedEmails.length > 0 && filteredAndSortedEmails.length < emailLinks.length && (
        <p className="text-center text-sm text-gray-600">
          Showing {filteredAndSortedEmails.length} of {emailLinks.length} emails
        </p>
      )}
    </div>
  );
}
