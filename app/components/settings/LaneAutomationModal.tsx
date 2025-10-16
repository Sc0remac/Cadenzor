"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { TimelineLaneDefinition } from "@kazador/shared";
import AutoAssignRuleBuilder from "./AutoAssignRuleBuilder";
import { summariseAutoAssignRules } from "./AutoAssignRuleBuilder";
import { updateLaneDefinition } from "@/lib/laneDefinitionsClient";

interface LaneAutomationModalProps {
  open: boolean;
  lane: TimelineLaneDefinition | null;
  accessToken?: string;
  onClose: () => void;
  onSaved: (lane: TimelineLaneDefinition) => void;
}

export default function LaneAutomationModal({
  open,
  lane,
  accessToken,
  onClose,
  onSaved,
}: LaneAutomationModalProps) {
  const [draftRules, setDraftRules] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftRules(lane?.autoAssignRules ?? null);
    setError(null);
  }, [open, lane]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const isDirty = useMemo(() => {
    const current = JSON.stringify(draftRules ?? null);
    const initial = JSON.stringify(lane?.autoAssignRules ?? null);
    return current !== initial;
  }, [draftRules, lane?.autoAssignRules]);

  if (!open || !lane) {
    return null;
  }

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleSave = async () => {
    if (!accessToken) {
      setError("You need to be signed in to update automation rules.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updated = await updateLaneDefinition(
        lane.id,
        {
          autoAssignRules: draftRules && Object.keys(draftRules).length > 0 ? draftRules : null,
        },
        accessToken
      );
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save automation rules");
    } finally {
      setSaving(false);
    }
  };

  const currentSummary = summariseAutoAssignRules(lane.autoAssignRules ?? null);
  const draftSummary = summariseAutoAssignRules(draftRules ?? null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4 py-10 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={handleOverlayClick}
    >
      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Auto-assignment rules</p>
            <h2 className="mt-1 text-xl font-semibold text-gray-900">{lane.name}</h2>
            <p className="mt-2 text-sm text-gray-600">
              Define the conditions that automatically drop new timeline items into this lane. Leave everything empty to
              keep it manual.
            </p>
            <p className="mt-2 text-xs text-gray-400">Currently active: {currentSummary}</p>
            <p className="mt-1 text-xs text-gray-500">Preview summary: {draftSummary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-transparent px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100"
          >
            Close
          </button>
        </div>

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="max-h-[60vh] overflow-y-auto px-6 py-6">
          <AutoAssignRuleBuilder value={draftRules} onChange={setDraftRules} disabled={saving} />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={() => setDraftRules(null)}
            disabled={saving || (draftRules == null && lane.autoAssignRules == null)}
            className="text-sm font-medium text-gray-500 transition hover:text-gray-800 disabled:cursor-not-allowed disabled:text-gray-300"
          >
            Clear rules
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              disabled={saving}
            >
              Cancel
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
      </div>
    </div>
  );
}
