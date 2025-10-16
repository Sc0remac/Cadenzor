"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { TimelineLaneDefinition } from "@kazador/shared";
import {
  createLaneDefinition,
  updateLaneDefinition,
  type LaneDefinitionInput,
} from "@/lib/laneDefinitionsClient";

interface LaneMetadataModalProps {
  open: boolean;
  mode: "create" | "edit";
  lane: TimelineLaneDefinition | null;
  accessToken?: string;
  onClose: () => void;
  onSaved: (lane: TimelineLaneDefinition, mode: "create" | "edit") => void;
  suggestedSortOrder: number;
}

interface LaneFormState {
  name: string;
  slug: string;
  description: string;
  color: string;
  sortOrder: number;
  isDefault: boolean;
  scope: "user" | "global";
}

function normaliseColorInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export default function LaneMetadataModal({
  open,
  mode,
  lane,
  accessToken,
  onClose,
  onSaved,
  suggestedSortOrder,
}: LaneMetadataModalProps) {
  const [form, setForm] = useState<LaneFormState>(() => ({
    name: "",
    slug: "",
    description: "",
    color: "",
    sortOrder: suggestedSortOrder,
    isDefault: true,
    scope: "user",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWorkspaceLane = useMemo(() => (lane ? lane.userId == null : form.scope === "global"), [lane, form.scope]);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && lane) {
      setForm({
        name: lane.name,
        slug: lane.slug,
        description: lane.description ?? "",
        color: lane.color ?? "",
        sortOrder: lane.sortOrder ?? suggestedSortOrder,
        isDefault: lane.isDefault,
        scope: lane.userId ? "user" : "global",
      });
    } else {
      setForm({
        name: "",
        slug: "",
        description: "",
        color: "",
        sortOrder: suggestedSortOrder,
        isDefault: true,
        scope: "user",
      });
    }
    setError(null);
    setSaving(false);
  }, [open, mode, lane, suggestedSortOrder]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken) {
      setError("You need to be signed in to save lanes.");
      return;
    }

    if (!form.name.trim()) {
      setError("Lane name is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const payload: LaneDefinitionInput = {
      name: form.name.trim(),
      description: form.description.trim() ? form.description.trim() : null,
      color: form.color.trim() ? normaliseColorInput(form.color) : null,
      slug: form.slug.trim() ? form.slug.trim().toUpperCase() : undefined,
      sortOrder: Number.isFinite(form.sortOrder) ? Math.trunc(form.sortOrder) : undefined,
      isDefault: form.isDefault,
    };

    try {
      if (mode === "edit" && lane) {
        const updated = await updateLaneDefinition(lane.id, payload, accessToken);
        onSaved(updated, "edit");
      } else {
        payload.scope = form.scope;
        const created = await createLaneDefinition(
          payload as Required<Pick<LaneDefinitionInput, "name">> & LaneDefinitionInput,
          accessToken
        );
        onSaved(created, "create");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save lane");
      setSaving(false);
      return;
    }

    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 px-4 py-10 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {mode === "edit" ? "Edit lane" : "Create new lane"}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-900">
              {mode === "edit" && lane ? lane.name : "Lane details"}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Define lane metadata so new timeline items and automations can target it.
            </p>
            {mode === "edit" && isWorkspaceLane ? (
              <p className="mt-2 text-xs text-amber-700">
                You are updating a workspace lane. Changes will apply to everyone who uses this workspace.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-transparent px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100"
            disabled={saving}
          >
            Close
          </button>
        </div>

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <form onSubmit={handleSubmit} className="grid gap-6 px-6 py-6 md:grid-cols-2">
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
          {mode === "create" ? (
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Scope</span>
              <select
                value={form.scope}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, scope: event.target.value as "global" | "user" }))
                }
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              >
                <option value="user">Only visible to me</option>
                <option value="global">Share with everyone</option>
              </select>
            </label>
          ) : (
            <div className="flex flex-col gap-1 text-sm text-gray-500">
              <span className="font-medium text-gray-700">Scope</span>
              <span>{lane?.userId ? "Personal" : "Workspace"}</span>
            </div>
          )}

          <div className="md:col-span-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Create lane"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
