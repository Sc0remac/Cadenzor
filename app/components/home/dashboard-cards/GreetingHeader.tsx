import type { User } from "@supabase/supabase-js";

interface GreetingHeaderProps {
  user: User | null;
  onRefresh: () => void;
}

export function GreetingHeader({ user, onRefresh }: GreetingHeaderProps) {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const displayName = user?.user_metadata?.full_name || user?.email || "there";

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          {getGreeting()}, {displayName}!
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Here’s your snapshot of what’s happening today.
        </p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 transition-all duration-150 hover:bg-gray-50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="-ml-1 h-4 w-4 text-gray-600"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
        Refresh
      </button>
    </header>
  );
}
