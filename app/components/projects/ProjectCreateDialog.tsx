"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ProjectRecord,
  ProjectTemplateRecord,
  ProjectTemplateItemRecord,
  ProjectStatus,
} from "@cadenzor/shared";
import {
  createProject,
  fetchProjectTemplates,
  type CreateProjectInput,
} from "../../lib/supabaseClient";

interface TemplateOption {
  template: ProjectTemplateRecord;
  items: ProjectTemplateItemRecord[];
}

interface ProjectCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (project: ProjectRecord) => void;
  accessToken: string | null;
}

const STATUS_OPTIONS: ProjectStatus[] = ["active", "paused", "archived"];

interface FormState {
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  color: string;
  templateSlug: string;
  labelsText: string;
}

const INITIAL_STATE: FormState = {
  name: "",
  description: "",
  status: "active",
  startDate: "",
  endDate: "",
  color: "#6366f1",
  templateSlug: "",
  labelsText: "",
};

export default function ProjectCreateDialog({
  open,
  onClose,
  onCreated,
  accessToken,
}: ProjectCreateDialogProps) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [formState, setFormState] = useState<FormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFormState(INITIAL_STATE);
      setError(null);
      setSuccessMessage(null);
      return;
    }

    setLoadingTemplates(true);
    fetchProjectTemplates(accessToken)
      .then((result) => {
        setTemplates(result);
      })
      .catch((err) => {
        console.error("Failed to load templates", err);
        setError(err.message ?? "Failed to load templates");
      })
      .finally(() => setLoadingTemplates(false));
  }, [open, accessToken]);

  const selectedTemplate = useMemo(() => {
    if (!formState.templateSlug) return null;
    return templates.find((entry) => entry.template.slug === formState.templateSlug) ?? null;
  }, [formState.templateSlug, templates]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const parseLabels = (): Record<string, unknown> | undefined => {
    if (!formState.labelsText.trim()) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(formState.labelsText);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      throw new Error("Labels must be a JSON object");
    } catch (err: any) {
      throw new Error(err?.message || "Labels must be valid JSON");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!formState.name.trim()) {
      setError("Project name is required");
      return;
    }

    let labels: Record<string, unknown> | undefined;
    try {
      labels = parseLabels();
    } catch (err: any) {
      setError(err?.message || "Invalid labels");
      return;
    }

    const payload: CreateProjectInput = {
      name: formState.name.trim(),
      description: formState.description.trim() || undefined,
      status: formState.status,
      startDate: formState.startDate || undefined,
      endDate: formState.endDate || undefined,
      color: formState.color || undefined,
      labels,
      templateSlug: formState.templateSlug || undefined,
    };

    setSubmitting(true);
    try {
      const project = await createProject(payload, accessToken ?? undefined);
      setSuccessMessage("Project created successfully");
      onCreated(project);
      onClose();
    } catch (err: any) {
      console.error("Failed to create project", err);
      setError(err?.message || "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Create a new project</h2>
            <p className="text-sm text-gray-600">Set up a hub with timeline, inbox, tasks, and more.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gray-100 px-3 py-1 text-sm text-gray-600 hover:bg-gray-200"
          >
            Close
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Project name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                value={formState.name}
                onChange={handleChange}
                required
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                placeholder="Asian Tour 2026"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                value={formState.description}
                onChange={handleChange}
                rows={3}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                placeholder="Outline the project goals, artists involved, or key outcomes."
              />
            </div>

            <div>
              <label htmlFor="status" className="block text-sm font-medium text-gray-700">
                Status
              </label>
              <select
                id="status"
                name="status"
                value={formState.status}
                onChange={handleChange}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="color" className="block text-sm font-medium text-gray-700">
                Accent color
              </label>
              <input
                id="color"
                name="color"
                type="color"
                value={formState.color}
                onChange={handleChange}
                className="mt-1 h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
              />
            </div>

            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700">
                Start date
              </label>
              <input
                id="startDate"
                name="startDate"
                type="date"
                value={formState.startDate}
                onChange={handleChange}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>

            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700">
                End date
              </label>
              <input
                id="endDate"
                name="endDate"
                type="date"
                value={formState.endDate}
                onChange={handleChange}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="templateSlug" className="block text-sm font-medium text-gray-700">
                Template
              </label>
              <select
                id="templateSlug"
                name="templateSlug"
                value={formState.templateSlug}
                onChange={handleChange}
                disabled={loadingTemplates}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                <option value="">Blank project</option>
                {templates.map(({ template }) => (
                  <option key={template.id} value={template.slug}>
                    {template.name}
                  </option>
                ))}
              </select>
              {selectedTemplate ? (
                <p className="mt-1 text-xs text-gray-500">
                  Includes {selectedTemplate.items.length} timeline seed item{selectedTemplate.items.length === 1 ? "" : "s"}.
                </p>
              ) : null}
            </div>

            <div className="md:col-span-2">
              <label htmlFor="labelsText" className="block text-sm font-medium text-gray-700">
                Labels (JSON object)
              </label>
              <textarea
                id="labelsText"
                name="labelsText"
                value={formState.labelsText}
                onChange={handleChange}
                rows={3}
                placeholder='{"territory": "JP", "phase": "promo"}'
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {successMessage ? <p className="text-sm text-green-600">{successMessage}</p> : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {submitting ? "Creating…" : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
