"use client";

import type { EmailRecord, EmailLabel } from "@kazador/shared";

/**
 * Badge display strategy: Only show the top 2-3 most relevant badges
 * to reduce visual noise. Full details appear in the preview panel.
 */

export interface Badge {
  type: "triage" | "category" | "project" | "priority" | "sentiment" | "snooze";
  value: string;
  variant?: "critical" | "high" | "medium" | "low" | "success" | "warning" | "info" | "neutral";
  color?: string;
}

const HIGH_PRIORITY_CATEGORIES = ["LEGAL", "FINANCE", "BOOKING"];

export function getVisibleBadges(email: EmailRecord): Badge[] {
  const badges: Badge[] = [];

  // 1. Always show triage state if actionable (not "unassigned")
  if (email.triageState && email.triageState !== "unassigned") {
    badges.push({
      type: "triage",
      value: email.triageState,
      variant: email.triageState === "resolved" ? "success" :
               email.triageState === "snoozed" ? "warning" : "info"
    });
  }

  // 2. Show category badge only for high-priority types
  if (email.category && HIGH_PRIORITY_CATEGORIES.some(cat => email.category.startsWith(cat))) {
    badges.push({
      type: "category",
      value: email.category,
      variant: email.category.startsWith("LEGAL") ? "critical" :
               email.category.startsWith("FINANCE") ? "high" : "medium"
    });
  }

  // 3. Show first linked project if present
  if (email.linkedProjects && email.linkedProjects.length > 0) {
    const project = email.linkedProjects[0];
    badges.push({
      type: "project",
      value: project.name,
      color: project.color ?? undefined
    });
  }

  // 4. Show snooze status if active
  if (email.triageState === "snoozed" && email.snoozedUntil) {
    const snoozedDate = new Date(email.snoozedUntil);
    const now = new Date();
    const isActive = snoozedDate > now;

    if (isActive) {
      badges.push({
        type: "snooze",
        value: `Until ${formatShortDate(email.snoozedUntil)}`,
        variant: "warning"
      });
    }
  }

  // Return max 3 badges
  return badges.slice(0, 3);
}

export function SmartBadge({ badge }: { badge: Badge }) {
  const { type, value, variant, color } = badge;

  // Custom color for projects
  if (type === "project" && color) {
    return (
      <span
        className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium"
        style={{
          borderWidth: "1px",
          borderColor: color,
          color: color,
          backgroundColor: `${color}10`
        }}
      >
        {value}
      </span>
    );
  }

  // Variant-based styling
  const variantClasses = {
    critical: "bg-red-50 text-red-700 border-red-200",
    high: "bg-orange-50 text-orange-700 border-orange-200",
    medium: "bg-yellow-50 text-yellow-700 border-yellow-200",
    low: "bg-gray-50 text-gray-600 border-gray-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
    neutral: "bg-gray-50 text-gray-600 border-gray-200"
  };

  const className = variant
    ? `inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${variantClasses[variant]}`
    : "inline-flex items-center rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600";

  return (
    <span className={className}>
      {formatBadgeValue(type, value)}
    </span>
  );
}

function formatBadgeValue(type: string, value: string): string {
  if (type === "triage") {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
  if (type === "category") {
    return value.split("/").pop()?.replace(/_/g, " ") ?? value;
  }
  return value;
}

function formatShortDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;

  return date.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}
