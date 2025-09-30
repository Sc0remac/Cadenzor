"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../components/AuthProvider";
import ProjectCard from "../../../components/projects/ProjectCard";
import ProjectCreateDialog from "../../../components/projects/ProjectCreateDialog";
import { fetchProjects, type ProjectListItem } from "../../../lib/supabaseClient";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

export default function ProjectsPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const loadProjects = useCallback(async () => {
    if (!accessToken) {
      setProjects([]);
      setLoading(false);
      setError("You need to sign in again to view projects.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const list = await fetchProjects({
        accessToken,
        status: statusFilter !== "all" ? statusFilter : undefined,
        query: searchQuery || undefined,
      });
      setProjects(list);
    } catch (err: any) {
      console.error("Failed to load projects", err);
      setError(err?.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [accessToken, statusFilter, searchQuery]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleProjectCreated = useCallback(
    () => {
      setShowCreate(false);
      void loadProjects();
    },
    [loadProjects]
  );

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    return projects;
  }, [projects]);

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-600">
            Spin up focused hubs for tours, releases, campaigns, and special initiatives.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
          >
            New project
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col">
          <label htmlFor="project-search" className="text-xs font-semibold uppercase text-gray-500">
            Search
          </label>
          <input
            id="project-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search by name"
            className="mt-1 w-64 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold uppercase text-gray-500">Status</span>
          <div className="mt-2 flex gap-2">
            {STATUS_FILTERS.map((filter) => {
              const active = statusFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setStatusFilter(filter.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    active
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="ml-auto text-xs text-gray-500">
          {filteredProjects.length} project{filteredProjects.length === 1 ? "" : "s"}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="h-3 w-3 animate-ping rounded-full bg-gray-400" />
          Loading projects…
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center text-gray-600">
          <h2 className="text-lg font-semibold text-gray-900">No projects yet</h2>
          <p className="mt-2 text-sm text-gray-500">
            Create your first project to unlock timeline, inbox, and task workflows.
          </p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
          >
            Create a project
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((entry) => (
            <ProjectCard key={entry.project.id} project={entry.project} role={entry.role} />
          ))}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Need a quick refresher?</h2>
        <p className="mt-1 text-sm text-gray-600">
          Projects isolate workstreams while keeping labels and links connected to the global graph. Head into a project to manage timeline lanes, scoped inbox, tasks, approvals, and settings.
        </p>
        <Link href="/projects" className="mt-3 inline-flex items-center text-sm font-medium text-gray-900 underline">
          Learn how project hubs work
        </Link>
      </div>

      <ProjectCreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleProjectCreated}
        accessToken={accessToken}
      />
    </section>
  );
}
