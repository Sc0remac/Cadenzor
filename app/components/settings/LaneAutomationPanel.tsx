"use client";

import { useEffect, useMemo, useState } from "react";
import type { TimelineLaneDefinition } from "@kazador/shared";
import AutoAssignRuleBuilder, { summariseAutoAssignRules, parseRuleSet } from "./AutoAssignRuleBuilder";
import { describeCondition } from "./ConditionEditor";
import { updateLaneDefinition } from "@/lib/laneDefinitionsClient";

interface LaneAutomationPanelProps {
  lanes: TimelineLaneDefinition[];
  selectedLaneId: string | null;
  onSelectLane: (laneId: string | null) => void;
  accessToken?: string;
  onLaneUpdated: (lane: TimelineLaneDefinition) => void;
}

export default function LaneAutomationPanel({
  lanes,
  selectedLaneId,
  onSelectLane,
  accessToken,
  onLaneUpdated,
}: LaneAutomationPanelProps) {
  const [draftRules, setDraftRules] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reapplyState, setReapplyState] = useState<{ status: "idle" | "running" | "success" | "error"; message?: string }>({
    status: "idle",
  });

  const sortedLanes = useMemo(() => {
    return [...lanes].sort((a, b) => {
      const orderA = a.sortOrder ?? 0;
      const orderB = b.sortOrder ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }, [lanes]);

  const selectedLane = useMemo(
    () => sortedLanes.find((lane) => lane.id === selectedLaneId) ?? null,
    [sortedLanes, selectedLaneId]
  );

  useEffect(() => {
    setDraftRules(selectedLane?.autoAssignRules ?? null);
    setError(null);
    setReapplyState({ status: "idle" });
  }, [selectedLane?.id, selectedLane?.autoAssignRules]);

  const isDirty = useMemo(() => {
    const current = JSON.stringify(draftRules ?? null);
    const initial = JSON.stringify(selectedLane?.autoAssignRules ?? null);
    return current !== initial;
  }, [draftRules, selectedLane?.autoAssignRules]);

  const handleSave = async () => {
    if (!selectedLane) return;
    if (!accessToken) {
      setError("You need to be signed in to update automation rules.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updated = await updateLaneDefinition(
        selectedLane.id,
        {
          autoAssignRules: draftRules && Object.keys(draftRules).length > 0 ? draftRules : null,
        },
        accessToken
      );
      onLaneUpdated(updated);
      setReapplyState({ status: "idle" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save automation rules");
      setSaving(false);
      return;
    }

    setSaving(false);
  };

  const handleReapply = async () => {
    if (!selectedLane) return;
    if (!accessToken) {
      setReapplyState({ status: "error", message: "You need to be signed in to run auto-assignment." });
      return;
    }

    setReapplyState({ status: "running" });

    try {
      const response = await fetch(`/api/timeline-lanes/${selectedLane.id}/reapply`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to re-run auto-assignment");
      }

      const { updated = 0, unchanged = 0, skipped = 0 } = payload ?? {};
      const summaryParts = [
        updated ? `${updated} task${updated === 1 ? "" : "s"} updated` : null,
        unchanged ? `${unchanged} already matched` : null,
        skipped ? `${skipped} skipped` : null,
      ].filter(Boolean);
      const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : "No tasks needed changes.";
      setReapplyState({ status: "success", message: summary });
    } catch (err) {
      setReapplyState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to re-run auto-assignment",
      });
    }
  };

  const handleClear = () => {
    setDraftRules(null);
  };

  return (
    <section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Auto-assignment rules</h2>
          <p className="mt-1 text-sm text-gray-500">
            Choose a lane to teach Kazador how to route new timeline items automatically. Leave rules empty to keep it manual.
          </p>
        </div>
        <div className="flex flex-col gap-2 text-sm text-gray-700 sm:flex-row sm:items-center sm:gap-3">
          <label className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Lane</span>
            <select
              value={selectedLaneId ?? ""}
              onChange={(event) => onSelectLane(event.target.value || null)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            >
              <option value="">Select a lane…</option>
              {sortedLanes.map((lane) => (
                <option key={lane.id} value={lane.id}>
                  {lane.name} {lane.userId == null ? "(Workspace)" : "(Personal)"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Rule overview</h3>
            <p className="text-xs text-gray-500">Review every lane’s playbook at a glance. Click a lane to edit its rules.</p>
          </div>
        </div>
        <div className="mt-4 divide-y divide-gray-200">
          {sortedLanes.map((lane) => {
            const parsed = parseRuleSet(lane.autoAssignRules ?? null);
            const isSelected = lane.id === selectedLaneId;
            return (
              <button
                key={lane.id}
                type="button"
                onClick={() => onSelectLane(lane.id)}
                className={`w-full text-left transition ${
                  isSelected ? "bg-gray-50" : "hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-4 px-3 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {lane.name} {lane.userId == null ? "· Workspace" : "· Personal"}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-gray-400">Slug: {lane.slug}</p>
                    <p className="mt-2 text-xs text-gray-500">{summariseAutoAssignRules(lane.autoAssignRules ?? null)}</p>
                    {parsed.conditions.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-gray-600">
                        {parsed.conditions.slice(0, 3).map((condition) => (
                          <li key={condition.id}>{describeCondition(condition)}</li>
                        ))}
                        {parsed.conditions.length > 3 ? (
                          <li className="text-gray-400">+{parsed.conditions.length - 3} more</li>
                        ) : null}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-gray-500 italic">No rules yet – items must be assigned manually.</p>
                    )}
                  </div>
                  <span className="ml-4 inline-flex items-center rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700">
                    {isSelected ? "Editing" : "Edit rules"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {!selectedLane ? (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
          Select a lane to start defining automation rules.
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{selectedLane.name}</h3>
              <p className="text-xs uppercase tracking-wide text-gray-400">Slug: {selectedLane.slug}</p>
              <p className="mt-2 text-sm text-gray-600">
                Current summary: {summariseAutoAssignRules(selectedLane.autoAssignRules ?? null)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Lanes run from the lowest sort order to the highest. If more than one rule matches, the first lane wins.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleReapply}
                disabled={reapplyState.status === "running" || !accessToken}
                className={`rounded-md border border-gray-300 px-3 py-2 text-sm font-medium transition ${
                  reapplyState.status === "running"
                    ? "cursor-not-allowed bg-gray-100 text-gray-400"
                    : "bg-white text-gray-700 hover:bg-gray-100"
                }`}
              >
                {reapplyState.status === "running" ? "Re-running…" : "Apply to existing tasks"}
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={saving || (!draftRules && !selectedLane.autoAssignRules)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-white disabled:cursor-not-allowed disabled:text-gray-400"
              >
                Clear rules
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isDirty || !accessToken}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {saving ? "Saving…" : "Save rules"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}
          {reapplyState.status === "success" ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {reapplyState.message}
            </div>
          ) : null}
          {reapplyState.status === "error" ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {reapplyState.message}
            </div>
          ) : null}

          <div className="mt-6">
            <AutoAssignRuleBuilder value={draftRules} onChange={setDraftRules} disabled={saving} />
          </div>
        </div>
      )}
    </section>
  );
}
