"use client";

import { useEffect, useMemo, useState } from "react";
import type { TimelineLaneDefinition } from "@kazador/shared";
import AutoAssignRuleBuilder, { summariseAutoAssignRules } from "./AutoAssignRuleBuilder";
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save automation rules");
      setSaving(false);
      return;
    }

    setSaving(false);
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
            </div>
            <div className="flex gap-3">
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
                disabled={saving || !isDirty}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {saving ? "Saving…" : "Save rules"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

          <div className="mt-6">
            <AutoAssignRuleBuilder value={draftRules} onChange={setDraftRules} disabled={saving} />
          </div>
        </div>
      )}
    </section>
  );
}
