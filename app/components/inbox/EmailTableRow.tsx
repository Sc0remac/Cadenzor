"use client";

import { useMemo } from "react";
import type { EmailRecord } from "@kazador/shared";
import { getVisibleBadges, SmartBadge } from "./SmartBadge";

interface EmailTableRowProps {
  email: EmailRecord;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: () => void;
  onToggleSelect: () => void;
  onAcknowledge: () => void;
  onSnooze: () => void;
  onLinkProject: () => void;
  loading?: boolean;
}

export function EmailTableRow({
  email,
  isSelected,
  isHighlighted,
  onSelect,
  onToggleSelect,
  onAcknowledge,
  onSnooze,
  onLinkProject,
  loading = false
}: EmailTableRowProps) {
  const badges = useMemo(() => getVisibleBadges(email), [email]);
  const priorityDot = getPriorityDot(email.priorityScore ?? 0);
  const relativeTime = formatRelativeTime(email.receivedAt);
  const metadata = extractMetadata(email);

  return (
    <tr
      className={`group border-b border-gray-100 transition-colors ${
        isHighlighted
          ? "bg-indigo-50"
          : isSelected
          ? "bg-gray-50"
          : "hover:bg-gray-50"
      } ${loading ? "opacity-50" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {/* Checkbox */}
      <td className="w-8 px-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          aria-label={`Select email: ${email.subject}`}
        />
      </td>

      {/* Priority Indicator */}
      <td className="w-8">
        <div
          className={`h-2 w-2 rounded-full ${priorityDot.color}`}
          title={`Priority: ${email.priorityScore ?? 0}`}
        />
      </td>

      {/* Main Content */}
      <td className="flex-1 py-3 pr-3">
        <div className="flex items-baseline gap-2">
          <span
            className={`max-w-md truncate text-sm ${
              email.isRead ? "font-normal text-gray-700" : "font-medium text-gray-900"
            }`}
          >
            {email.subject || "(No subject)"}
          </span>
          <span className="shrink-0 text-xs text-gray-500">{relativeTime}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-sm text-gray-600">
            {email.fromName ?? email.fromEmail}
          </span>
          {metadata && (
            <span className="text-xs text-gray-400">{metadata}</span>
          )}
          {badges.map((badge, index) => (
            <SmartBadge key={`${email.id}-badge-${index}`} badge={badge} />
          ))}
        </div>
      </td>

      {/* Quick Actions (visible on hover) */}
      <td
        className="w-40 pr-4 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton
            icon="✓"
            label="Acknowledge"
            onClick={onAcknowledge}
            disabled={loading || email.triageState === "acknowledged"}
            variant="ghost"
          />
          <IconButton
            icon="💤"
            label="Snooze"
            onClick={onSnooze}
            disabled={loading || email.triageState === "snoozed"}
            variant="ghost"
          />
          <IconButton
            icon="🔗"
            label="Link to project"
            onClick={onLinkProject}
            disabled={loading}
            variant="ghost"
          />
        </div>
      </td>
    </tr>
  );
}

interface IconButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "ghost" | "solid";
}

function IconButton({ icon, label, onClick, disabled = false, variant = "ghost" }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center rounded text-xs transition ${
        variant === "ghost"
          ? "hover:bg-gray-200 disabled:opacity-50"
          : "bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
      } disabled:cursor-not-allowed`}
    >
      {icon}
    </button>
  );
}

function getPriorityDot(score: number): { color: string } {
  if (score >= 85) return { color: "bg-red-500" }; // Critical
  if (score >= 70) return { color: "bg-orange-500" }; // High
  if (score >= 50) return { color: "bg-yellow-500" }; // Medium
  return { color: "bg-gray-300" }; // Low
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

function extractMetadata(email: EmailRecord): string | null {
  // Extract key metadata from labels or category
  // For example: venue, city, date, fee
  const labels = email.labels ?? [];

  const venue = labels.find(l => l.startsWith("venue/"))?.replace("venue/", "");
  const city = labels.find(l => l.startsWith("city/"))?.replace("city/", "");
  const date = labels.find(l => l.startsWith("date/"))?.replace("date/", "");

  const parts: string[] = [];
  if (venue) parts.push(venue);
  if (city && !venue) parts.push(city);
  if (date) parts.push(formatShortDate(date));

  return parts.length > 0 ? parts.join(" · ") : null;
}

function formatShortDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
  } catch {
    return dateString;
  }
}
