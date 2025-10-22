"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type {
  EmailLabel,
  EmailRecord,
  EmailProjectContext,
  PriorityEmailActionRule,
  ProjectRecord,
  ProjectEmailLinkRecord,
  ProjectAssignmentRuleConfidence,
  TimelineLaneDefinition,
} from "@kazador/shared";
import { useAuth } from "./AuthProvider";
import {
  DEFAULT_EMAIL_LABELS,
  EMAIL_FALLBACK_LABEL,
  DEFAULT_PRIORITY_CONFIG,
  calculateEmailInboxPriority,
  buildEmailPriorityBreakdown,
  clonePriorityConfig,
  type PriorityConfig,
} from "@kazador/shared";
import {
  DEFAULT_EMAILS_PER_PAGE,
  fetchEmailStats,
  fetchRecentEmails,
  fetchProjects,
  linkEmailToProject,
  unlinkEmailFromProject,
  updateEmailTriage,
  type UpdateEmailTriageOptions,
  type ProjectListItem,
} from "../lib/supabaseClient";
import { fetchPriorityConfig } from "../lib/priorityConfigClient";
import { featureFlags } from "../lib/featureFlags";
import type {
  EmailStatsScope,
  EmailSourceFilter,
  EmailListResponse,
  EmailPagination,
} from "../lib/supabaseClient";
import { fetchLaneDefinitions } from "../lib/laneDefinitionsClient";

type StatsState = Record<string, number>;

const POLL_INTERVAL_MS = 60 * 1000;

type StatusMessage = {
  type: "success" | "error";
  message: string;
};

type LabelFilterValue = EmailLabel | "all";

const FILTER_STORAGE_KEYS = {
  scope: "kazador:inbox:scope",
  source: "kazador:inbox:source",
  label: "kazador:inbox:label",
} as const;

const SOURCE_FILTER_OPTIONS: Array<{ value: EmailSourceFilter; label: string; description?: string }> = [
  { value: "all", label: "All sources" },
  { value: "gmail", label: "Gmail" },
  { value: "seeded", label: "Seeded fixtures" },
  { value: "manual", label: "Manual imports" },
  { value: "unknown", label: "Unknown" },
];

const SOURCE_LABEL_MAP: Record<EmailSourceFilter, string> = {
  all: "All sources",
  gmail: "Gmail",
  seeded: "Seeded fixtures",
  manual: "Manual imports",
  unknown: "Unknown",
};

