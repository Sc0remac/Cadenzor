"use client";

import { useState } from "react";
import type { EmailLabel } from "@kazador/shared";

export type SavedView = "inbox" | "needs-action" | "today" | "unread" | "all";

export interface FilterState {
  scope: "all" | "unread" | "snoozed" | "resolved";
  source: "all" | "gmail" | "seeded" | "manual" | "unknown";
  label: EmailLabel | "all";
  priority: "all" | "critical" | "high" | "medium" | "low";
  project: string | "all";
}

interface CompactFilterToolbarProps {
  view: SavedView;
  onViewChange: (view: SavedView) => void;
  filters: FilterState;
  onFiltersChange: (filters: Partial<FilterState>) => void;
  onClearFilters: () => void;
  stats: {
    unread: number;
    needsAction: number;
    today: number;
  };
}

export function CompactFilterToolbar({
  view,
  onViewChange,
  filters,
  onFiltersChange,
  onClearFilters,
  stats
}: CompactFilterToolbarProps) {
  const [showFilterPopover, setShowFilterPopover] = useState(false);

  const activeFilterCount = countActiveFilters(filters);
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      {/* Saved Views */}
      <div className="flex items-center gap-3">
        <ViewTab
          active={view === "inbox"}
          onClick={() => onViewChange("inbox")}
        >
          Inbox
        </ViewTab>
        <ViewTab
          active={view === "needs-action"}
          onClick={() => onViewChange("needs-action")}
          badge={stats.needsAction}
        >
          Needs Action
        </ViewTab>
        <ViewTab
          active={view === "today"}
          onClick={() => onViewChange("today")}
          badge={stats.today}
        >
          Today
        </ViewTab>
        <ViewTab
          active={view === "unread"}
          onClick={() => onViewChange("unread")}
          badge={stats.unread}
        >
          Unread
        </ViewTab>
        <ViewTab
          active={view === "all"}
          onClick={() => onViewChange("all")}
        >
          All
        </ViewTab>

        {/* Active Filters as Removable Pills */}
        {hasActiveFilters && (
          <div className="ml-4 flex items-center gap-2">
            {filters.priority !== "all" && (
              <FilterPill
                onRemove={() => onFiltersChange({ priority: "all" })}
              >
                Priority: {filters.priority}
              </FilterPill>
            )}
            {filters.source !== "all" && (
              <FilterPill
                onRemove={() => onFiltersChange({ source: "all" })}
              >
                Source: {filters.source}
              </FilterPill>
            )}
            {filters.label !== "all" && (
              <FilterPill
                onRemove={() => onFiltersChange({ label: "all" })}
              >
                Label: {formatLabel(filters.label)}
              </FilterPill>
            )}
            {filters.project !== "all" && (
              <FilterPill
                onRemove={() => onFiltersChange({ project: "all" })}
              >
                Project: {filters.project}
              </FilterPill>
            )}
          </div>
        )}
      </div>

      {/* Filter Controls */}
      <div className="flex items-center gap-2">
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear all
          </button>
        )}

        {/* Filter Popover Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowFilterPopover(!showFilterPopover)}
            className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-medium transition ${
              hasActiveFilters
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Popover */}
          {showFilterPopover && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowFilterPopover(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
                <div className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Filter emails
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowFilterPopover(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-4">
                    {/* Scope Filter */}
                    <FilterGroup label="Scope">
                      <select
                        value={filters.scope}
                        onChange={(e) =>
                          onFiltersChange({
                            scope: e.target.value as FilterState["scope"]
                          })
                        }
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="all">All emails</option>
                        <option value="unread">Unread only</option>
                        <option value="snoozed">Snoozed</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </FilterGroup>

                    {/* Priority Filter */}
                    <FilterGroup label="Priority">
                      <select
                        value={filters.priority}
                        onChange={(e) =>
                          onFiltersChange({
                            priority: e.target.value as FilterState["priority"]
                          })
                        }
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="all">All priorities</option>
                        <option value="critical">Critical (85+)</option>
                        <option value="high">High (70-84)</option>
                        <option value="medium">Medium (50-69)</option>
                        <option value="low">Low (&lt;50)</option>
                      </select>
                    </FilterGroup>

                    {/* Source Filter */}
                    <FilterGroup label="Source">
                      <select
                        value={filters.source}
                        onChange={(e) =>
                          onFiltersChange({
                            source: e.target.value as FilterState["source"]
                          })
                        }
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="all">All sources</option>
                        <option value="gmail">Gmail</option>
                        <option value="seeded">Seeded fixtures</option>
                        <option value="manual">Manual imports</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </FilterGroup>

                    {/* Category/Label Filter */}
                    <FilterGroup label="Category">
                      <select
                        value={filters.label}
                        onChange={(e) =>
                          onFiltersChange({
                            label: e.target.value as EmailLabel | "all"
                          })
                        }
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="all">All categories</option>
                        <optgroup label="Legal">
                          <option value="LEGAL/Contract_Draft">Contract Draft</option>
                          <option value="LEGAL/Contract_Executed">Contract Executed</option>
                          <option value="LEGAL/NDA_or_Clearance">NDA / Clearance</option>
                        </optgroup>
                        <optgroup label="Finance">
                          <option value="FINANCE/Settlement">Settlement</option>
                          <option value="FINANCE/Invoice">Invoice</option>
                          <option value="FINANCE/Payment_Remittance">Payment</option>
                        </optgroup>
                        <optgroup label="Booking">
                          <option value="BOOKING/Offer">Offer</option>
                          <option value="BOOKING/Confirmation">Confirmation</option>
                          <option value="BOOKING/Hold_or_Availability">Hold / Availability</option>
                        </optgroup>
                        <optgroup label="Promo">
                          <option value="PROMO/Promo_Time_Request">Promo Time Request</option>
                          <option value="PROMO/Press_Feature">Press Feature</option>
                          <option value="PROMO/Radio_Playlist">Radio / Playlist</option>
                        </optgroup>
                        <optgroup label="Logistics">
                          <option value="LOGISTICS/Travel">Travel</option>
                          <option value="LOGISTICS/Accommodation">Accommodation</option>
                          <option value="LOGISTICS/Itinerary_DaySheet">Itinerary</option>
                        </optgroup>
                      </select>
                    </FilterGroup>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        onClearFilters();
                        setShowFilterPopover(false);
                      }}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      Clear all
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFilterPopover(false)}
                      className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Helper Components ============

interface ViewTabProps {
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}

function ViewTab({ active, onClick, badge, children }: ViewTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-indigo-100 text-indigo-700"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
            active
              ? "bg-indigo-600 text-white"
              : "bg-gray-200 text-gray-700"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

interface FilterPillProps {
  onRemove: () => void;
  children: React.ReactNode;
}

function FilterPill({ onRemove, children }: FilterPillProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-indigo-200"
        aria-label="Remove filter"
      >
        ✕
      </button>
    </span>
  );
}

interface FilterGroupProps {
  label: string;
  children: React.ReactNode;
}

function FilterGroup({ label, children }: FilterGroupProps) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-700">
        {label}
      </label>
      {children}
    </div>
  );
}

// ============ Helper Functions ============

function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.priority !== "all") count++;
  if (filters.source !== "all") count++;
  if (filters.label !== "all") count++;
  if (filters.project !== "all") count++;
  return count;
}

function formatLabel(label: string): string {
  return label.split("/").pop()?.replace(/_/g, " ") ?? label;
}
