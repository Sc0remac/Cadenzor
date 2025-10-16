"use client";

import { useEffect, useMemo, useState } from "react";
import type { TimelineLaneDefinition } from "@kazador/shared";
import { useAuth } from "@/components/AuthProvider";
import {
  deleteLaneDefinition,
  fetchLaneDefinitions,
} from "@/lib/laneDefinitionsClient";
import LaneMetadataModal from "@/components/settings/LaneMetadataModal";
import LaneAutomationPanel from "@/components/settings/LaneAutomationPanel";
import { summariseAutoAssignRules } from "@/components/settings/AutoAssignRuleBuilder";

interface MetadataModalState {
  open: boolean;
  mode: "create" | "edit";
  lane: TimelineLaneDefinition | null;
}

export default function LaneSettingsPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? undefined;
  const [lanes, setLanes] = useState<TimelineLaneDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [metadataState, setMetadataState] = useState<MetadataModalState>({ open: false, mode: "create", lane: null });
  const [selectedAutomationLaneId, setSelectedAutomationLaneId] = useState<string | null>(null);
  const [deletingLaneId, setDeletingLaneId] = useState<string | null>(null);

  const nextSortOrder = useMemo(() => {
    if (lanes.length === 0) return 100;
    const maxOrder = lanes.reduce((max, lane) => Math.max(max, lane.sortOrder ?? 0), 0);
    return maxOrder + 100;
  }, [lanes]);

  useEffect(() => {
    if (!accessToken) {
      setError("You need to be signed in to manage lanes.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchLaneDefinitions(accessToken)
      .then((list) => {
        if (cancelled) return;
        setLanes(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load lane definitions");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (selectedAutomationLaneId && lanes.some((lane) => lane.id === selectedAutomationLaneId)) {
      return;
    }
    const defaultLane = lanes
      .slice()
      .sort((a, b) => {
        const orderA = a.sortOrder ?? 0;
        const orderB = b.sortOrder ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return a.name.localeCompare(b.name);
      })[0];
    if (defaultLane) {
      setSelectedAutomationLaneId(defaultLane.id);
    } else {
      setSelectedAutomationLaneId(null);
    }
  }, [lanes, selectedAutomationLaneId]);

  const globalLanes = useMemo(
    () =>
      lanes
        .filter((lane) => lane.userId == null)
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name);
        }),
    [lanes]
  );

  const personalLanes = useMemo(
    () =>
      lanes
        .filter((lane) => lane.userId != null)
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name);
        }),
    [lanes]
  );

  const handleOpenCreate = () => {
    setMetadataState({ open: true, mode: "create", lane: null });
  };

  const handleOpenEdit = (lane: TimelineLaneDefinition) => {
    setMetadataState({ open: true, mode: "edit", lane });
  };

  const closeMetadataModal = () => {
    setMetadataState((prev) => ({ ...prev, open: false }));
  };

  const handleLaneSaved = (lane: TimelineLaneDefinition, mode: "create" | "edit") => {
    setLanes((prev) => {
      if (mode === "create") {
        return [...prev, lane];
      }
      return prev.map((entry) => (entry.id === lane.id ? lane : entry));
    });

    setSuccess(mode === "create" ? `Created lane “${lane.name}”.` : `Updated lane “${lane.name}”.`);
    closeMetadataModal();

    if (mode === "create") {
      setSelectedAutomationLaneId(lane.id);
    }
  };

  const handleDelete = async (lane: TimelineLaneDefinition) => {
    if (!accessToken) {
      setError("Missing access token – sign in again to continue.");
      return;
    }
    if (!confirm(`Delete lane "${lane.name}"? Items using it will need to be reassigned.`)) {
      return;
    }

    setDeletingLaneId(lane.id);
    try {
      await deleteLaneDefinition(lane.id, accessToken);
      setLanes((prev) => prev.filter((entry) => entry.id !== lane.id));
      setSuccess(`Deleted lane “${lane.name}”.`);
      if (selectedAutomationLaneId === lane.id) {
        setSelectedAutomationLaneId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete lane");
    } finally {
      setDeletingLaneId(null);
    }
  };

  const handleAutomationUpdated = (lane: TimelineLaneDefinition) => {
    setLanes((prev) => prev.map((entry) => (entry.id === lane.id ? lane : entry)));
    setSuccess(`Saved automation rules for “${lane.name}”.`);
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Timeline lanes</h1>
          <p className="mt-1 text-sm text-gray-600">
            Configure the lanes that appear in project hubs, automations, and the command center timeline.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
        >
          Create new lane
        </button>
      </div>

      {error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
      ) : null}

      {loading ? (
        <p className="mt-8 text-sm text-gray-500">Loading lanes…</p>
      ) : (
        <div className="mt-8 space-y-12">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">Workspace defaults</h2>
            <p className="mt-1 text-sm text-gray-500">
              Global lanes are shared across every manager. Edits here update the workspace for everyone.
            </p>
            {globalLanes.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">No global lanes have been published yet.</p>
            ) : (
              <ul className="mt-4 grid gap-4 md:grid-cols-2">
                {globalLanes.map((lane) => (
                  <li key={lane.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900">{lane.name}</p>
                        <p className="text-xs uppercase tracking-wide text-gray-400">Slug: {lane.slug}</p>
                        {lane.description ? (
                          <p className="mt-2 text-sm text-gray-600">{lane.description}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end gap-3">
                        {lane.color ? (
                          <span
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200"
                            style={{ backgroundColor: lane.color }}
                            aria-hidden
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(lane)}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                        >
                          Edit lane
                        </button>
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
                      <div>
                        <dt className="font-medium text-gray-400">Sort order</dt>
                        <dd>{lane.sortOrder}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-gray-400">Default</dt>
                        <dd>{lane.isDefault ? "Shown" : "Hidden"}</dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-gray-500">Auto-assigns: {summariseAutoAssignRules(lane.autoAssignRules ?? null)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Your custom lanes</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Lanes created here are visible only to you unless you mark them as workspace-wide.
                </p>
              </div>
            </div>
            {personalLanes.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">You haven’t created any custom lanes yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {personalLanes.map((lane) => (
                  <li
                    key={lane.id}
                    className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      {lane.color ? (
                        <span
                          className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200"
                          style={{ backgroundColor: lane.color }}
                          aria-hidden
                        />
                      ) : null}
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{lane.name}</p>
                        <p className="text-xs uppercase tracking-wide text-gray-400">Slug: {lane.slug}</p>
                        {lane.description ? (
                          <p className="mt-1 text-sm text-gray-600">{lane.description}</p>
                        ) : null}
                        <p className="mt-2 text-xs text-gray-500">
                          Sort order {lane.sortOrder} · {lane.isDefault ? "Shown by default" : "Hidden by default"}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Auto-assigns: {summariseAutoAssignRules(lane.autoAssignRules ?? null)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end md:self-auto">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(lane)}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(lane)}
                        disabled={deletingLaneId === lane.id}
                        className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingLaneId === lane.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <LaneAutomationPanel
            lanes={lanes}
            selectedLaneId={selectedAutomationLaneId}
            onSelectLane={setSelectedAutomationLaneId}
            accessToken={accessToken}
            onLaneUpdated={handleAutomationUpdated}
          />
        </div>
      )}

      <LaneMetadataModal
        open={metadataState.open}
        mode={metadataState.mode}
        lane={metadataState.lane}
        accessToken={accessToken}
        onClose={closeMetadataModal}
        onSaved={handleLaneSaved}
        suggestedSortOrder={nextSortOrder}
      />
    </div>
  );
}