function startCase(label: string): string {
  if (!label) return "";
  if (label === label.toUpperCase()) {
    return label;
  }

  return label
    .replace(/[_\-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

interface EmailCardProps {
  email: EmailRecord;
  zone: PriorityZone;
  onPreview: (email: EmailRecord) => void;
  onAcknowledge: (email: EmailRecord) => void;
  onResolve: (email: EmailRecord) => void;
  onSnooze: (email: EmailRecord) => void;
  onUnsnooze: (email: EmailRecord) => void;
  onRunPlaybook: (email: EmailRecord, suggestion: PlaybookSuggestion) => void;
  onOpenGmail: (email: EmailRecord) => void;
  onLinkProject: (email: EmailRecord) => void;
  loading: boolean;
  actionRules: PriorityEmailActionRule[];
  onActionRule: (email: EmailRecord, rule: PriorityEmailActionRule) => void;
  priorityConfig: PriorityConfig;
  showBreakdown: boolean;
  onToggleBreakdown: (email: EmailRecord) => void;
}

function EmailCard({
  email,
  onPreview,
  onAcknowledge,
  onResolve,
  onSnooze,
  onUnsnooze,
  onRunPlaybook,
  onOpenGmail,
  onLinkProject,
  loading,
  actionRules,
  onActionRule,
  priorityConfig,
  showBreakdown,
  onToggleBreakdown,
}: EmailCardProps) {
  const suggestion = getPlaybookSuggestion(email);
  const snoozeActive = isSnoozeActive(email);
  const attachments = email.attachments ?? [];
  const projects = email.linkedProjects ?? [];
  const snoozeLabel = email.snoozedUntil ? formatRelativeTime(email.snoozedUntil) : null;
  const breakdown = useMemo(
    () =>
      buildEmailPriorityBreakdown(
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
      ),
    [email, priorityConfig]
  );

  return (
    <article className="flex h-full flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:shadow-md">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <PriorityBadge score={email.priorityScore} />
              <span className="text-xs text-gray-500">{formatRelativeTime(email.receivedAt)}</span>
            </div>
            <button
              type="button"
              onClick={() => onPreview(email)}
              className="text-left text-base font-semibold text-gray-900 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {email.subject || "(No subject)"}
            </button>
            <p className="text-xs text-gray-600">
              From {email.fromName ? `${email.fromName} · ${email.fromEmail}` : email.fromEmail}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${triageStateClass(email.triageState)}`}
          >
            {formatTriageState(email.triageState)}
          </span>
          <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-600">
            {formatLabel(email.category)}
          </span>
          <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-600">
            {formatSourceLabel(email.source)}
          </span>
          {email.sentiment && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wide ${
                email.sentiment.label === "positive"
                  ? "border border-green-200 bg-green-50 text-green-700"
                  : email.sentiment.label === "negative"
                  ? "border border-red-200 bg-red-50 text-red-700"
                  : "border border-gray-200 bg-gray-50 text-gray-600"
              }`}
            >
              {email.sentiment.label === "positive" ? "😊" : email.sentiment.label === "negative" ? "😟" : "😐"} {email.sentiment.label}
              {email.sentiment.confidence > 0 && (
                <span className="ml-1 text-[10px] opacity-75">
                  {Math.round(email.sentiment.confidence * 100)}%
                </span>
              )}
            </span>
          )}
          {email.triageState === "snoozed" && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-700">
              Snoozed {snoozeLabel ? `until ${snoozeLabel}` : ""} {snoozeActive ? "" : "(expired)"}
            </span>
          )}
        </div>
        {projects.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {projects.map((project) => (
              <span
                key={`${email.id}-${project.projectId}`}
                className="inline-flex items-center rounded border px-3 py-1 text-xs font-medium"
                style={{ borderColor: project.color ?? "#c7d2fe", color: project.color ?? "#4338ca" }}
              >
                {project.name}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
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
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span className="font-medium text-gray-700">Attachments:</span>
            {attachments.slice(0, 3).map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-2 py-1"
              >
                📎 {attachment.filename}
              </span>
            ))}
            {attachments.length > 3 && <span>+{attachments.length - 3} more</span>}
          </div>
        )}
        <p className="text-sm leading-relaxed text-gray-700">
          {email.summary ? email.summary : "No summary available for this email."}
        </p>
        {suggestion && (
          <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
            <p className="font-semibold">💡 {suggestion.label}</p>
            <p className="mt-1 text-xs text-sky-600">{suggestion.description}</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAcknowledge(email)}
          disabled={loading || email.triageState === "acknowledged"}
          className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Acknowledge
        </button>
        {email.triageState === "snoozed" ? (
          <button
            type="button"
            onClick={() => onUnsnooze(email)}
            disabled={loading}
            className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Unsnooze
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSnooze(email)}
            disabled={loading}
            className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Snooze
          </button>
        )}
        <button
          type="button"
          onClick={() => onResolve(email)}
          disabled={loading || email.triageState === "resolved"}
          className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Resolve
        </button>
        {actionRules.map((rule) => {
          const style = rule.color
            ? {
                backgroundColor: rule.color,
                borderColor: rule.color,
                color: "#ffffff",
              }
            : undefined;
          return (
            <button
              key={rule.id}
              type="button"
              onClick={() => onActionRule(email, rule)}
              disabled={loading}
              style={style}
              className={`inline-flex items-center rounded border px-3 py-1 text-xs font-medium transition ${
                style ? "hover:opacity-90" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {rule.label}
            </button>
          );
        })}
        {suggestion && (
          <button
            type="button"
            onClick={() => onRunPlaybook(email, suggestion)}
            disabled={loading}
            className="inline-flex items-center rounded border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Run playbook
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenGmail(email)}
          className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Open in Gmail
        </button>
        {featureFlags.priorityV3 && (
          <button
            type="button"
            onClick={() => onToggleBreakdown(email)}
            className="inline-flex items-center rounded border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
          >
            {showBreakdown ? "Hide why" : "Why this priority"}
          </button>
        )}
      </div>
      {featureFlags.priorityV3 && showBreakdown && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
          <p className="mb-2 font-semibold text-gray-800">Priority breakdown</p>
          <ul className="space-y-1">
            {breakdown.components.map((component, index) => (
              <li key={`${email.id}-component-${index}`} className="flex items-center justify-between">
                <span>{component.label}</span>
                <span className="font-semibold">{component.value >= 0 ? `+${component.value}` : component.value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-gray-500">Score: {breakdown.total}</p>
        </div>
      )}
    </article>
  );
}

interface EmailPreviewProps {
  email: EmailRecord;
  isOpen: boolean;
  onClose: () => void;
  onAcknowledge: (email: EmailRecord) => void;
  onResolve: (email: EmailRecord) => void;
  onSnooze: (email: EmailRecord) => void;
  onUnsnooze: (email: EmailRecord) => void;
  onRunPlaybook: (email: EmailRecord, suggestion: PlaybookSuggestion) => void;
  onOpenGmail: (email: EmailRecord) => void;
  onLinkProject: (email: EmailRecord) => void;
  loading: boolean;
  actionRules: PriorityEmailActionRule[];
  onActionRule: (email: EmailRecord, rule: PriorityEmailActionRule) => void;
  priorityConfig: PriorityConfig;
}

function EmailPreview({
  email,
  isOpen,
  onClose,
  onAcknowledge,
  onResolve,
  onSnooze,
  onUnsnooze,
  onRunPlaybook,
  onOpenGmail,
  onLinkProject,
  loading,
  actionRules,
  onActionRule,
  priorityConfig,
}: EmailPreviewProps) {
  const suggestion = getPlaybookSuggestion(email);
  const attachments = email.attachments ?? [];
  const projects = email.linkedProjects ?? [];
  const snoozeActive = isSnoozeActive(email);
  const snoozeLabel = email.snoozedUntil ? formatRelativeTime(email.snoozedUntil) : null;
  const [showBreakdown, setShowBreakdown] = useState(false);
  const breakdown = useMemo(
    () =>
      buildEmailPriorityBreakdown(
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
      ),
    [email, priorityConfig]
  );

  useEffect(() => {
    setShowBreakdown(false);
  }, [email.id]);

  return (
    <div
      className={`fixed inset-0 z-40 flex items-stretch justify-end transition-opacity duration-150 ${
        isOpen ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="flex-1 bg-black/30" role="presentation" onClick={onClose} />
      <aside
        className={`relative ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-xl transition-transform duration-200 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div className="max-w-md space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {formatReceivedAt(email.receivedAt)}
            </p>
            <h3 className="text-lg font-semibold text-gray-900">{email.subject || "(No subject)"}</h3>
            <p className="text-sm text-gray-600">
              From {email.fromName ? `${email.fromName} · ${email.fromEmail}` : email.fromEmail}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded border border-gray-200 px-3 py-1 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-100"
          >
            Close
          </button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${triageStateClass(email.triageState)}`}
              >
                {formatTriageState(email.triageState)}
              </span>
              <PriorityBadge score={email.priorityScore} />
              <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-xs font-medium uppercase tracking-wide text-gray-600">
                {formatSourceLabel(email.source)}
              </span>
              <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1 text-xs font-medium uppercase tracking-wide text-gray-600">
                {formatLabel(email.category)}
              </span>
              {email.triageState === "snoozed" && (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  Snoozed {snoozeLabel ? `until ${snoozeLabel}` : ""} {snoozeActive ? "" : "(expired)"}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {email.labels && email.labels.length > 0 ? (
                email.labels.map((label) => (
                  <span
                    key={`${email.id}-preview-${label}`}
                    className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-indigo-600"
                  >
                    {formatLabel(label)}
                  </span>
                ))
              ) : (
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Unlabelled
                </span>
              )}
            </div>
            {projects.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {projects.map((project) => (
                  <span
                    key={`preview-${email.id}-${project.projectId}`}
                    className="inline-flex items-center rounded border px-3 py-1 text-xs font-medium"
                    style={{ borderColor: project.color ?? "#c7d2fe", color: project.color ?? "#4338ca" }}
                  >
                    {project.name}
                  </span>
                ))}
              </div>
            )}
            {attachments.length > 0 && (
              <div className="space-y-2 text-sm text-gray-700">
                <p className="font-semibold text-gray-800">Attachments</p>
                <ul className="space-y-1">
                  {attachments.map((attachment) => (
                    <li key={`preview-attachment-${attachment.id}`} className="flex items-center gap-2">
                      <span>📎</span>
                      <span>{attachment.filename}</span>
                      {attachment.size != null && (
                        <span className="text-xs text-gray-500">
                          {(attachment.size / 1024).toFixed(1)} KB
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {suggestion && (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                <p className="font-semibold">💡 {suggestion.label}</p>
                <p className="mt-1 text-xs text-sky-600">{suggestion.description}</p>
              </div>
            )}
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Summary</h4>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
              {email.summary ?? "No summary available for this email."}
            </p>
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Metadata</h4>
            <dl className="grid grid-cols-1 gap-3 text-sm text-gray-600 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Sender</dt>
                <dd>{email.fromEmail}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Received</dt>
                <dd>{formatReceivedAt(email.receivedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Priority score</dt>
                <dd>{email.priorityScore ?? "N/A"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Triage state</dt>
                <dd>{formatTriageState(email.triageState)}</dd>
              </div>
            </dl>
          </section>
          {featureFlags.priorityV3 && showBreakdown && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-700">Priority breakdown</h4>
              <ul className="space-y-1 text-xs text-gray-700">
                {breakdown.components.map((component, index) => (
                  <li key={`preview-breakdown-${index}`} className="flex items-center justify-between">
                    <span>{component.label}</span>
                    <span className="font-semibold">{component.value >= 0 ? `+${component.value}` : component.value}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-500">Score: {breakdown.total}</p>
            </section>
          )}
        </div>
        <footer className="border-t border-gray-200 px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onAcknowledge(email)}
              disabled={loading || email.triageState === "acknowledged"}
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Acknowledge
            </button>
            {email.triageState === "snoozed" ? (
              <button
                type="button"
                onClick={() => onUnsnooze(email)}
                disabled={loading}
                className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Unsnooze
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSnooze(email)}
                disabled={loading}
                className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Snooze
              </button>
            )}
            <button
              type="button"
              onClick={() => onResolve(email)}
              disabled={loading || email.triageState === "resolved"}
              className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Resolve
            </button>
            {suggestion && (
              <button
                type="button"
                onClick={() => onRunPlaybook(email, suggestion)}
                disabled={loading}
                className="inline-flex items-center rounded border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Run playbook
              </button>
            )}
            {actionRules.map((rule) => {
              const style = rule.color
                ? {
                    backgroundColor: rule.color,
                    borderColor: rule.color,
                    color: "#ffffff",
                  }
                : undefined;
              return (
                <button
                  key={`preview-action-${rule.id}`}
                  type="button"
                  onClick={() => onActionRule(email, rule)}
                  disabled={loading}
                  style={style}
                  className={`inline-flex items-center rounded border px-3 py-1 text-xs font-medium transition ${
                    style ? "hover:opacity-90" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {rule.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => onOpenGmail(email)}
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Open in Gmail
            </button>
            <button
              type="button"
              onClick={() => onLinkProject(email)}
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Assign to project
            </button>
            {featureFlags.priorityV3 && (
              <button
                type="button"
                onClick={() => setShowBreakdown((prev) => !prev)}
                className="inline-flex items-center rounded border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
              >
                {showBreakdown ? "Hide why" : "Why this priority"}
              </button>
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}

interface SnoozeModalProps {
  email: EmailRecord;
  onApply: (email: EmailRecord, isoTimestamp: string) => void;
  onClear: (email: EmailRecord) => void;
  onClose: () => void;
}

function SnoozeModal({ email, onApply, onClear, onClose }: SnoozeModalProps) {
  const [customValue, setCustomValue] = useState(() => {
    if (email.snoozedUntil) {
      const date = new Date(email.snoozedUntil);
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 16);
      }
    }
    return "";
  });

  const presets = buildSnoozePresets();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Snooze email</h3>
            <p className="text-xs text-gray-500">Choose how long to pause this thread.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded border border-gray-200 px-3 py-1 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApply(email, preset.compute())}
              className="w-full rounded border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-700 transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          <label className="text-xs font-medium text-gray-600" htmlFor="custom-snooze">
            Custom snooze
          </label>
          <input
            id="custom-snooze"
            type="datetime-local"
            value={customValue}
            onChange={(event) => setCustomValue(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                if (!customValue) return;
                const iso = new Date(customValue).toISOString();
                onApply(email, iso);
              }}
              className="inline-flex items-center rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow transition hover:bg-indigo-700"
            >
              Apply custom snooze
            </button>
            <button
              type="button"
              onClick={() => onClear(email)}
              className="inline-flex items-center rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Clear snooze
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LinkProjectModalProps {
  email: EmailRecord;
  open: boolean;
  accessToken?: string | null;
  onClose: () => void;
  onLinked: (payload: {
    emailId: string;
    project: ProjectRecord;
    link: ProjectEmailLinkRecord;
    timelineItem: TimelineItemRecord | null;
  }) => void;
  onUnlinked: (payload: { emailId: string; projectId: string; linkId: string }) => void;
}

function LinkProjectModal({ email, open, accessToken, onClose, onLinked, onUnlinked }: LinkProjectModalProps) {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [lanes, setLanes] = useState<TimelineLaneDefinition[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [confidenceLevel, setConfidenceLevel] = useState<ProjectAssignmentRuleConfidence>("high");
  const [note, setNote] = useState<string>("");
  const [createTimelineItem, setCreateTimelineItem] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [projectList, laneDefinitions] = await Promise.all([
          fetchProjects({ accessToken: accessToken ?? undefined }),
          fetchLaneDefinitions(accessToken ?? undefined),
        ]);
        if (!cancelled) {
          setProjects(projectList);
          setLanes(laneDefinitions);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load projects");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    setProjectSearch("");
    setSelectedProjectId("");
    setSelectedLaneId(null);
    setConfidenceLevel("high");
    setNote("");
    setCreateTimelineItem(false);

    return () => {
      cancelled = true;
    };
  }, [open, accessToken]);

  useEffect(() => {
    if (!open) return;
    if (!selectedProjectId && projects.length > 0) {
      const linkedIds = new Set((email.linkedProjects ?? []).map((project) => project.projectId));
      const first = projects.find((item) => !linkedIds.has(item.project.id)) ?? projects[0];
      if (first) {
        setSelectedProjectId(first.project.id);
      }
    }
  }, [open, projects, selectedProjectId, email.linkedProjects]);

  if (!open) {
    return null;
  }

  const projectMatches = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    if (!query) {
      return projects;
    }
    return projects.filter((item) => {
      const name = item.project.name.toLowerCase();
      const description = (item.project.description ?? "").toLowerCase();
      return name.includes(query) || description.includes(query);
    });
  }, [projects, projectSearch]);

  const selectedProject = useMemo(() => {
    return projects.find((item) => item.project.id === selectedProjectId)?.project ?? null;
  }, [projects, selectedProjectId]);

  const existingLinks = email.linkedProjects ?? [];

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProject) {
      setError("Select a project to continue.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await linkEmailToProject(selectedProject.id, email.id, accessToken ?? undefined, {
        laneId: selectedLaneId,
        note: note.trim() || null,
        confidenceLevel,
        createTimelineItem,
      });

      if (response.alreadyLinked) {
        setError("Email is already linked to this project.");
        return;
      }

      onLinked({ emailId: email.id, project: selectedProject, link: response.link, timelineItem: response.timelineItem });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link email");
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async (projectId: string, linkId: string | null) => {
    if (!linkId) return;
    setUnlinkingId(linkId);
    try {
      await unlinkEmailFromProject(projectId, linkId, accessToken ?? undefined);
      onUnlinked({ emailId: email.id, projectId, linkId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlink email");
    } finally {
      setUnlinkingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Link email to project</h3>
              <p className="mt-1 text-sm text-gray-500">Choose a project, optional lane, and add context before linking.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-200 px-3 py-1 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
            >
              Close
            </button>
          </div>

          <div className="flex flex-col gap-6 px-6 py-5">
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <p className="font-semibold text-gray-900">{email.subject || "(No subject)"}</p>
              <p className="mt-1 text-xs text-gray-500">From {email.fromName ? `${email.fromName} · ${email.fromEmail}` : email.fromEmail}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-gray-700">Project</span>
                <input
                  type="search"
                  placeholder="Search projects"
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
                <select
                  value={selectedProjectId}
                  onChange={(event) => setSelectedProjectId(event.target.value)}
                  className="mt-2 h-40 min-h-[10rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  size={6}
                >
                  {projectMatches.length === 0 ? (
                    <option value="" disabled>
                      {loading ? "Loading projects…" : "No projects match"}
                    </option>
                  ) : (
                    projectMatches.map((item) => (
                      <option key={item.project.id} value={item.project.id}>
                        {item.project.name} {item.project.status === "paused" ? "(Paused)" : ""}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium text-gray-700">Lane (optional)</span>
                  <select
                    value={selectedLaneId ?? ""}
                    onChange={(event) => setSelectedLaneId(event.target.value || null)}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  >
                    <option value="">Auto assign</option>
                    {lanes.map((lane) => (
                      <option key={lane.id} value={lane.id}>
                        {lane.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium text-gray-700">Confidence</span>
                  <select
                    value={confidenceLevel}
                    onChange={(event) => setConfidenceLevel(event.target.value as ProjectAssignmentRuleConfidence)}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium text-gray-700">Note (optional)</span>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </label>

                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={createTimelineItem}
                    onChange={(event) => setCreateTimelineItem(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                  />
                  Also create timeline item
                </label>
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            ) : null}

            <div>
              <h4 className="text-sm font-semibold text-gray-800">Existing project links</h4>
              {existingLinks.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">This email is not linked to any projects.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {existingLinks.map((project) => {
                    const noteValue = typeof project.metadata?.note === "string" ? project.metadata.note : null;
                    const ruleName = typeof project.metadata?.rule_name === "string" ? project.metadata.rule_name : null;
                    return (
                      <li key={`${email.id}-${project.projectId}`} className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{project.name}</p>
                          <p className="text-xs text-gray-500">
                            Source: {project.source ? startCase(project.source) : "manual"}
                            {ruleName ? ` • Rule: ${ruleName}` : ""}
                          </p>
                          {noteValue ? <p className="mt-1 text-xs text-gray-600">Note: {noteValue}</p> : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUnlink(project.projectId, project.linkId ?? null)}
                          disabled={unlinkingId === project.linkId}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {unlinkingId === project.linkId ? "Unlinking…" : "Unlink"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedProject}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {loading ? "Linking…" : "Link to project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatLabel(label: EmailLabel): string {
  if (!label) return "Unlabelled";
  const segments = label.split("/");
  if (segments.length === 1) {
    return startCase(segments[0]);
  }

  const [prefix, ...rest] = segments;

  const formatSegment = (segment: string, isPrefix = false) => {
    if (!segment) {
      return "";
    }

    if (!isPrefix && /^\d{4}-\d{2}-\d{2}$/.test(segment)) {
      return segment;
    }

    if (segment === segment.toUpperCase()) {
      return segment;
    }

    return startCase(segment);
  };

  const formatted = [formatSegment(prefix, true), ...rest.map((part) => formatSegment(part))].filter(
    Boolean
  );

  return formatted.join(" / ");
}

function formatReceivedAt(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch (err) {
    console.error("Failed to format date", err);
    return value;
  }
}

function formatLastRefreshed(value: Date | null): string {
  if (!value) {
    return "Never";
  }

  try {
    return value.toLocaleString();
  } catch (err) {
    console.error("Failed to format timestamp", err);
    return value.toISOString();
  }
}

function formatTriageState(value: EmailRecord["triageState"]): string {
  switch (value) {
    case "acknowledged":
      return "Acknowledged";
    case "snoozed":
      return "Snoozed";
    case "resolved":
      return "Resolved";
    default:
      return "Unassigned";
  }
}

function triageStateClass(value: EmailRecord["triageState"]): string {
  switch (value) {
    case "acknowledged":
      return "bg-sky-50 text-sky-700 border border-sky-100";
    case "snoozed":
      return "bg-amber-50 text-amber-700 border border-amber-100";
    case "resolved":
      return "bg-emerald-50 text-emerald-700 border border-emerald-100";
    default:
      return "bg-gray-100 text-gray-700 border border-gray-200";
  }
}

function formatSourceLabel(source: EmailRecord["source"]): string {
  if (!source) {
    return "Unknown";
  }

  const value = source as EmailSourceFilter;
  if (value in SOURCE_LABEL_MAP) {
    return SOURCE_LABEL_MAP[value];
  }

  return source;
}

type PriorityZone = "critical" | "high" | "medium" | "low" | "snoozed" | "resolved";

interface PlaybookSuggestion {
  label: string;
  description: string;
  action: string;
}

const PRIORITY_ZONE_DEFINITIONS: Array<{
  zone: PriorityZone;
  label: string;
  subtitle: string;
}> = [
  { zone: "critical", label: "Critical", subtitle: "Priority 80+ · immediate attention" },
  { zone: "high", label: "High", subtitle: "Priority 60-79 · respond soon" },
  { zone: "medium", label: "Medium", subtitle: "Priority 40-59 · plan follow-up" },
  { zone: "low", label: "Low", subtitle: "Priority < 40 · monitor" },
  { zone: "snoozed", label: "Snoozed", subtitle: "Parked until the snooze expires" },
  { zone: "resolved", label: "Resolved", subtitle: "Archived or completed items" },
];

const PRIORITY_FILTER_OPTIONS: Array<{ value: PriorityZone | "all"; label: string }> = [
  { value: "all", label: "All" },
  ...PRIORITY_ZONE_DEFINITIONS.map((definition) => ({ value: definition.zone, label: definition.label })),
];

function getPriorityZone(email: EmailRecord): PriorityZone {
  if (email.triageState === "resolved") {
    return "resolved";
  }
  if (email.triageState === "snoozed") {
    return "snoozed";
  }

  const score = typeof email.priorityScore === "number" ? email.priorityScore : 0;
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function isSnoozeActive(email: EmailRecord, now = new Date()): boolean {
  if (email.triageState !== "snoozed" || !email.snoozedUntil) {
    return false;
  }
  const until = new Date(email.snoozedUntil);
  return !Number.isNaN(until.getTime()) && until.getTime() > now.getTime();
}

function formatRelativeTime(timestamp: string): string {
  try {
    const target = new Date(timestamp).getTime();
    const diff = target - Date.now();
    const abs = Math.abs(diff);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

    if (abs < minute) {
      return "now";
    }
    if (abs < hour) {
      return formatter.format(Math.round(diff / minute), "minute");
    }
    if (abs < day) {
      return formatter.format(Math.round(diff / hour), "hour");
    }
    return formatter.format(Math.round(diff / day), "day");
  } catch (err) {
    return timestamp;
  }
}

function isActionNeeded(email: EmailRecord, now = new Date()): boolean {
  if (email.triageState === "resolved" || email.triageState === "acknowledged") {
    return false;
  }

  if (email.triageState === "snoozed") {
    return !isSnoozeActive(email, now);
  }

  return true;
}

function getPlaybookSuggestion(email: EmailRecord): PlaybookSuggestion | null {
  const category = email.category?.toUpperCase() ?? "";
  if (category.startsWith("BOOKING/")) {
    return {
      label: "Booking enquiry",
      description: "Prep lead sheet, draft response, and sync availability",
      action: "booking-enquiry",
    };
  }
  if (category.startsWith("LEGAL/")) {
    return {
      label: "Contract review",
      description: "Route to legal checklist and request redlines",
      action: "legal-review",
    };
  }
  if (category.startsWith("FINANCE/")) {
    return {
      label: "Finance follow-up",
      description: "Queue settlement review and update payment tracker",
      action: "finance-follow-up",
    };
  }
  return null;
}

function getActionRulesForEmail(
  email: EmailRecord,
  config: PriorityConfig
): PriorityEmailActionRule[] {
  const rules = config.email.actionRules ?? [];
  const score = email.priorityScore ??
    calculateEmailInboxPriority(
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
      { config }
    );

  return rules.filter((rule) => {
    if (rule.minPriority != null && score < rule.minPriority) {
      return false;
    }
    if (rule.categories && rule.categories.length > 0) {
      const categoryMatch = rule.categories.some((value) => value.toLowerCase() === email.category.toLowerCase());
      if (!categoryMatch) {
        return false;
      }
    }
    if (rule.triageStates && rule.triageStates.length > 0) {
      if (!rule.triageStates.includes((email.triageState ?? "unassigned") as EmailRecord["triageState"])) {
        return false;
      }
    }
    return true;
  });
}

type SnoozeOption = {
  id: string;
  label: string;
  compute: () => string;
};

function buildSnoozePresets(now = new Date()): SnoozeOption[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(18, 0, 0, 0);

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const nextWeek = new Date(now);
  const day = nextWeek.getDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
  nextWeek.setHours(9, 0, 0, 0);

  return [
    {
      id: "later-today",
      label: "Later today (6pm)",
      compute: () => startOfDay.toISOString(),
    },
    {
      id: "tomorrow",
      label: "Tomorrow (9am)",
      compute: () => tomorrow.toISOString(),
    },
    {
      id: "next-week",
      label: "Next week (Mon 9am)",
      compute: () => nextWeek.toISOString(),
    },
  ];
}

function getGmailUrl(emailId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${emailId}`;
}

function PriorityBadge({ score }: { score?: number | null }) {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return null;
  }

  let className = "bg-gray-100 text-gray-600 border border-gray-200";
  if (score >= 80) {
    className = "bg-rose-50 text-rose-700 border border-rose-200";
  } else if (score >= 60) {
    className = "bg-orange-50 text-orange-700 border border-orange-200";
  } else if (score >= 40) {
    className = "bg-amber-50 text-amber-700 border border-amber-200";
  } else if (score > 0) {
    className = "bg-indigo-50 text-indigo-700 border border-indigo-200";
  }

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${className}`}>
      Priority {score}
    </span>
  );
}

export default function EmailDashboard() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [stats, setStats] = useState<StatsState>({});
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [emailPagination, setEmailPagination] = useState<EmailPagination>({
    page: 1,
    perPage: DEFAULT_EMAILS_PER_PAGE,
    total: 0,
    totalPages: 0,
    hasMore: false,
  });
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [statsScope, setStatsScope] = useState<EmailStatsScope>("unread");
  const [sourceFilter, setSourceFilter] = useState<EmailSourceFilter>("all");
  const [labelFilter, setLabelFilter] = useState<LabelFilterValue>("all");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [priorityConfig, setPriorityConfig] = useState<PriorityConfig>(() => clonePriorityConfig(DEFAULT_PRIORITY_CONFIG));
  const [priorityConfigLoading, setPriorityConfigLoading] = useState(true);
  const [priorityConfigError, setPriorityConfigError] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<PriorityZone | "all">("all");
  const [actionFilter, setActionFilter] = useState<"needs-action" | "all" | "snoozed" | "resolved" | "acknowledged">("needs-action");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [updatingEmailIds, setUpdatingEmailIds] = useState<Set<string>>(new Set());
  const [snoozeTarget, setSnoozeTarget] = useState<EmailRecord | null>(null);
  const [projectLinkTarget, setProjectLinkTarget] = useState<EmailRecord | null>(null);
  const [expandedBreakdownIds, setExpandedBreakdownIds] = useState<Set<string>>(new Set());
  const addUpdatingEmail = useCallback((id: string) => {
    setUpdatingEmailIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
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
    setSelectedEmail((prev) => (prev && prev.id === updated.id ? updated : prev));
  }, []);

  const updateEmailProjects = useCallback(
    (emailId: string, transform: (projects: EmailProjectContext[]) => EmailProjectContext[]) => {
      setEmails((prev) =>
        prev.map((email) =>
          email.id === emailId
            ? {
                ...email,
                linkedProjects: transform(email.linkedProjects ?? []),
              }
            : email
        )
      );

      setSelectedEmail((prev) =>
        prev && prev.id === emailId
          ? {
              ...prev,
              linkedProjects: transform(prev.linkedProjects ?? []),
            }
          : prev
      );
    },
    []
  );
  const emailPageRef = useRef<number>(1);
  const filtersHydratedRef = useRef(false);

  useEffect(() => {
    if (!projectLinkTarget) {
      return;
    }
    const refreshed = emails.find((email) => email.id === projectLinkTarget.id);
    if (refreshed && refreshed !== projectLinkTarget) {
      setProjectLinkTarget(refreshed);
    }
  }, [emails, projectLinkTarget]);

  useEffect(() => {
    if (filtersHydratedRef.current || typeof window === "undefined") {
      return;
    }

    const storedScope = window.localStorage.getItem(FILTER_STORAGE_KEYS.scope) as
      | EmailStatsScope
      | null;
    if (storedScope === "all" || storedScope === "unread") {
      setStatsScope(storedScope);
    }

    const storedSource = window.localStorage.getItem(FILTER_STORAGE_KEYS.source) as
      | EmailSourceFilter
      | null;
    if (storedSource && SOURCE_LABEL_MAP[storedSource] != null) {
      setSourceFilter(storedSource);
    }

    const storedLabel = window.localStorage.getItem(FILTER_STORAGE_KEYS.label);
    if (storedLabel && storedLabel !== "all") {
      setLabelFilter(storedLabel as EmailLabel);
    }

    filtersHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!filtersHydratedRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(FILTER_STORAGE_KEYS.scope, statsScope);
  }, [statsScope]);

  useEffect(() => {
    if (!filtersHydratedRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(FILTER_STORAGE_KEYS.source, sourceFilter);
  }, [sourceFilter]);

  useEffect(() => {
    if (!filtersHydratedRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(FILTER_STORAGE_KEYS.label, labelFilter);
  }, [labelFilter]);

  useEffect(() => {
    if (!featureFlags.priorityV3 || !accessToken) {
      setPriorityConfig(clonePriorityConfig(DEFAULT_PRIORITY_CONFIG));
      setPriorityConfigLoading(false);
      setPriorityConfigError(null);
      return;
    }

    let cancelled = false;
    setPriorityConfigLoading(true);
    setPriorityConfigError(null);

    fetchPriorityConfig(accessToken)
      .then((response) => {
        if (cancelled) return;
        setPriorityConfig(clonePriorityConfig(response.config));
        setPriorityConfigError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setPriorityConfig(clonePriorityConfig(DEFAULT_PRIORITY_CONFIG));
        setPriorityConfigError(err instanceof Error ? err.message : "Failed to load priority configuration");
      })
      .finally(() => {
        if (!cancelled) {
          setPriorityConfigLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const applyEmailResponse = useCallback(
    (response: EmailListResponse, requestedPage: number) => {
      setEmails(response.items);

      const pagination = response.pagination;
      const nextPage = pagination.page > 0 ? pagination.page : requestedPage;
      const perPage = pagination.perPage > 0 ? pagination.perPage : DEFAULT_EMAILS_PER_PAGE;
      const total = pagination.total >= 0 ? pagination.total : response.items.length;
      const totalPages = pagination.totalPages >= 0 ? pagination.totalPages : 0;

      emailPageRef.current = nextPage;
      setEmailPagination({
        page: nextPage,
        perPage,
        total,
        totalPages,
        hasMore: Boolean(pagination.hasMore),
      });
    },
    []
  );

  const loadData = useCallback(
    async ({ silent = false, page }: { silent?: boolean; page?: number } = {}) => {
      const targetPage =
        typeof page === "number" && page > 0 ? page : emailPageRef.current || 1;

      if (!accessToken) {
        setError("Authentication required. Please sign in again.");
        setInitialized(true);
        if (!silent) {
          setLoading(false);
        }
        return;
      }

      if (!silent) {
        setLoading(true);
      }

      try {
        const [statsData, emailData] = await Promise.all([
          fetchEmailStats({ accessToken, scope: statsScope, source: sourceFilter }),
          fetchRecentEmails({
            page: targetPage,
            perPage:
              emailPagination.perPage > 0
                ? emailPagination.perPage
                : DEFAULT_EMAILS_PER_PAGE,
            accessToken,
            label: labelFilter !== "all" ? labelFilter : undefined,
            source: sourceFilter,
          }),
        ]);
        setStats(statsData);
        applyEmailResponse(emailData, targetPage);
        setLastRefreshedAt(new Date());
        setError(null);
      } catch (err) {
        console.error("Failed to load dashboard data", err);
        const message =
          err instanceof Error ? err.message : "Failed to load statistics";
        setError(message);
      } finally {
        if (!silent) {
          setLoading(false);
        }
        setInitialized(true);
      }
    },
    [
      accessToken,
      applyEmailResponse,
      emailPagination.perPage,
      statsScope,
      labelFilter,
      sourceFilter,
    ]
  );

  const performTriageUpdate = useCallback(
    async (
      emailId: string,
      updates: Omit<UpdateEmailTriageOptions, "accessToken">,
      successMessage?: string
    ) => {
      if (!accessToken) {
        setStatusMessage({ type: "error", message: "Authentication required. Please sign in again." });
        return;
      }

      addUpdatingEmail(emailId);
      try {
        const updated = await updateEmailTriage(emailId, { ...updates, accessToken });
        updateEmailState(updated);
        if (successMessage) {
          setStatusMessage({ type: "success", message: successMessage });
        }
        await loadData({ silent: true });
      } catch (err) {
        console.error("Failed to update email triage", err);
        const message = err instanceof Error ? err.message : "Failed to update email";
        setStatusMessage({ type: "error", message });
      } finally {
        removeUpdatingEmail(emailId);
      }
    },
    [accessToken, addUpdatingEmail, loadData, removeUpdatingEmail, updateEmailState]
  );

  const handleScopeChange = useCallback((nextScope: EmailStatsScope) => {
    setStatsScope(nextScope);
  }, []);

  const handleSourceChange = useCallback((nextSource: EmailSourceFilter) => {
    emailPageRef.current = 1;
    setSourceFilter(nextSource);
    setLabelFilter("all");
    setEmailPagination((prev) => ({
      ...prev,
      page: 1,
    }));
  }, []);

  const handleLabelFilterChange = useCallback((nextValue: LabelFilterValue) => {
    emailPageRef.current = 1;
    setLabelFilter(nextValue);
    setEmailPagination((prev) => ({
      ...prev,
      page: 1,
    }));
  }, []);

  const handleLabelTileClick = useCallback(
    (label: EmailLabel) => {
      const nextValue: LabelFilterValue = labelFilter === label ? "all" : label;
      handleLabelFilterChange(nextValue);
    },
    [handleLabelFilterChange, labelFilter]
  );

  const handleEmailRowClick = useCallback((email: EmailRecord) => {
    setSelectedEmail(email);
    setIsPreviewOpen(true);
  }, []);

  const handleClosePreview = useCallback(() => {
    setIsPreviewOpen(false);
    setSelectedEmail(null);
  }, []);

  const handleManualRefresh = useCallback(() => {
    void loadData();
  }, [loadData]);

  const handleAcknowledgeEmail = useCallback(
    (email: EmailRecord) => {
      void performTriageUpdate(email.id, { triageState: "acknowledged", isRead: true }, "Email acknowledged");
    },
    [performTriageUpdate]
  );

  const handleResolveEmail = useCallback(
    (email: EmailRecord) => {
      void performTriageUpdate(email.id, { triageState: "resolved", isRead: true, snoozedUntil: null }, "Email resolved");
    },
    [performTriageUpdate]
  );

  const handleUnsnoozeEmail = useCallback(
    (email: EmailRecord) => {
      void performTriageUpdate(
        email.id,
        { triageState: "unassigned", snoozedUntil: null },
        "Email unsnoozed"
      );
    },
    [performTriageUpdate]
  );

  const handleOpenSnoozeModal = useCallback((email: EmailRecord) => {
    setSnoozeTarget(email);
  }, []);

  const handleApplySnooze = useCallback(
    (email: EmailRecord, isoTimestamp: string) => {
      const snoozeUntil = new Date(isoTimestamp);
      const readable = Number.isNaN(snoozeUntil.getTime())
        ? "selected time"
        : snoozeUntil.toLocaleString();
      void performTriageUpdate(
        email.id,
        { triageState: "snoozed", snoozedUntil: isoTimestamp, isRead: false },
        `Email snoozed until ${readable}`
      );
      setSnoozeTarget(null);
    },
    [performTriageUpdate]
  );

  const handleClearSnooze = useCallback(
    (email: EmailRecord) => {
      void performTriageUpdate(
        email.id,
        { triageState: "unassigned", snoozedUntil: null },
        "Snooze cleared"
      );
      setSnoozeTarget(null);
    },
    [performTriageUpdate]
  );

  const handleOpenProjectLinkModal = useCallback((email: EmailRecord) => {
    setProjectLinkTarget(email);
  }, []);

  const handleCloseProjectLinkModal = useCallback(() => {
    setProjectLinkTarget(null);
  }, []);

  const handleProjectLinked = useCallback(
    ({ emailId, project, link, timelineItem: _timelineItem }: { emailId: string; project: ProjectRecord; link: ProjectEmailLinkRecord; timelineItem: TimelineItemRecord | null }) => {
      updateEmailProjects(emailId, (projects) => {
        const nextEntry: EmailProjectContext = {
          projectId: project.id,
          name: project.name,
          status: project.status,
          color: project.color ?? null,
          linkId: link.id,
          source: link.source,
          confidence: link.confidence ?? null,
          metadata: link.metadata ?? null,
          linkedAt: link.createdAt,
        };
        const exists = projects.some((item) => item.projectId === project.id);
        if (exists) {
          return projects.map((item) => (item.projectId === project.id ? nextEntry : item));
        }
        return [...projects, nextEntry];
      });
      setStatusMessage({ type: "success", message: `Email linked to ${project.name}` });
    },
    [updateEmailProjects]
  );

  const handleProjectUnlinked = useCallback(
    ({ emailId, projectId }: { emailId: string; projectId: string }) => {
      const emailRecord = emails.find((item) => item.id === emailId);
      const projectName =
        emailRecord?.linkedProjects?.find((item) => item.projectId === projectId)?.name ?? "project";
      updateEmailProjects(emailId, (projects) => projects.filter((item) => item.projectId !== projectId));
      setStatusMessage({ type: "success", message: `Email unlinked from ${projectName}` });
    },
    [emails, updateEmailProjects]
  );

  const handleRunPlaybook = useCallback((email: EmailRecord, suggestion: PlaybookSuggestion) => {
    setStatusMessage({
      type: "success",
      message: `Playbook “${suggestion.label}” queued for “${email.subject || "Untitled email"}”.`,
    });
  }, []);

  const handleOpenGmail = useCallback((email: EmailRecord) => {
    window.open(getGmailUrl(email.id), "_blank", "noopener");
  }, []);

  const handleActionRule = useCallback(
    (email: EmailRecord, rule: PriorityEmailActionRule) => {
      switch (rule.actionType) {
        case "playbook": {
          const suggestion: PlaybookSuggestion = {
            label: rule.label,
            description: rule.description ?? "",
            action: String((rule.payload as any)?.playbook ?? rule.id),
          };
          handleRunPlaybook(email, suggestion);
          break;
        }
        case "open_url": {
          const url = typeof (rule.payload as any)?.url === "string" ? String((rule.payload as any).url) : null;
          if (url) {
            window.open(url, "_blank", "noopener");
            setStatusMessage({ type: "success", message: `${rule.label} opened in a new tab.` });
          } else {
            setStatusMessage({ type: "error", message: "No URL configured for this action." });
          }
          break;
        }
        case "create_lead": {
          setStatusMessage({
            type: "success",
            message: `Lead created for ${email.subject || email.fromEmail}.`,
          });
          break;
        }
        case "custom":
        default: {
          setStatusMessage({ type: "success", message: `${rule.label} triggered.` });
          break;
        }
      }
    },
    [handleRunPlaybook]
  );

  const handleToggleBreakdown = useCallback((email: EmailRecord) => {
    setExpandedBreakdownIds((prev) => {
      const next = new Set(prev);
      if (next.has(email.id)) {
        next.delete(email.id);
      } else {
        next.add(email.id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    loadData();
    const interval = setInterval(() => {
      loadData({ silent: true }).catch((err) => console.error("Refresh failed", err));
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [accessToken, loadData]);

  useEffect(() => {
    if (!selectedEmail) {
      return;
    }

    const updated = emails.find((email) => email.id === selectedEmail.id) ?? null;
    if (!updated) {
      setSelectedEmail(null);
      setIsPreviewOpen(false);
      return;
    }

    if (updated !== selectedEmail) {
      setSelectedEmail(updated);
    }
  }, [emails, selectedEmail]);

  useEffect(() => {
    if (!isPreviewOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClosePreview();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [handleClosePreview, isPreviewOpen]);

  const handleClassifyClick = async () => {
    setStatusMessage(null);
    setClassifying(true);

    if (!accessToken) {
      setStatusMessage({ type: "error", message: "Authentication required. Please sign in again." });
      setClassifying(false);
      return;
    }

    try {
      const response = await fetch("/api/classify-emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
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

  const handlePageChange = useCallback(
    (nextPage: number) => {
      const safePage = Math.max(Math.floor(nextPage), 1);
      const currentPage = emailPageRef.current || 1;

      if (safePage === currentPage) {
        return;
      }

      if (emailPagination.totalPages > 0 && safePage > emailPagination.totalPages) {
        return;
      }

      if (
        emailPagination.totalPages === 0 &&
        !emailPagination.hasMore &&
        safePage > 1
      ) {
        return;
      }

      void loadData({ page: safePage });
    },
    [emailPagination.hasMore, emailPagination.totalPages, loadData]
  );

  const handleNextPage = useCallback(() => {
    handlePageChange((emailPageRef.current || 1) + 1);
  }, [handlePageChange]);

  const handlePreviousPage = useCallback(() => {
    handlePageChange((emailPageRef.current || 1) - 1);
  }, [handlePageChange]);

  const labelStatsEntries = useMemo(() => {
    const defaultOrder = new Map<string, number>();
    DEFAULT_EMAIL_LABELS.forEach((label, index) => {
      defaultOrder.set(label, index);
    });

    const aggregated = new Map<string, number>();

    DEFAULT_EMAIL_LABELS.forEach((label) => {
      const count = stats[label];
      aggregated.set(
        label,
        typeof count === "number" && Number.isFinite(count) ? count : 0
      );
    });

    Object.entries(stats).forEach(([label, value]) => {
      if (!label) {
        return;
      }
      const count = typeof value === "number" && Number.isFinite(value) ? value : 0;
      aggregated.set(label, count);
    });

    return Array.from(aggregated.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        const aRank = defaultOrder.has(a.label)
          ? defaultOrder.get(a.label) ?? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER;
        const bRank = defaultOrder.has(b.label)
          ? defaultOrder.get(b.label) ?? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) {
          return aRank - bRank;
        }
        return a.label.localeCompare(b.label);
      });
  }, [stats]);

  const topLabelEntries = labelStatsEntries.slice(0, 3);
  const otherLabelEntries = labelStatsEntries.slice(3);

  const labelFilterOptions = useMemo(() => {
    const values: LabelFilterValue[] = ["all"];
    labelStatsEntries.forEach(({ label }) => {
      if (label) {
        values.push(label as EmailLabel);
      }
    });
    return values;
  }, [labelStatsEntries]);

  const effectivePriorityConfig = useMemo(() => priorityConfig ?? DEFAULT_PRIORITY_CONFIG, [priorityConfig]);

  const projectOptions = useMemo(() => {
    const entries = new Map<string, string>();
    emails.forEach((email) => {
      email.linkedProjects?.forEach((project) => {
        if (project.projectId && !entries.has(project.projectId)) {
          entries.set(project.projectId, project.name);
        }
      });
    });
    return [
      { value: "all", label: "All projects" },
      ...Array.from(entries.entries()).map(([value, label]) => ({ value, label })),
    ];
  }, [emails]);

  const filteredEmails = useMemo(() => {
    const now = new Date();
    return emails.filter((email) => {
      if (priorityFilter !== "all" && getPriorityZone(email) !== priorityFilter) {
        return false;
      }

      switch (actionFilter) {
        case "needs-action":
          if (!isActionNeeded(email, now)) {
            return false;
          }
          break;
        case "snoozed":
          if (email.triageState !== "snoozed") {
            return false;
          }
          break;
        case "resolved":
          if (email.triageState !== "resolved") {
            return false;
          }
          break;
        case "acknowledged":
          if (email.triageState !== "acknowledged") {
            return false;
          }
          break;
        default:
          break;
      }

      if (projectFilter !== "all") {
        const matchesProject = email.linkedProjects?.some(
          (project) => project.projectId === projectFilter
        );
        if (!matchesProject) {
          return false;
        }
      }

      return true;
    });
  }, [emails, priorityFilter, actionFilter, projectFilter]);

  const groupedEmails = useMemo(() => {
    const groups = PRIORITY_ZONE_DEFINITIONS.map((definition) => ({
      ...definition,
      emails: [] as EmailRecord[],
    }));
    const lookup = new Map(groups.map((group) => [group.zone, group]));

    filteredEmails.forEach((email) => {
      const zone = getPriorityZone(email);
      const bucket = lookup.get(zone);
      if (bucket) {
        bucket.emails.push(email);
      }
    });

    groups.forEach((group) => {
      group.emails.sort((a, b) => {
        const scoreDiff = (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
      });
    });

    return groups;
  }, [filteredEmails]);

  const hasLabelFilter = labelFilter !== "all";
  const activeScopeLabel = statsScope === "unread" ? "Unread only" : "All emails";
  const activeLabelFilterLabel = hasLabelFilter ? formatLabel(labelFilter as EmailLabel) : "All labels";
  const activeSourceLabel = SOURCE_LABEL_MAP[sourceFilter] ?? SOURCE_LABEL_MAP.all;
  const filterSummary = `${activeScopeLabel} · ${activeLabelFilterLabel} · ${activeSourceLabel}`;
  const lastRefreshedLabel = formatLastRefreshed(lastRefreshedAt);

  const currentPage = emailPagination.page > 0 ? emailPagination.page : 1;
  const perPage = emailPagination.perPage > 0 ? emailPagination.perPage : DEFAULT_EMAILS_PER_PAGE;
  const totalEmails = emailPagination.total >= 0 ? emailPagination.total : emails.length;
  const totalPages = emailPagination.totalPages >= 0 ? emailPagination.totalPages : 0;
  const displayTotalPages =
    totalPages > 0 ? totalPages : totalEmails > 0 ? Math.ceil(totalEmails / perPage) : 1;
  const disablePrevious = loading || currentPage <= 1;
  const disableNext = loading || (totalPages > 0 ? currentPage >= totalPages : !emailPagination.hasMore);

  const fallbackCount = stats[EMAIL_FALLBACK_LABEL] ?? 0;
  const uncategorisedBannerVisible = fallbackCount > 0 && (labelFilter === "all" || labelFilter === EMAIL_FALLBACK_LABEL);
  const highlightedTopLabel = topLabelEntries.find((entry) => entry.label !== EMAIL_FALLBACK_LABEL);
  const scopeCardTitle = statsScope === "unread" ? "Unread emails" : "Email volume";
  const scopeCardSubtitle = sourceFilter === "all" ? "Across all sources" : SOURCE_LABEL_MAP[sourceFilter];
  const topCategoryLabel = highlightedTopLabel ? formatLabel(highlightedTopLabel.label as EmailLabel) : "No leading category";
  const topCategoryCount = highlightedTopLabel?.count ?? 0;

  const activePriorityLabel =
    priorityFilter === "all"
      ? "All priorities"
      : PRIORITY_ZONE_DEFINITIONS.find((def) => def.zone === priorityFilter)?.label ?? "All priorities";

  const actionFilterLabelMap: Record<typeof actionFilter, string> = {
    "needs-action": "Needs action",
    all: "All triage states",
    snoozed: "Snoozed",
    resolved: "Resolved",
    acknowledged: "Acknowledged",
  };

  const actionFilterOptions: Array<{ value: typeof actionFilter; label: string }> = [
    { value: "needs-action", label: "Needs action" },
    { value: "all", label: "All states" },
    { value: "snoozed", label: "Snoozed" },
    { value: "acknowledged", label: "Acknowledged" },
    { value: "resolved", label: "Resolved" },
  ];

  const activeProjectLabel =
    projectFilter === "all"
      ? "All projects"
      : projectOptions.find((option) => option.value === projectFilter)?.label ?? "All projects";

  const cardsSummary = useMemo(() => {
    const sourceSuffix = sourceFilter !== "all" ? ` (${SOURCE_LABEL_MAP[sourceFilter].toLowerCase()})` : "";
    if (totalEmails === 0) {
      return `Showing 0 emails${sourceSuffix}`;
    }
    if (filteredEmails.length === 0) {
      return `No emails match the current filters${sourceSuffix}`;
    }
    if (filteredEmails.length === totalEmails) {
      return `Showing ${filteredEmails.length} ${filteredEmails.length === 1 ? "email" : "emails"}${sourceSuffix}`;
    }
    return `Showing ${filteredEmails.length} of ${totalEmails} emails${sourceSuffix}`;
  }, [filteredEmails.length, sourceFilter, totalEmails]);

  const hasAnyGroupedEmails = groupedEmails.some((group) => group.emails.length > 0);

  const selectedEmailPriority = selectedEmail ? priorityBadge(selectedEmail.priorityScore) : null;

  if (!initialized && loading) {
    return <p>Loading email statistics…</p>;
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold">
              Inbox command center
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({filterSummary})
              </span>
            </h2>
            <span className="text-xs text-gray-500">Last refreshed: {lastRefreshedLabel}</span>
          </div>
          <div className="flex items-center gap-3">
            {initialized && loading && <span className="text-xs text-gray-500">Refreshing…</span>}
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={loading}
              className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh
            </button>
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
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Scope:</span>
            <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 text-sm shadow-sm">
              {(["unread", "all"] as EmailStatsScope[]).map((scopeOption) => {
                const isActive = statsScope === scopeOption;
                return (
                  <button
                    key={scopeOption}
                    type="button"
                    onClick={() => handleScopeChange(scopeOption)}
                    aria-pressed={isActive}
                    className={`rounded px-3 py-1 font-medium transition ${
                      isActive
                        ? "bg-indigo-600 text-white shadow"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {scopeOption === "unread" ? "Unread" : "All"}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Source:</span>
            <div className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white p-1 text-sm shadow-sm">
              {SOURCE_FILTER_OPTIONS.map((option) => {
                const isActive = sourceFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSourceChange(option.value)}
                    aria-pressed={isActive}
                    className={`rounded px-3 py-1 font-medium transition ${
                      isActive
                        ? "bg-indigo-600 text-white shadow"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                    title={option.description}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Label:</span>
            <select
              value={labelFilter}
              onChange={(event) => handleLabelFilterChange(event.target.value as LabelFilterValue)}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {labelFilterOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All labels" : formatLabel(option as EmailLabel)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Priority:</span>
            <div className="flex flex-wrap gap-1">
              {PRIORITY_FILTER_OPTIONS.map((option) => {
                const isActive = priorityFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                      isActive ? "bg-indigo-600 text-white shadow" : "text-gray-600 hover:bg-gray-100"
                    }`}
                    onClick={() => setPriorityFilter(option.value)}
                    aria-pressed={isActive}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Status:</span>
            <select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value as typeof actionFilter)}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {actionFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Project:</span>
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {projectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span>Priority: {activePriorityLabel}</span>
          <span>Action: {actionFilterLabelMap[actionFilter]}</span>
          <span>Project: {activeProjectLabel}</span>
          <span>{cardsSummary}</span>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {featureFlags.priorityV3 && priorityConfigError && (
        <p className="text-sm text-amber-600">{priorityConfigError}</p>
      )}

      {statusMessage && (
        <p
          className={`text-sm ${
            statusMessage.type === "error" ? "text-red-600" : "text-green-600"
          }`}
        >
          {statusMessage.message}
        </p>
      )}

      {uncategorisedBannerVisible && (
        <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow">
          <span className="font-semibold">{fallbackCount.toLocaleString()} </span>
          {fallbackCount === 1 ? "email" : "emails"} are still uncategorised. Use manual tagging or refine your
          automations to train the classifier.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{scopeCardTitle}</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{totalEmails.toLocaleString()}</p>
          <p className="mt-1 text-xs text-gray-500">{scopeCardSubtitle}</p>
        </div>
        <div
          className={`rounded-lg border p-4 shadow-sm ${
            fallbackCount > 0 ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"
          }`}
        >
          <p className="text-sm font-medium text-gray-500">Needs tagging</p>
          <p className={`mt-2 text-3xl font-semibold ${fallbackCount > 0 ? "text-amber-700" : "text-gray-900"}`}>
            {fallbackCount.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {fallbackCount > 0
              ? "Review these to improve future classifications."
              : "All recent emails have a primary label."}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Top category</p>
          <p className="mt-2 text-lg font-semibold text-gray-900">{topCategoryLabel}</p>
          <p className="mt-1 text-xs text-gray-500">
            {topCategoryCount > 0
              ? `${topCategoryCount.toLocaleString()} entr${topCategoryCount === 1 ? "y" : "ies"} this cycle.`
              : "No dominant category yet."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {topLabelEntries.length === 0 ? (
          <div className="col-span-full rounded border border-dashed border-gray-200 bg-white p-6 text-center shadow">
            <p className="text-sm text-gray-500">No label activity yet.</p>
          </div>
        ) : (
          topLabelEntries.map(({ label, count }, index) => {
            const isActive = labelFilter === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => handleLabelTileClick(label as EmailLabel)}
                className={`flex flex-col items-start rounded-lg border p-4 text-left shadow-sm transition ${
                  isActive ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-white hover:border-indigo-200"
                }`}
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                  Top #{index + 1}
                </span>
                <span className="mt-1 text-base font-medium text-gray-900">{formatLabel(label as EmailLabel)}</span>
                <span className="mt-1 text-xs text-gray-500">{count.toLocaleString()} emails</span>
              </button>
            );
          })
        )}
      </div>

      {otherLabelEntries.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700">Other active labels</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {otherLabelEntries.map(({ label, count }) => (
              <button
                key={label}
                type="button"
                onClick={() => handleLabelTileClick(label as EmailLabel)}
                className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide transition ${
                  labelFilter === label
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {formatLabel(label as EmailLabel)}
                <span className="ml-1 text-[11px] font-normal">({count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {groupedEmails.map((group) => (
          group.emails.length === 0 ? null : (
            <section key={group.zone} className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {group.label}
                    <span className="ml-2 text-sm font-normal text-gray-500">({group.emails.length})</span>
                  </h3>
                  <p className="text-xs text-gray-500">{group.subtitle}</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.emails.map((email) => (
                  <EmailCard
                    key={email.id}
                    email={email}
                    zone={group.zone}
                    onPreview={handleEmailRowClick}
                    onAcknowledge={handleAcknowledgeEmail}
                    onResolve={handleResolveEmail}
                    onSnooze={handleOpenSnoozeModal}
                    onUnsnooze={handleUnsnoozeEmail}
                    onRunPlaybook={handleRunPlaybook}
                    onOpenGmail={handleOpenGmail}
                    onLinkProject={handleOpenProjectLinkModal}
                    loading={updatingEmailIds.has(email.id)}
                    actionRules={featureFlags.priorityV3 ? getActionRulesForEmail(email, effectivePriorityConfig) : []}
                    onActionRule={handleActionRule}
                    priorityConfig={effectivePriorityConfig}
                    showBreakdown={featureFlags.priorityV3 && expandedBreakdownIds.has(email.id)}
                    onToggleBreakdown={handleToggleBreakdown}
                  />
                ))}
              </div>
            </section>
          )
        ))}
        {!hasAnyGroupedEmails && (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            No emails match the current filters. Adjust priority, action, or project filters to broaden your view.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-gray-500">
          Page {currentPage} of {displayTotalPages}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePreviousPage}
            disabled={disablePrevious}
            className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={handleNextPage}
            disabled={disableNext}
            className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {selectedEmail && (
        <EmailPreview
          email={selectedEmail}
          isOpen={isPreviewOpen}
          onClose={handleClosePreview}
          onAcknowledge={handleAcknowledgeEmail}
          onResolve={handleResolveEmail}
          onSnooze={handleOpenSnoozeModal}
          onUnsnooze={handleUnsnoozeEmail}
          onRunPlaybook={handleRunPlaybook}
          onOpenGmail={handleOpenGmail}
          onLinkProject={handleOpenProjectLinkModal}
          loading={updatingEmailIds.has(selectedEmail.id)}
          actionRules={featureFlags.priorityV3 ? getActionRulesForEmail(selectedEmail, effectivePriorityConfig) : []}
          onActionRule={handleActionRule}
          priorityConfig={effectivePriorityConfig}
        />
      )}

      {snoozeTarget && (
        <SnoozeModal
          email={snoozeTarget}
          onApply={handleApplySnooze}
          onClear={handleClearSnooze}
          onClose={() => setSnoozeTarget(null)}
        />
      )}
      {projectLinkTarget && (
        <LinkProjectModal
          email={projectLinkTarget}
          open={Boolean(projectLinkTarget)}
          accessToken={accessToken}
          onClose={handleCloseProjectLinkModal}
          onLinked={handleProjectLinked}
          onUnlinked={handleProjectUnlinked}
        />
      )}
    </div>
  );
}
