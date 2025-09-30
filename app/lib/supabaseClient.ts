import type {
  EmailRecord,
  ProjectRecord,
  ProjectMemberRecord,
  ProjectSourceRecord,
  ProjectItemLinkRecord,
  ProjectEmailLinkRecord,
  TimelineItemRecord,
  ProjectTaskRecord,
  ProjectTemplateRecord,
  ProjectTemplateItemRecord,
} from "@cadenzor/shared";

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
  accessToken?: string;
};

function buildHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

export type EmailStatsScope = "unread" | "all";

export interface FetchEmailStatsOptions {
  accessToken?: string;
  scope?: EmailStatsScope;
}

export async function fetchEmailStats(
  options: FetchEmailStatsOptions = {}
): Promise<Record<EmailRecord["category"], number>> {
  const { accessToken, scope } = options;

  const query = new URLSearchParams();
  if (scope) {
    query.set("scope", scope);
  }

  const endpoint = query.toString() ? `/api/email-stats?${query.toString()}` : "/api/email-stats";

  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(accessToken),
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
  const { page, perPage, accessToken } = options;

  const query = new URLSearchParams();
  if (page != null) {
    query.set("page", String(page));
  }
  if (perPage != null) {
    query.set("perPage", String(perPage));
  }

  const queryString = query.toString();
  const response = await fetch(queryString ? `/api/emails?${queryString}` : "/api/emails", {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch emails");
  }

  const items = Array.isArray(payload?.items)
    ? (payload.items as EmailRecord[])
    : [];

  const fallbackPage = page && page > 0 ? page : 1;
  const fallbackPerPage = perPage && perPage > 0
    ? perPage
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

export interface ProjectListItem {
  project: ProjectRecord;
  role?: string;
}

export async function fetchProjects(options: {
  accessToken?: string;
  status?: string | null;
  query?: string | null;
} = {}): Promise<ProjectListItem[]> {
  const { accessToken, status, query } = options;
  const searchParams = new URLSearchParams();
  if (status) searchParams.set("status", status);
  if (query) searchParams.set("q", query);

  const endpoint = searchParams.size > 0 ? `/api/projects?${searchParams.toString()}` : "/api/projects";

  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch projects");
  }

  return Array.isArray(payload?.projects) ? (payload.projects as ProjectListItem[]) : [];
}

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  status?: ProjectRecord["status"];
  startDate?: string | null;
  endDate?: string | null;
  color?: string | null;
  labels?: Record<string, unknown>;
  artistId?: string | null;
  templateSlug?: string | null;
  priorityProfile?: Record<string, unknown> | null;
}

export async function createProject(
  input: CreateProjectInput,
  accessToken?: string
): Promise<ProjectRecord> {
  const response = await fetch("/api/projects", {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to create project");
  }

  return payload.project as ProjectRecord;
}

export interface ProjectHubResponse {
  project: ProjectRecord;
  members: Array<{ member: ProjectMemberRecord; profile: { fullName: string | null; email: string | null } | null }>;
  sources: ProjectSourceRecord[];
  timelineItems: TimelineItemRecord[];
  tasks: ProjectTaskRecord[];
  itemLinks: ProjectItemLinkRecord[];
  emailLinks: Array<{ link: ProjectEmailLinkRecord; email: EmailRecord | null }>;
  stats: Record<string, number>;
}

export async function fetchProjectHub(
  projectId: string,
  accessToken?: string
): Promise<ProjectHubResponse> {
  const response = await fetch(`/api/projects/${projectId}`, {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load project hub");
  }

  return payload as ProjectHubResponse;
}

export async function updateProject(
  projectId: string,
  updates: Partial<CreateProjectInput>,
  accessToken?: string
): Promise<ProjectRecord> {
  const response = await fetch(`/api/projects/${projectId}`, {
    method: "PATCH",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to update project");
  }

  return payload.project as ProjectRecord;
}

export async function fetchProjectTemplates(accessToken?: string): Promise<
  Array<{ template: ProjectTemplateRecord; items: ProjectTemplateItemRecord[] }>
> {
  const response = await fetch("/api/project-templates", {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch project templates");
  }

  return Array.isArray(payload?.templates) ? payload.templates : [];
}

export async function fetchProjectSuggestionsForEmail(
  emailId: string,
  accessToken?: string
): Promise<Array<{ project: ProjectRecord; score: number; rationales: string[] }>> {
  const response = await fetch("/api/projects/suggestions/email", {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ emailId }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch project suggestions");
  }

  return Array.isArray(payload?.suggestions) ? payload.suggestions : [];
}

export interface CreateTimelineItemInput {
  title: string;
  type: TimelineItemRecord["type"];
  startsAt?: string | null;
  endsAt?: string | null;
  lane?: string | null;
  territory?: string | null;
  status?: string | null;
  priority?: number;
  refTable?: string | null;
  refId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createTimelineItem(
  projectId: string,
  payload: CreateTimelineItemInput,
  accessToken?: string
): Promise<TimelineItemRecord> {
  const response = await fetch(`/api/projects/${projectId}/timeline`, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || "Failed to create timeline item");
  }

  return body.item as TimelineItemRecord;
}

export async function deleteTimelineItem(
  projectId: string,
  itemId: string,
  accessToken?: string
): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/timeline/${itemId}`, {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  if (!response.ok) {
    const body = await response.json();
    throw new Error(body?.error || "Failed to delete timeline item");
  }
}

export interface CreateProjectTaskInput {
  title: string;
  description?: string | null;
  status?: string;
  dueAt?: string | null;
  priority?: number;
  assigneeId?: string | null;
}

export async function createProjectTask(
  projectId: string,
  payload: CreateProjectTaskInput,
  accessToken?: string
): Promise<ProjectTaskRecord> {
  const response = await fetch(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || "Failed to create task");
  }

  return body.task as ProjectTaskRecord;
}

export async function updateProjectTask(
  projectId: string,
  taskId: string,
  updates: Partial<CreateProjectTaskInput>,
  accessToken?: string
): Promise<ProjectTaskRecord> {
  const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || "Failed to update task");
  }

  return body.task as ProjectTaskRecord;
}

export async function deleteProjectTask(
  projectId: string,
  taskId: string,
  accessToken?: string
): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  if (!response.ok) {
    const body = await response.json();
    throw new Error(body?.error || "Failed to delete task");
  }
}

export async function linkEmailToProject(
  projectId: string,
  emailId: string,
  accessToken?: string
): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/emails`, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ emailId }),
  });

  if (!response.ok) {
    const body = await response.json();
    throw new Error(body?.error || "Failed to attach email to project");
  }
}

export async function unlinkEmailFromProject(
  projectId: string,
  linkId: string,
  accessToken?: string
): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/emails/${linkId}`, {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  if (!response.ok) {
    const body = await response.json();
    throw new Error(body?.error || "Failed to unlink email");
  }
}
