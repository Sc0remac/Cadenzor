import type { CalendarEventRecord } from "@kazador/shared";

interface TodayAgendaCardProps {
  events: CalendarEventRecord[];
  loading: boolean;
  error: string | null;
}

function formatEventTime(event: CalendarEventRecord): string {
  if (event.isAllDay) return "All Day";
  const start = event.startAt ? new Date(event.startAt) : null;
  if (!start) return "";
  return start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function TodayAgendaCard({ events, loading, error }: TodayAgendaCardProps) {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Today's Agenda</h3>
        <a href="/calendar" className="text-sm font-medium text-blue-600 hover:underline">
          View Calendar
        </a>
      </div>

      <div className="mt-4 flow-root">
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex animate-pulse items-center gap-4">
                <div className="h-10 w-16 rounded-md bg-gray-200"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-gray-200"></div>
                  <div className="h-3 w-1/2 rounded bg-gray-200"></div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-md border-2 border-dashed border-gray-200 p-8 text-center">
            <div className="mx-auto h-12 w-12 text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2z"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3 10h18"/></svg>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-gray-800">No meetings today</h3>
            <p className="mt-1 text-sm text-gray-500">Enjoy the quiet day!</p>
          </div>
        ) : (
          <ul className="-my-4 divide-y divide-gray-200/70">
            {events.map((event) => (
              <li key={event.id} className="flex items-center gap-4 py-4">
                <div className="flex-shrink-0 rounded-md bg-gray-100 px-3 py-2 text-center">
                  <p className="text-sm font-semibold text-gray-800">{formatEventTime(event)}</p>
                </div>
                <div className="flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{event.summary || "(No Title)"}</p>
                  <p className="text-sm text-gray-500">
                    {event.location || (event.hangoutLink ? "Video call" : "No location")}
                  </p>
                </div>
                {event.hangoutLink && (
                  <a href={event.hangoutLink} target="_blank" rel="noopener noreferrer" className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
