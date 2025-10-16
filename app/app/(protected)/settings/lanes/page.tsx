"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { TimelineLaneDefinition } from "@kazador/shared";
import { useAuth } from "@/components/AuthProvider";
import {
  createLaneDefinition,
  deleteLaneDefinition,
  fetchLaneDefinitions,
  updateLaneDefinition,
  type LaneDefinitionInput,
} from "@/lib/laneDefinitionsClient";
import LaneAutomationModal from "@/components/settings/LaneAutomationModal";
import { summariseAutoAssignRules } from "@/components/settings/AutoAssignRuleBuilder";

interface LaneFormState {
  id: string | null;
  name: string;
  description: string;
  color: string;
  slug: string;
  sortOrder: number;
  isDefault: boolean;
  scope: "global" | "user";
}

function createEmptyForm(nextSortOrder: number): LaneFormState {
  return {
    id: null,
    name: "",
    description: "",
    color: "",
    slug: "",
    sortOrder: nextSortOrder,
    isDefault: true,
    scope: "user",
  };
}

function normaliseColorInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export default function LaneSettingsPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? undefined;
  const [lanes, setLanes] = useState<TimelineLaneDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<LaneFormState>(() => createEmptyForm(100));
  const [automationLane, setAutomationLane] = useState<TimelineLaneDefinition | null>(null);
  const [automationOpen, setAutomationOpen] = useState(false);

  const nextSortOrder = useMemo(() => {
    if (lanes.length === 0) return 100;
    const maxOrder = lanes.reduce((max, lane) => Math.max(max, lane.sortOrder ?? 0), 0);
    return maxOrder + 100;
  }, [lanes]);

  useEffect(() => {
    if (form.id === null) {
      setForm((prev) => ({ ...prev, sortOrder: nextSortOrder }));
    }
  }, [nextSortOrder, form.id]);

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

  const editingLane = form.id ? lanes.find((lane) => lane.id === form.id) ?? null : null;

  const openAutomationModal = (lane: TimelineLaneDefinition) => {
    setAutomationLane(lane);
    setAutomationOpen(true);
  };

  const closeAutomationModal = () => {
    setAutomationOpen(false);
    setAutomationLane(null);
  };

  const handleAutomationSaved = (lane: TimelineLaneDefinition) => {
    setLanes((prev) => prev.map((entry) => (entry.id === lane.id ? lane : entry)));
    if (form.id === lane.id) {
      setForm((prev) => ({
        ...prev,
        name: lane.name,
        description: lane.description ?? "",
        color: lane.color ?? "",
        slug: lane.slug,
        sortOrder: lane.sortOrder ?? prev.sortOrder,
        isDefault: lane.isDefault,
      }));
    }
    setSuccess(`Saved automation rules for “${lane.name}”.`);
  };

  const resetForm = () => {
    setForm(createEmptyForm(nextSortOrder));
    setSuccess(null);
    setError(null);
    closeAutomationModal();
  };

  const handleEdit = (lane: TimelineLaneDefinition) => {
    setForm({
      id: lane.id,
      name: lane.name,
      description: lane.description ?? "",
      color: lane.color ?? "",
      slug: lane.slug,
      sortOrder: lane.sortOrder ?? nextSortOrder,
      isDefault: lane.isDefault,
      scope: lane.userId ? "user" : "global",
    });
    setSuccess(null);
    setError(null);
    openAutomationModal(lane);
  };

  const handleDelete = async (lane: TimelineLaneDefinition) => {
    if (!accessToken) {
      setError("Missing access token – sign in again to continue.");
      return;
    }
    if (!confirm(`Delete lane "${lane.name}"? Items using it will need to be reassigned.`)) {
      return;
    }
    try {
      await deleteLaneDefinition(lane.id, accessToken);
      setSuccess(`Deleted lane “${lane.name}”.`);
      setLanes((prev) => prev.filter((entry) => entry.id !== lane.id));
      if (form.id === lane.id) {
        resetForm();
      }
      if (automationLane?.id === lane.id) {
        closeAutomationModal();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete lane");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken) {
      setError("Missing access token – sign in again to continue.");
      return;
    }
    if (!form.name.trim()) {
      setError("Lane name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload: LaneDefinitionInput = {
      name: form.name.trim(),
      description: form.description.trim() ? form.description.trim() : null,
      color: form.color.trim() ? normaliseColorInput(form.color) : null,
      slug: form.slug.trim() ? form.slug.trim().toUpperCase() : undefined,
      sortOrder: Number.isFinite(form.sortOrder) ? Math.trunc(form.sortOrder) : undefined,
      isDefault: form.isDefault,
    };

    if (!form.id) {
      payload.scope = form.scope;
    }

    try {
      if (form.id) {
        const updated = await updateLaneDefinition(form.id, payload, accessToken);
        setLanes((prev) => prev.map((lane) => (lane.id === updated.id ? updated : lane)));
        setSuccess(`Updated lane “${updated.name}”.`);
        setForm((prev) => ({
          ...prev,
          name: updated.name,
          description: updated.description ?? "",
          color: updated.color ?? "",
          slug: updated.slug,
          sortOrder: updated.sortOrder ?? prev.sortOrder,
          isDefault: updated.isDefault,
        }));
      } else {
        const created = await createLaneDefinition(
          payload as Required<Pick<LaneDefinitionInput, "name">> & LaneDefinitionInput,
          accessToken
        );
        setLanes((prev) => [...prev, created]);
        setSuccess(`Created lane “${created.name}”. Configure automation rules (optional).`);
        setForm(createEmptyForm(nextSortOrder));
        openAutomationModal(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save lane");
    } finally {
      setSaving(false);
    }
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
          onClick={resetForm}
          className="self-start rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 shadow-sm transition hover:bg-gray-100"
        >
          {form.id ? "Cancel editing" : "Reset form"}
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
        <div className="mt-8 space-y-10">
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
                          onClick={() => handleEdit(lane)}
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
                        onClick={() => handleEdit(lane)}
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(lane)}
                        className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">
              {form.id ? "Edit lane" : "Create new lane"}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Define lane metadata so new timeline items and automations can target it.
            </p>
            {editingLane && !editingLane.userId ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                You are updating a workspace lane. Changes will apply to everyone who uses this workspace.
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-6 grid gap-6 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-gray-700">Name</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  required
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-gray-700">Slug</span>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
                  placeholder="Optional override (e.g. FINANCE)"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm md:col-span-2">
                <span className="font-medium text-gray-700">Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows={3}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  placeholder="Explain when to use this lane"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-gray-700">Color</span>
                <input
                  type="text"
                  value={form.color}
                  onChange={(event) => setForm((prev) => ({ ...prev, color: event.target.value }))}
                  placeholder="#7c3aed"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-gray-700">Sort order</span>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value) }))}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-gray-700">Default visibility</span>
                <select
                  value={form.isDefault ? "true" : "false"}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isDefault: event.target.value === "true" }))
                  }
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                >
                  <option value="true">Show by default</option>
                  <option value="false">Hide until toggled on</option>
                </select>
              </label>
              {!form.id ? (
                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium text-gray-700">Scope</span>
                  <select
                    value={form.scope}
                    onChange={(event) => setForm((prev) => ({ ...prev, scope: event.target.value as "global" | "user" }))}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  >
                    <option value="user">Only visible to me</option>
                    <option value="global">Share with everyone</option>
                  </select>
                </label>
              ) : (
                <div className="flex flex-col gap-1 text-sm text-gray-500">
                  <span className="font-medium text-gray-700">Scope</span>
                  <span>{editingLane?.userId ? "Personal" : "Workspace"}</span>
                </div>
              )}
              <div className="md:col-span-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  {saving ? "Saving…" : form.id ? "Save changes" : "Create lane"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <LaneAutomationModal
        open={automationOpen}
        lane={automationLane}
        accessToken={accessToken}
        onClose={closeAutomationModal}
        onSaved={handleAutomationSaved}
      />
    </div>
  );
}
