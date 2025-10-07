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
  TimelineDependencyRecord,
  ApprovalRecord,
  ProjectTopAction,
  AssetRecord,
  AssetLinkRecord,
  EmailAttachmentRecord,
  AssetCanonicalCategory,
} from "@cadenzor/shared";

export const DEFAULT_EMAILS_PER_PAGE = 10;

export type EmailSourceFilter = "all" | "seeded";

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
  label?: string | null;
  source?: EmailSourceFilter;
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
  source?: EmailSourceFilter;
}

export async function fetchEmailStats(
  options: FetchEmailStatsOptions = {}
): Promise<Record<EmailRecord["category"], number>> {
  const { accessToken, scope, source } = options;

  const query = new URLSearchParams();
  if (scope) {
    query.set("scope", scope);
  }
  if (source && source !== "all") {
    query.set("source", source);
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
  const { page, perPage, accessToken, label, source } = options;

  const query = new URLSearchParams();
  if (page != null) {
    query.set("page", String(page));
  }
  if (perPage != null) {
    query.set("perPage", String(perPage));
  }
  if (label) {
    query.set("label", label);
  }
  if (source && source !== "all") {
    query.set("source", source);
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

export interface ProjectHubStats {
  openTaskCount: number;
  upcomingTimelineCount: number;
  linkedEmailCount: number;
  assetCount: number;
  conflictCount: number;
}

export interface ProjectHubResponse {
  project: ProjectRecord;
  members: Array<{ member: ProjectMemberRecord; profile: { fullName: string | null; email: string | null } | null }>;
  sources: ProjectSourceRecord[];
  assets: AssetRecord[];
  assetLinks: AssetLinkRecord[];
  timelineItems: TimelineItemRecord[];
  timelineDependencies: TimelineDependencyRecord[];
  tasks: ProjectTaskRecord[];
  itemLinks: ProjectItemLinkRecord[];
  emailLinks: Array<{ link: ProjectEmailLinkRecord; email: EmailRecord | null }>;
  approvals: ApprovalRecord[];
  stats: ProjectHubStats;
  topActions: ProjectTopAction[];
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

export interface DriveAccountStatus {
  connected: boolean;
  account?: {
    id: string;
    email: string;
    scopes: string[];
    expiresAt: string;
  };
}

export async function fetchDriveAccountStatus(accessToken?: string): Promise<DriveAccountStatus> {
  const response = await fetch("/api/integrations/google-drive/account", {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  if (response.status === 404) {
    return { connected: false };
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load Drive account");
  }

  return payload as DriveAccountStatus;
}

export async function disconnectDriveAccount(accessToken?: string): Promise<void> {
  const response = await fetch("/api/integrations/google-drive/account", {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload?.error || "Failed to disconnect Drive");
  }
}

export async function startDriveOAuth(
  options: { redirectTo?: string } = {},
  accessToken?: string
): Promise<{ authUrl: string; state: string }> {
  const response = await fetch("/api/integrations/google-drive/oauth/start", {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ redirectTo: options.redirectTo ?? null }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to initiate Drive OAuth");
  }

  return payload as { authUrl: string; state: string };
}

export interface DriveFolderSummaryDto {
  id: string;
  name: string;
  path: string;
  parentId?: string;
  webViewLink?: string;
}

export interface DriveFileSummaryDto {
  id: string;
  name: string;
  mimeType: string;
  path?: string;
  modifiedTime?: string;
  size?: number;
  webViewLink?: string;
  webContentLink?: string;
  iconLink?: string;
}

export interface DriveBrowseResponse {
  mode: "browse" | "search";
  query: string | null;
  current: DriveFolderSummaryDto | null;
  folders: DriveFolderSummaryDto[];
  files: DriveFileSummaryDto[];
}

export async function browseDriveItems(
  options: { parent?: string; search?: string } = {},
  accessToken?: string
): Promise<DriveBrowseResponse> {
  const params = new URLSearchParams();
  if (options.parent) {
    params.set("parent", options.parent);
  }
  if (options.search) {
    params.set("search", options.search);
  }

  const queryString = params.toString();
  const endpoint = queryString
    ? `/api/integrations/google-drive/folders?${queryString}`
    : "/api/integrations/google-drive/folders";

  const response = await fetch(endpoint, {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to list Drive folders");
  }

  const folders = Array.isArray(payload?.folders)
    ? (payload.folders as DriveFolderSummaryDto[])
    : [];

  const files = Array.isArray(payload?.files)
    ? (payload.files as DriveFileSummaryDto[])
    : [];

  const mode = payload?.mode === "search" ? "search" : "browse";
  const payloadQuery = typeof payload?.query === "string" ? payload.query : null;
  const current = payload?.current ? (payload.current as DriveFolderSummaryDto) : null;

  return {
    mode,
    query: payloadQuery,
    current,
    folders,
    files,
  };
}

export interface ConnectDriveSelectionPayload {
  driveId: string;
  kind: "folder" | "file";
  title?: string;
  autoIndex?: boolean;
  maxDepth?: number;
}

export interface ConnectDriveSourcePayload {
  selections: ConnectDriveSelectionPayload[];
  accountId?: string;
}

export interface ConnectDriveSourceResult {
  source: ProjectSourceRecord;
  indexSummary?: { assetCount: number; indexedAt: string } | null;
}

export interface ConnectDriveSourceResponse {
  results: ConnectDriveSourceResult[];
  source?: ProjectSourceRecord | null;
  indexSummary?: { assetCount: number; indexedAt: string } | null;
}

export async function connectDriveSource(
  projectId: string,
  payload: ConnectDriveSourcePayload,
  accessToken?: string
): Promise<ConnectDriveSourceResponse> {
  const response = await fetch(`/api/projects/${projectId}/drive/connect`, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || "Failed to connect Drive folder");
  }

  return body as ConnectDriveSourceResponse;
}

export async function reindexDriveSource(
  projectId: string,
  sourceId: string,
  accessToken?: string
): Promise<{ assetCount: number; indexedAt: string }> {
  const response = await fetch(`/api/projects/${projectId}/drive/${sourceId}/reindex`, {
    method: "POST",
    headers: buildHeaders(accessToken),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to reindex Drive source");
  }

  return payload as { assetCount: number; indexedAt: string };
}

export interface AssetListOptions {
  sourceId?: string | null;
  type?: string | null;
  pathContains?: string | null;
  updated?: "last7" | "last30" | null;
  canonical?: boolean;
  confidential?: boolean;
  page?: number;
  perPage?: number;
}

export interface AssetListResponse {
  items: AssetRecord[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export async function fetchProjectAssets(
  projectId: string,
  options: AssetListOptions = {},
  accessToken?: string
): Promise<AssetListResponse> {
  const params = new URLSearchParams();
  if (options.sourceId) params.set("sourceId", options.sourceId);
  if (options.type) params.set("type", options.type);
  if (options.pathContains) params.set("path", options.pathContains);
  if (options.updated) params.set("updated", options.updated);
  if (options.canonical != null) params.set("canonical", String(options.canonical));
  if (options.confidential != null) params.set("confidential", String(options.confidential));
  if (options.page) params.set("page", String(options.page));
  if (options.perPage) params.set("perPage", String(options.perPage));

  const query = params.toString();

  const response = await fetch(
    query ? `/api/projects/${projectId}/assets?${query}` : `/api/projects/${projectId}/assets`,
    {
      method: "GET",
      headers: buildHeaders(accessToken),
      cache: "no-store",
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch project assets");
  }

  return payload as AssetListResponse;
}

export async function fetchEmailAttachments(
  emailId: string,
  accessToken?: string
): Promise<EmailAttachmentRecord[]> {
  const response = await fetch(`/api/emails/${emailId}/attachments`, {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch attachments");
  }

  return Array.isArray(payload?.attachments) ? (payload.attachments as EmailAttachmentRecord[]) : [];
}

export async function fileEmailAttachmentsToDrive(
  projectId: string,
  emailId: string,
  payload: {
    projectSourceId: string;
    attachmentIds: string[];
    targetFolderId?: string;
    subfolderPath?: string;
  },
  accessToken?: string
): Promise<AssetRecord[]> {
  const response = await fetch(`/api/projects/${projectId}/emails/by-id/${emailId}/file-attachments`, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || "Failed to file attachments to Drive");
  }

  return Array.isArray(body?.assets) ? (body.assets as AssetRecord[]) : [];
}

export async function linkAssetToReference(
  projectId: string,
  assetId: string,
  payload: { refTable: string; refId: string; source?: string },
  accessToken?: string
): Promise<AssetLinkRecord> {
  const response = await fetch(`/api/projects/${projectId}/assets/${assetId}/links`, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || "Failed to link asset");
  }

  return body.link as AssetLinkRecord;
}

export async function unlinkAssetLink(
  projectId: string,
  assetId: string,
  linkId: string,
  accessToken?: string
): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/assets/${assetId}/links/${linkId}`, {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  if (!response.ok) {
    const body = await response.json();
    throw new Error(body?.error || "Failed to unlink asset");
  }
}

export async function markAssetCanonical(
  projectId: string,
  assetId: string,
  payload: { isCanonical: boolean; category?: AssetCanonicalCategory | null },
  accessToken?: string
): Promise<AssetRecord> {
  const response = await fetch(`/api/projects/${projectId}/assets/${assetId}/canonical`, {
    method: "POST",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || "Failed to update canonical status");
  }

  return body.asset as AssetRecord;
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
  dependencies?: Array<{ itemId: string; kind?: "FS" | "SS"; note?: string }>;
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

export async function fetchApprovals(
  projectId: string,
  accessToken?: string,
  options: { status?: string } = {}
): Promise<ApprovalRecord[]> {
  const params = new URLSearchParams({ projectId });
  if (options.status) {
    params.set("status", options.status);
  }

  const response = await fetch(`/api/approvals?${params.toString()}`, {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch approvals");
  }

  return Array.isArray(payload?.approvals) ? (payload.approvals as ApprovalRecord[]) : [];
}

export async function respondToApproval(
  approvalId: string,
  action: "approve" | "decline",
  options: { note?: string; accessToken?: string } = {}
): Promise<ApprovalRecord> {
  const response = await fetch("/api/approvals", {
    method: "POST",
    headers: {
      ...buildHeaders(options.accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ approvalId, action, note: options.note }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to process approval");
  }

  return payload.approval as ApprovalRecord;
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
