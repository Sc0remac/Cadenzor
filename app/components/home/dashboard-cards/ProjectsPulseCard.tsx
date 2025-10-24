import type { DigestProjectSnapshot } from "@kazador/shared";

interface ProjectsPulseCardProps {
  projects: DigestProjectSnapshot[];
  loading: boolean;
  error: string | null;
}

function formatTrend(trend: string | null | undefined): string {
  if (!trend) return "Steady";
  return trend.charAt(0).toUpperCase() + trend.slice(1);
}

export function ProjectsPulseCard({ projects, loading, error }: ProjectsPulseCardProps) {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Projects Pulse</h3>
        <a href="/projects" className="text-sm font-medium text-blue-600 hover:underline">
          View All Projects
        </a>
      </div>

      <div className="mt-4 flow-root">
        {loading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 rounded-lg bg-gray-50 p-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 rounded bg-gray-200"></div>
                  <div className="h-3 w-3/4 rounded bg-gray-200"></div>
                </div>
                <div className="h-8 w-20 rounded-full bg-gray-200"></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-md border-2 border-dashed border-gray-200 p-8 text-center">
            <div className="mx-auto h-12 w-12 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-gray-800">No Active Projects</h3>
            <p className="mt-1 text-sm text-gray-500">Create a project to see its pulse here.</p>
          </div>
        ) : (
          <ul className="-my-4 divide-y divide-gray-200/70">
            {projects.map((snapshot) => (
              <li key={snapshot.project.id} className="flex items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{snapshot.project.name}</p>
                  <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                    <span>
                      <span className="font-semibold text-gray-700">{snapshot.metrics.openTasks}</span> open tasks
                    </span>
                    <span>
                      <span className="font-semibold text-gray-700">{snapshot.metrics.upcomingTimeline}</span> upcoming
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-600">{formatTrend(snapshot.metrics.trend)}</span>
                  <div
                    className={`h-2 w-2 rounded-full ${
                      snapshot.metrics.trend === "improving" ? "bg-green-500" : snapshot.metrics.trend === "slipping" ? "bg-red-500" : "bg-yellow-500"
                    }`}
                  ></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
