import type { DigestTopAction } from "@kazador/shared";

interface TimelineGlimpseCardProps {
  actions: DigestTopAction[];
  loading: boolean;
  error: string | null;
}

function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  return new Date(isoDate).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function TimelineGlimpseCard({ actions, loading, error }: TimelineGlimpseCardProps) {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Timeline Glimpse</h3>
        <a href="/timeline" className="text-sm font-medium text-blue-600 hover:underline">
          View Timeline
        </a>
      </div>

      <div className="mt-4 flow-root">
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-4">
                <div className="h-4 w-16 rounded bg-gray-200"></div>
                <div className="flex-1 h-4 rounded bg-gray-200"></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
          </div>
        ) : actions.length === 0 ? (
          <div className="rounded-md border-2 border-dashed border-gray-200 p-8 text-center">
            <div className="mx-auto h-12 w-12 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h18M3 14h18M8 3v4M16 3v4M4 20h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2z"/></svg>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-gray-800">Nothing on the horizon</h3>
            <p className="mt-1 text-sm text-gray-500">Important deadlines will appear here.</p>
          </div>
        ) : (
          <ul className="-my-3 divide-y divide-gray-200/70">
            {actions.map((action) => (
              <li key={action.id} className="flex items-center gap-4 py-3">
                <div className="w-20 flex-shrink-0 text-right">
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    {formatDate(action.dueAt || action.startsAt)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">{action.title}</p>
                  <p className="truncate text-xs text-gray-500">{action.projectName}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
