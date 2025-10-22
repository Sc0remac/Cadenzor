"use client";

/**
 * Loading skeleton components that match the new table layout
 */

export function EmailTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-6 py-3">
          {/* Checkbox skeleton */}
          <div className="h-4 w-4 rounded bg-gray-200 animate-pulse" />

          {/* Priority dot skeleton */}
          <div className="h-2 w-2 rounded-full bg-gray-200 animate-pulse" />

          {/* Content skeleton */}
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-4 w-2/3 rounded bg-gray-200 animate-pulse" />
              <div className="h-3 w-12 rounded bg-gray-200 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-32 rounded bg-gray-200 animate-pulse" />
              <div className="h-3 w-24 rounded bg-gray-200 animate-pulse" />
              <div className="h-5 w-16 rounded bg-gray-200 animate-pulse" />
            </div>
          </div>

          {/* Actions skeleton */}
          <div className="flex gap-1">
            <div className="h-7 w-7 rounded bg-gray-200 animate-pulse" />
            <div className="h-7 w-7 rounded bg-gray-200 animate-pulse" />
            <div className="h-7 w-7 rounded bg-gray-200 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatsBarSkeleton() {
  return (
    <div className="flex items-center gap-6 border-b border-gray-200 bg-gray-50 px-6 py-3">
      <div className="h-4 w-32 rounded bg-gray-200 animate-pulse" />
      <div className="h-4 w-24 rounded bg-gray-200 animate-pulse" />
      <div className="h-4 w-28 rounded bg-gray-200 animate-pulse" />
    </div>
  );
}

/**
 * Empty state components for different scenarios
 */

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon = "📭",
  title,
  description,
  action
}: EmptyStateProps) {
  return (
    <div className="flex h-64 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 text-5xl opacity-50">{icon}</div>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-1 text-xs text-gray-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function InboxZeroState() {
  return (
    <EmptyState
      icon="🎉"
      title="Inbox Zero!"
      description="You've triaged all your emails. Time for a coffee break."
    />
  );
}

export function NoResultsState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <EmptyState
      icon="🔍"
      title="No emails match your filters"
      description="Try adjusting your priority, source, or category filters."
      action={
        <button
          type="button"
          onClick={onClearFilters}
          className="inline-flex items-center rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Clear all filters
        </button>
      }
    />
  );
}

export function LoadingState() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="text-center">
        <div className="mb-3 inline-flex h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
        <p className="text-sm text-gray-600">Loading emails...</p>
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon="⚠️"
      title="Something went wrong"
      description={message}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Try again
          </button>
        ) : undefined
      }
    />
  );
}
