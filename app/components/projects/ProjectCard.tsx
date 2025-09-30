"use client";

import Link from "next/link";
import type { ProjectRecord } from "@cadenzor/shared";

interface ProjectCardProps {
  project: ProjectRecord;
  role?: string;
  stats?: Record<string, number>;
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) {
    return "Dates not set";
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });

  const formattedStart = start ? formatter.format(new Date(start)) : "TBD";
  const formattedEnd = end ? formatter.format(new Date(end)) : "TBD";

  if (!start || !end) {
    return `${formattedStart} → ${formattedEnd}`;
  }

  return `${formattedStart} → ${formattedEnd}`;
}

function renderLabels(labels: ProjectRecord["labels"]) {
  if (!labels || Object.keys(labels).length === 0) {
    return <span className="text-xs text-gray-400">No labels</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(labels).slice(0, 6).map(([key, value]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600"
        >
          <span className="font-medium text-gray-700">{key}</span>
          <span className="text-gray-500">{String(value)}</span>
        </span>
      ))}
    </div>
  );
}

export default function ProjectCard({ project, role, stats }: ProjectCardProps) {
  const color = project.color || "#6366f1";
  const memberRole = role ? role.charAt(0).toUpperCase() + role.slice(1) : "Member";

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md"
      style={{ borderTop: `4px solid ${color}` }}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 group-hover:text-gray-700">
            {project.name}
          </h3>
          <p className="text-sm text-gray-500">{formatDateRange(project.startDate, project.endDate)}</p>
        </div>
        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{memberRole}</span>
      </div>

      {project.description ? (
        <p className="text-sm text-gray-600 line-clamp-2">{project.description}</p>
      ) : (
        <p className="text-sm text-gray-400">No description provided.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1"><span className="font-semibold">Status:</span> {project.status}</span>
          {stats ? (
            <span className="inline-flex items-center gap-1"><span className="font-semibold">Open tasks:</span> {stats.openTaskCount ?? 0}</span>
          ) : null}
          {stats ? (
            <span className="inline-flex items-center gap-1"><span className="font-semibold">Upcoming items:</span> {stats.upcomingTimelineCount ?? 0}</span>
          ) : null}
        </div>
      </div>

      <div>{renderLabels(project.labels)}</div>
    </Link>
  );
}
