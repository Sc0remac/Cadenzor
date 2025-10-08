"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

interface AdminProjectsPanelProps {
  accessToken: string | null;
  onChange?: () => void;
}

export interface AdminProjectMember {
  userId: string;
  role: string;
}

export interface AdminProject {
  id: string;
  slug: string;
  name: string;
  status: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  color: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  priorityProfile: Record<string, unknown> | null;
  members: AdminProjectMember[];
}

interface ProjectFormState {
  name: string;
  description: string;
  status: string;
  startDate: string;
  endDate: string;
  color: string;
  ownerId: string;
}

const EMPTY_PROJECT_FORM: ProjectFormState = {
  name: "",
  description: "",
  status: "active",
  startDate: "",
  endDate: "",
  color: "",
  ownerId: "",
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

function formatDateLabel(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
}

export default function AdminProjectsPanel({ accessToken, onChange }: AdminProjectsPanelProps) {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [refreshToken, setRefreshToken] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<ProjectFormState>(EMPTY_PROJECT_FORM);
  const [editingProject, setEditingProject] = useState<AdminProject | null>(null);
  const [editForm, setEditForm] = useState<ProjectFormState>(EMPTY_PROJECT_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const canLoad = Boolean(accessToken);

  const fetchProjects = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (debouncedQuery) {
      params.set("q", debouncedQuery);
    }
    if (statusFilter && statusFilter !== "all") {
      params.set("status", statusFilter);
    }

    try {
      const response = await fetch(`/api/admin/projects${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load projects");
      }

      setProjects(Array.isArray(payload?.projects) ? (payload.projects as AdminProject[]) : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load projects");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, debouncedQuery, statusFilter]);

  useEffect(() => {
    if (!canLoad) {
      return;
    }

    void fetchProjects();
  }, [canLoad, fetchProjects, refreshToken]);

  const handleCreateChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setCreateForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleEditChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  const submitCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!accessToken) {
        return;
      }

      setCreating(true);
      setCreateError(null);

      try {
        const response = await fetch("/api/admin/projects", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: createForm.name,
            description: createForm.description,
            status: createForm.status,
            startDate: createForm.startDate || null,
            endDate: createForm.endDate || null,
            color: createForm.color || null,
            ownerId: createForm.ownerId || null,
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to create project");
        }

        setCreateForm(EMPTY_PROJECT_FORM);
        setRefreshToken((token) => token + 1);
        onChange?.();
      } catch (err: any) {
        setCreateError(err?.message || "Failed to create project");
      } finally {
        setCreating(false);
      }
    },
    [accessToken, createForm, onChange]
  );

  const startEditing = useCallback((project: AdminProject) => {
    setEditError(null);
    setEditingProject(project);
    setEditForm({
      name: project.name,
      description: project.description ?? "",
      status: project.status,
      startDate: project.startDate ?? "",
      endDate: project.endDate ?? "",
      color: project.color ?? "",
      ownerId: project.members.find((member) => member.role === "owner")?.userId ?? "",
    });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingProject(null);
    setEditForm(EMPTY_PROJECT_FORM);
    setSavingEdit(false);
    setEditError(null);
  }, []);

  const submitEdit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!accessToken || !editingProject) {
        return;
      }

      setSavingEdit(true);
      setEditError(null);

      try {
        const response = await fetch(`/api/admin/projects/${editingProject.id}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: editForm.name,
            description: editForm.description,
            status: editForm.status,
            startDate: editForm.startDate || null,
            endDate: editForm.endDate || null,
            color: editForm.color || null,
            ownerId: editForm.ownerId || null,
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update project");
        }

        const updated = payload?.project as AdminProject | undefined;
        if (updated) {
          setProjects((prev) => prev.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)));
        }

        setRefreshToken((token) => token + 1);
        onChange?.();
        cancelEditing();
      } catch (err: any) {
        setEditError(err?.message || "Failed to update project");
      } finally {
        setSavingEdit(false);
      }
    },
    [accessToken, editingProject, editForm, onChange, cancelEditing]
  );

  const summary = useMemo(() => {
    const total = projects.length;
    const active = projects.filter((project) => project.status === "active").length;
    const paused = projects.filter((project) => project.status === "paused").length;
    const archived = projects.filter((project) => project.status === "archived").length;
    return { total, active, paused, archived };
  }, [projects]);

  if (!accessToken) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
        Provide a valid session token to manage projects.
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Projects</h2>
            <p className="text-sm text-gray-600">
              Create new workspaces, adjust metadata, and switch owners from one place.
            </p>
          </div>
          <div className="flex flex-col items-end text-xs text-gray-500">
            <span>Total: {summary.total}</span>
            <span>Active: {summary.active} · Paused: {summary.paused} · Archived: {summary.archived}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col">
            <label htmlFor="admin-project-search" className="text-xs font-semibold uppercase text-gray-500">
              Search
            </label>
            <input
              id="admin-project-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Project name, slug, description"
              className="mt-1 w-64 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold uppercase text-gray-500">Status</span>
            <div className="mt-2 flex gap-2">
              {[{ value: "all", label: "All" }, ...STATUS_OPTIONS].map((option) => {
                const active = statusFilter === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatusFilter(option.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRefreshToken((token) => token + 1)}
            className="ml-auto rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:text-gray-900"
          >
            Refresh
          </button>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Project</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Owner</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Dates</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((project) => {
                const owner = project.members.find((member) => member.role === "owner");
                return (
                  <tr key={project.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{project.name}</div>
                      <div className="text-xs text-gray-500">{project.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          project.status === "active"
                            ? "bg-emerald-100 text-emerald-700"
                            : project.status === "paused"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {project.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{owner?.userId ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDateLabel(project.startDate)} – {formatDateLabel(project.endDate)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => startEditing(project)}
                          className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-gray-700"
                        >
                          Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {projects.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                    No projects found. Adjust filters or add a new one below.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-semibold text-gray-900">Create project</h3>
          <p className="text-xs text-gray-500">
            Ideal for demos—fill in as much or as little metadata as you need.
          </p>
          <form className="mt-4 space-y-4" onSubmit={submitCreate}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase text-gray-500">
                Name
                <input
                  name="name"
                  value={createForm.name}
                  onChange={handleCreateChange}
                  required
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Status
                <select
                  name="status"
                  value={createForm.status}
                  onChange={handleCreateChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Start date
                <input
                  name="startDate"
                  type="date"
                  value={createForm.startDate}
                  onChange={handleCreateChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                End date
                <input
                  name="endDate"
                  type="date"
                  value={createForm.endDate}
                  onChange={handleCreateChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500 md:col-span-2">
                Description
                <textarea
                  name="description"
                  value={createForm.description}
                  onChange={handleCreateChange}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Accent color
                <input
                  name="color"
                  value={createForm.color}
                  onChange={handleCreateChange}
                  placeholder="#000000"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Owner user id
                <input
                  name="ownerId"
                  value={createForm.ownerId}
                  onChange={handleCreateChange}
                  placeholder="UUID"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
            </div>
            {createError ? <p className="text-sm text-red-600">{createError}</p> : null}
            <div className="flex items-center justify-end gap-3">
              <button
                type="submit"
                disabled={creating}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-500"
              >
                {creating ? "Creating…" : "Create project"}
              </button>
            </div>
          </form>
        </section>
      </section>

      <aside className="h-fit rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {editingProject ? (
          <form className="space-y-4" onSubmit={submitEdit}>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Manage project</h3>
              <p className="text-xs text-gray-500">{editingProject.name}</p>
            </div>
            <div className="grid gap-4">
              <label className="text-xs font-semibold uppercase text-gray-500">
                Name
                <input
                  name="name"
                  value={editForm.name}
                  onChange={handleEditChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Status
                <select
                  name="status"
                  value={editForm.status}
                  onChange={handleEditChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Start date
                <input
                  name="startDate"
                  type="date"
                  value={editForm.startDate}
                  onChange={handleEditChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                End date
                <input
                  name="endDate"
                  type="date"
                  value={editForm.endDate}
                  onChange={handleEditChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Description
                <textarea
                  name="description"
                  value={editForm.description}
                  onChange={handleEditChange}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Accent color
                <input
                  name="color"
                  value={editForm.color}
                  onChange={handleEditChange}
                  placeholder="#000000"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Owner user id
                <input
                  name="ownerId"
                  value={editForm.ownerId}
                  onChange={handleEditChange}
                  placeholder="UUID"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
            </div>
            {editError ? <p className="text-sm text-red-600">{editError}</p> : null}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={cancelEditing}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-500"
              >
                {savingEdit ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex h-full flex-col justify-center text-sm text-gray-600">
            <p>Select a project to edit metadata and ownership.</p>
            <p className="mt-2 text-xs text-gray-500">
              You can keep fields blank when running quick demos.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
