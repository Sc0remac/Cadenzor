import Link from "next/link";

const actions = [
  {
    label: "New Project",
    href: "/projects?create=true",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
    ),
  },
  {
    label: "New Task",
    href: "/tasks/new",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
    ),
  },
  {
    label: "Go to Inbox",
    href: "/inbox",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
    ),
  },
  {
    label: "View Timeline",
    href: "/timeline",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h18M3 14h18M8 3v4M16 3v4M4 20h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2z"/></svg>
    ),
  },
];

export function QuickActionsCard() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {actions.map((action) => (
        <Link
          href={action.href}
          key={action.label}
          className="group flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200/80 bg-white p-4 text-center shadow-sm transition-all duration-150 hover:border-gray-300 hover:bg-gray-50 hover:shadow-md"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors group-hover:bg-blue-100 group-hover:text-blue-600">
            {action.icon}
          </div>
          <span className="text-xs font-semibold text-gray-700 group-hover:text-gray-900 sm:text-sm">
            {action.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
