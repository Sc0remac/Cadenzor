"use client";

import { useMemo } from "react";
import type { EmailRecord, PriorityEmailActionRule } from "@kazador/shared";
import type { PriorityConfig } from "@kazador/shared";
import { buildEmailPriorityBreakdown } from "@kazador/shared";

interface PlaybookSuggestion {
  id: string;
  label: string;
  description: string;
}

interface PersistentPreviewPanelProps {
  email: EmailRecord | null;
  onAcknowledge: (email: EmailRecord) => void;
  onResolve: (email: EmailRecord) => void;
  onSnooze: (email: EmailRecord) => void;
  onUnsnooze: (email: EmailRecord) => void;
  onOpenGmail: (email: EmailRecord) => void;
  onLinkProject: (email: EmailRecord) => void;
  onRunPlaybook?: (email: EmailRecord, suggestion: PlaybookSuggestion) => void;
  onActionRule?: (email: EmailRecord, rule: PriorityEmailActionRule) => void;
  loading?: boolean;
  actionRules?: PriorityEmailActionRule[];
  priorityConfig?: PriorityConfig;
  showBreakdown?: boolean;
  onToggleBreakdown?: () => void;
}

export function PersistentPreviewPanel({
  email,
  onAcknowledge,
  onResolve,
  onSnooze,
  onUnsnooze,
  onOpenGmail,
  onLinkProject,
  onRunPlaybook,
  onActionRule,
  loading = false,
  actionRules = [],
  priorityConfig,
  showBreakdown = false,
  onToggleBreakdown
}: PersistentPreviewPanelProps) {
  if (!email) {
    return (
      <div className="flex h-full w-[480px] flex-col items-center justify-center border-l border-gray-200 bg-gray-50">
        <div className="text-center">
          <div className="mb-3 text-4xl">📧</div>
          <p className="text-sm font-medium text-gray-700">No email selected</p>
          <p className="mt-1 text-xs text-gray-500">
            Select an email from the list to preview
          </p>
        </div>
      </div>
    );
  }

  const breakdown = useMemo(() => {
    if (!priorityConfig) return null;
    return buildEmailPriorityBreakdown(
      {
        category: email.category,
        labels: email.labels,
        receivedAt: email.receivedAt,
        isRead: email.isRead,
        triageState: email.triageState,
        snoozedUntil: email.snoozedUntil ?? null,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        subject: email.subject,
        hasAttachments: email.hasAttachments ?? null,
      },
      { config: priorityConfig }
    );
  }, [email, priorityConfig]);

  const attachments = email.attachments ?? [];
  const projects = email.linkedProjects ?? [];
  const snoozeActive = email.snoozedUntil && new Date(email.snoozedUntil) > new Date();

  return (
    <aside className="flex h-full w-[480px] flex-col border-l border-gray-200 bg-white">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-gray-200 px-6 py-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {formatReceivedAt(email.receivedAt)}
            </span>
            <PriorityBadge score={email.priorityScore ?? 0} />
          </div>
          <h3 className="text-base font-semibold text-gray-900">
            {email.subject || "(No subject)"}
          </h3>
          <p className="text-sm text-gray-600">
            From <span className="font-medium">{email.fromName ?? email.fromEmail}</span>
            {email.fromName && (
              <span className="text-gray-400"> · {email.fromEmail}</span>
            )}
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {/* Badges & Metadata */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <TriageStateBadge state={email.triageState} />
            <CategoryBadge category={email.category} />
            <SourceBadge source={email.source} />
            {email.triageState === "snoozed" && email.snoozedUntil && (
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                Snoozed until {formatShortDate(email.snoozedUntil)}
                {!snoozeActive && " (expired)"}
              </span>
            )}
            {email.sentiment && (
              <SentimentBadge sentiment={email.sentiment} />
            )}
          </div>

          {/* Labels */}
          {email.labels && email.labels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs font-medium text-gray-500">Labels:</span>
              {email.labels.map((label) => (
                <span
                  key={`${email.id}-label-${label}`}
                  className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600"
                >
                  {formatLabel(label)}
                </span>
              ))}
            </div>
          )}

          {/* Projects */}
          {projects.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <span className="text-xs font-medium text-gray-500">Projects:</span>
              {projects.map((project) => (
                <span
                  key={`${email.id}-project-${project.projectId}`}
                  className="inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium"
                  style={{
                    borderColor: project.color ?? "#c7d2fe",
                    color: project.color ?? "#4338ca",
                    backgroundColor: `${project.color ?? "#c7d2fe"}10`
                  }}
                >
                  {project.name}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Summary */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Summary
          </h4>
          <p className="text-sm leading-relaxed text-gray-700">
            {email.summary ?? "No summary available for this email."}
          </p>
        </section>

        {/* Attachments */}
        {attachments.length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Attachments ({attachments.length})
            </h4>
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
                >
                  <span className="text-lg">📎</span>
                  <span className="flex-1 truncate font-medium text-gray-700">
                    {attachment.filename}
                  </span>
                  {attachment.size && (
                    <span className="text-xs text-gray-500">
                      {formatFileSize(attachment.size)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Priority Breakdown */}
        {showBreakdown && breakdown && (
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Priority Breakdown
            </h4>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <ul className="space-y-1 text-xs text-gray-700">
                {breakdown.components.map((component, index) => (
                  <li
                    key={`component-${index}`}
                    className="flex items-center justify-between"
                  >
                    <span>{component.label}</span>
                    <span className="font-semibold">
                      {component.value >= 0 ? `+${component.value}` : component.value}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] font-medium text-gray-500">
                Total Score: {breakdown.total}
              </p>
            </div>
          </section>
        )}
      </div>

      {/* Actions Footer */}
      <footer className="flex-shrink-0 border-t border-gray-200 px-6 py-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <ActionButton
              onClick={() => onAcknowledge(email)}
              disabled={loading || email.triageState === "acknowledged"}
              variant="secondary"
            >
              Acknowledge
            </ActionButton>
            {email.triageState === "snoozed" ? (
              <ActionButton
                onClick={() => onUnsnooze(email)}
                disabled={loading}
                variant="warning"
              >
                Unsnooze
              </ActionButton>
            ) : (
              <ActionButton
                onClick={() => onSnooze(email)}
                disabled={loading}
                variant="secondary"
              >
                Snooze
              </ActionButton>
            )}
            <ActionButton
              onClick={() => onResolve(email)}
              disabled={loading || email.triageState === "resolved"}
              variant="success"
            >
              Resolve
            </ActionButton>
          </div>

          {/* Action Rules */}
          {actionRules.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actionRules.map((rule) => (
                <ActionButton
                  key={rule.id}
                  onClick={() => onActionRule?.(email, rule)}
                  disabled={loading}
                  style={
                    rule.color
                      ? {
                          backgroundColor: rule.color,
                          borderColor: rule.color,
                          color: "#ffffff"
                        }
                      : undefined
                  }
                >
                  {rule.label}
                </ActionButton>
              ))}
            </div>
          )}

          {/* Secondary Actions */}
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-2">
            <ActionButton
              onClick={() => onOpenGmail(email)}
              variant="ghost"
              size="sm"
            >
              Open in Gmail
            </ActionButton>
            <ActionButton
              onClick={() => onLinkProject(email)}
              variant="ghost"
              size="sm"
            >
              Link to project
            </ActionButton>
            {onToggleBreakdown && (
              <ActionButton
                onClick={onToggleBreakdown}
                variant="ghost"
                size="sm"
              >
                {showBreakdown ? "Hide" : "Show"} priority breakdown
              </ActionButton>
            )}
          </div>
        </div>
      </footer>
    </aside>
  );
}

// ============ Helper Components ============

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "success" | "warning" | "ghost";
  size?: "sm" | "md";
  style?: React.CSSProperties;
  children: React.ReactNode;
}

function ActionButton({
  onClick,
  disabled = false,
  variant = "secondary",
  size = "md",
  style,
  children
}: ActionButtonProps) {
  const variantClasses = {
    primary: "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700",
    secondary: "bg-white text-gray-700 border-gray-300 hover:bg-gray-50",
    success: "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100",
    warning: "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100",
    ghost: "bg-transparent text-gray-600 border-transparent hover:bg-gray-100"
  };

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-3 py-1.5 text-sm"
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={`inline-flex items-center rounded border font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        style ? "hover:opacity-90" : variantClasses[variant]
      } ${sizeClasses[size]}`}
    >
      {children}
    </button>
  );
}

function PriorityBadge({ score }: { score: number }) {
  let colorClass = "bg-gray-100 text-gray-700";
  let label = "Low";

  if (score >= 85) {
    colorClass = "bg-red-100 text-red-700";
    label = "Critical";
  } else if (score >= 70) {
    colorClass = "bg-orange-100 text-orange-700";
    label = "High";
  } else if (score >= 50) {
    colorClass = "bg-yellow-100 text-yellow-700";
    label = "Medium";
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${colorClass}`}
    >
      {label} {score}
    </span>
  );
}

function TriageStateBadge({ state }: { state?: string }) {
  const stateClasses: Record<string, string> = {
    unassigned: "bg-gray-100 text-gray-700",
    acknowledged: "bg-blue-100 text-blue-700",
    in_progress: "bg-indigo-100 text-indigo-700",
    snoozed: "bg-amber-100 text-amber-700",
    resolved: "bg-emerald-100 text-emerald-700",
    escalated: "bg-red-100 text-red-700"
  };

  const label = state
    ? state.charAt(0).toUpperCase() + state.slice(1).replace("_", " ")
    : "Unassigned";

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
        stateClasses[state ?? "unassigned"] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {label}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const formatted = category.split("/").pop()?.replace(/_/g, " ") ?? category;
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-xs font-medium uppercase tracking-wide text-gray-600">
      {formatted}
    </span>
  );
}

function SourceBadge({ source }: { source?: string }) {
  const sourceLabel: Record<string, string> = {
    gmail: "Gmail",
    seeded: "Seeded",
    manual: "Manual",
    unknown: "Unknown"
  };

  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-xs font-medium uppercase tracking-wide text-gray-600">
      {sourceLabel[source ?? "unknown"] ?? "Unknown"}
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment: { label: string; confidence: number } }) {
  const { label, confidence } = sentiment;
  const emoji = label === "positive" ? "😊" : label === "negative" ? "😟" : "😐";
  const colorClass =
    label === "positive"
      ? "border-green-200 bg-green-50 text-green-700"
      : label === "negative"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-gray-200 bg-gray-50 text-gray-600";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${colorClass}`}
    >
      {emoji} {label}
      {confidence > 0 && (
        <span className="ml-1 text-[10px] opacity-75">
          {Math.round(confidence * 100)}%
        </span>
      )}
    </span>
  );
}

// ============ Helper Functions ============

function formatReceivedAt(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return `Today at ${date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isYesterday) {
    return `Yesterday at ${date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit"
    })}`;
  }

  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatShortDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatLabel(label: string): string {
  return label.split("/").pop()?.replace(/_/g, " ") ?? label;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
