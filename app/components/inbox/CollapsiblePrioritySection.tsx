"use client";

import { useState } from "react";
import type { EmailRecord } from "@kazador/shared";
import { EmailTableRow } from "./EmailTableRow";

export type PriorityZone = "critical" | "high" | "medium" | "low";

interface CollapsiblePrioritySectionProps {
  zone: PriorityZone;
  emails: EmailRecord[];
  defaultExpanded?: boolean;
  selectedEmailId: string | null;
  highlightedEmailId: string | null;
  selectedEmailIds: Set<string>;
  onSelectEmail: (email: EmailRecord) => void;
  onToggleSelect: (email: EmailRecord) => void;
  onAcknowledge: (email: EmailRecord) => void;
  onSnooze: (email: EmailRecord) => void;
  onLinkProject: (email: EmailRecord) => void;
  loading?: boolean;
}

export function CollapsiblePrioritySection({
  zone,
  emails,
  defaultExpanded = true,
  selectedEmailId,
  highlightedEmailId,
  selectedEmailIds,
  onSelectEmail,
  onToggleSelect,
  onAcknowledge,
  onSnooze,
  onLinkProject,
  loading = false
}: CollapsiblePrioritySectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const zoneConfig = getZoneConfig(zone);
  const count = emails.length;

  if (count === 0) {
    return null;
  }

  return (
    <div className="border-b border-gray-200">
      {/* Section Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-6 py-3 text-left transition hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <div
            className={`h-2 w-2 rounded-full ${zoneConfig.dotColor}`}
            aria-hidden="true"
          />
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${zoneConfig.textColor}`}>
            {zoneConfig.label}
          </h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {count}
          </span>
        </div>
        <svg
          className={`h-5 w-5 text-gray-400 transition-transform ${
            isExpanded ? "rotate-90" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      {/* Email Table */}
      {isExpanded && (
        <div className="border-t border-gray-100">
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-8" /> {/* Checkbox */}
              <col className="w-8" /> {/* Priority dot */}
              <col /> {/* Content */}
              <col className="w-40" /> {/* Actions */}
            </colgroup>
            <tbody>
              {emails.map((email) => (
                <EmailTableRow
                  key={email.id}
                  email={email}
                  isSelected={selectedEmailIds.has(email.id)}
                  isHighlighted={email.id === highlightedEmailId}
                  onSelect={() => onSelectEmail(email)}
                  onToggleSelect={() => onToggleSelect(email)}
                  onAcknowledge={() => onAcknowledge(email)}
                  onSnooze={() => onSnooze(email)}
                  onLinkProject={() => onLinkProject(email)}
                  loading={loading && selectedEmailId === email.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function getZoneConfig(zone: PriorityZone) {
  const configs = {
    critical: {
      label: "Critical",
      dotColor: "bg-red-500",
      textColor: "text-red-700",
      bgColor: "bg-red-50"
    },
    high: {
      label: "High",
      dotColor: "bg-orange-500",
      textColor: "text-orange-700",
      bgColor: "bg-orange-50"
    },
    medium: {
      label: "Medium",
      dotColor: "bg-yellow-500",
      textColor: "text-yellow-700",
      bgColor: "bg-yellow-50"
    },
    low: {
      label: "Low",
      dotColor: "bg-gray-400",
      textColor: "text-gray-700",
      bgColor: "bg-gray-50"
    }
  };

  return configs[zone];
}
