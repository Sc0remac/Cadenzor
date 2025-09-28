import type { EmailRecord } from "@cadenzor/shared";

export const DEFAULT_EMAILS_PER_PAGE = 10;

export interface EmailPagination {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface EmailListResponse {
  items: EmailRecord[];
  pagination: EmailPagination;
}

type FetchEmailsOptions = {
  page?: number;
  perPage?: number;
};

export async function fetchEmailStats(): Promise<Record<EmailRecord["category"], number>> {
  const response = await fetch("/api/email-stats", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch email statistics");
  }

  return payload as Record<EmailRecord["category"], number>;
}

export async function fetchRecentEmails(
  options: FetchEmailsOptions = {}
): Promise<EmailListResponse> {
  const query = new URLSearchParams();
  if (options.page != null) {
    query.set("page", String(options.page));
  }
  if (options.perPage != null) {
    query.set("perPage", String(options.perPage));
  }

  const queryString = query.toString();
  const response = await fetch(queryString ? `/api/emails?${queryString}` : "/api/emails", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch emails");
  }

  const items = Array.isArray(payload?.items)
    ? (payload.items as EmailRecord[])
    : [];

  const fallbackPage = options.page && options.page > 0 ? options.page : 1;
  const fallbackPerPage = options.perPage && options.perPage > 0
    ? options.perPage
    : DEFAULT_EMAILS_PER_PAGE;

  const rawPagination = payload?.pagination;
  const pagination: EmailPagination = {
    page: typeof rawPagination?.page === "number" && rawPagination.page > 0
      ? rawPagination.page
      : fallbackPage,
    perPage:
      typeof rawPagination?.perPage === "number" && rawPagination.perPage > 0
        ? rawPagination.perPage
        : fallbackPerPage,
    total: typeof rawPagination?.total === "number" && rawPagination.total >= 0
      ? rawPagination.total
      : items.length,
    totalPages:
      typeof rawPagination?.totalPages === "number" && rawPagination.totalPages >= 0
        ? rawPagination.totalPages
        : items.length > 0
        ? 1
        : 0,
    hasMore: false,
  };

  if (typeof rawPagination?.hasMore === "boolean") {
    pagination.hasMore = rawPagination.hasMore;
  } else if (typeof rawPagination?.total === "number" && rawPagination.total >= 0) {
    pagination.hasMore = pagination.page * pagination.perPage < rawPagination.total;
  } else {
    pagination.hasMore = items.length === pagination.perPage;
  }

  return { items, pagination };
}
