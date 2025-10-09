import type {
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
  AssetRecord,
  AssetLinkRecord,
  OAuthAccountRecord,
  EmailAttachmentRecord,
} from "@cadenzor/shared";

import { getTimelineLaneForType } from "@cadenzor/shared";

function parseDateTime(value: any): string | null {
  if (!value) {
    return null;
  }
  return String(value);
}

function parseJson<T>(value: any): T {
  if (value == null) {
    return {} as T;
  }
  if (typeof value === "object") {
    return value as T;
  }

  try {
    return JSON.parse(String(value)) as T;
  } catch (err) {
    return {} as T;
  }
}

export function mapProjectRow(row: any): ProjectRecord {
  return {
    id: row.id as string,
    artistId: (row.artist_id as string) ?? null,
    name: row.name as string,
    slug: row.slug as string,
    description: (row.description as string) ?? null,
    status: row.status as ProjectRecord["status"],
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    color: (row.color as string) ?? null,
    labels: parseJson(row.labels),
    priorityProfile: row.priority_profile ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapProjectMemberRow(row: any): ProjectMemberRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    role: row.role as ProjectMemberRecord["role"],
    createdAt: String(row.created_at),
  };
}

export function mapProjectSourceRow(row: any): ProjectSourceRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    kind: row.kind as ProjectSourceRecord["kind"],
    externalId: row.external_id as string,
    title: (row.title as string) ?? null,
    watch: Boolean(row.watch),
    scope: (row.scope as string) ?? null,
    metadata: row.metadata ?? null,
    lastIndexedAt: parseDateTime(row.last_indexed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapAssetRow(row: any): AssetRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    projectSourceId: row.project_source_id as string,
    source: row.source as AssetRecord["source"],
    externalId: row.external_id as string,
    title: row.title as string,
    mimeType: (row.mime_type as string) ?? null,
    size: row.size != null ? Number(row.size) : null,
    path: (row.path as string) ?? null,
    owner: (row.owner as string) ?? null,
    modifiedAt: parseDateTime(row.modified_at),
    confidential: Boolean(row.confidential),
    metadata: parseJson(row.metadata),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    isCanonical: Boolean(row.is_canonical),
    canonicalCategory: (row.canonical_category as AssetRecord["canonicalCategory"]) ?? null,
    driveUrl: (row.drive_url as string) ?? null,
    driveWebViewLink: (row.drive_web_view_link as string) ?? null,
  };
}

export function mapAssetLinkRow(row: any): AssetLinkRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    assetId: row.asset_id as string,
    refTable: row.ref_table as string,
    refId: row.ref_id as string,
    source: row.source as AssetLinkRecord["source"],
    createdAt: String(row.created_at),
  };
}

export function mapOAuthAccountRow(row: any): OAuthAccountRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    provider: row.provider as OAuthAccountRecord["provider"],
    accountEmail: row.account_email as string,
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string,
    expiresAt: String(row.expires_at),
    tokenMetadata: parseJson(row.token_metadata),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapEmailAttachmentRow(row: any): EmailAttachmentRecord {
  return {
    id: row.id as string,
    emailId: row.email_id as string,
    filename: row.filename as string,
    mimeType: (row.mime_type as string) ?? null,
    size: row.size != null ? Number(row.size) : null,
    storageBucket: (row.storage_bucket as string) ?? null,
    storagePath: (row.storage_path as string) ?? null,
    sha256: (row.sha256 as string) ?? null,
    metadata: parseJson(row.metadata),
    createdAt: String(row.created_at),
  };
}

export function mapProjectItemLinkRow(row: any): ProjectItemLinkRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    refTable: row.ref_table as string,
    refId: row.ref_id as string,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    source: row.source as ProjectItemLinkRecord["source"],
    metadata: row.metadata ?? null,
    createdAt: String(row.created_at),
  };
}

export function mapProjectEmailLinkRow(row: any): ProjectEmailLinkRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    emailId: row.email_id as string,
    confidence: row.confidence != null ? Number(row.confidence) : null,
    source: row.source as ProjectEmailLinkRecord["source"],
    createdAt: String(row.created_at),
  };
}

export function mapTimelineDependencyRow(row: any): TimelineDependencyRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    fromItemId: row.from_item_id as string,
    toItemId: row.to_item_id as string,
    kind: row.kind as TimelineDependencyRecord["kind"],
    note: (row.note as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapTimelineItemRow(row: any): TimelineItemRecord {
  const labels = parseJson<TimelineItemRecord["labels"]>(row.labels);
  const priorityComponentsRaw = row.priority_components != null ? parseJson<TimelineItemRecord["priorityComponents"]>(row.priority_components) : null;
  const priorityComponents = priorityComponentsRaw && Object.keys(priorityComponentsRaw).length > 0 ? priorityComponentsRaw : null;
  const links = parseJson<TimelineItemRecord["links"]>(row.links);
  const conflictFlags = row.conflict_flags ?? null;
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    type: row.type as TimelineItemRecord["type"],
    lane: (row.lane as TimelineItemRecord["lane"]) ?? getTimelineLaneForType(row.type as TimelineItemRecord["type"]),
    kind: (row.kind as string) ?? null,
    title: row.title as string,
    description: (row.description as string) ?? null,
    startsAt: parseDateTime(row.start_at),
    endsAt: parseDateTime(row.end_at),
    dueAt: parseDateTime(row.due_at),
    timezone: (row.tz as string) ?? null,
    status: (row.status as TimelineItemRecord["status"]) ?? "planned",
    priorityScore: row.priority_score != null ? Number(row.priority_score) : null,
    priorityComponents,
    labels,
    links,
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    conflictFlags,
    layoutRow: row.layout_row != null ? Number(row.layout_row) : null,
    territory: typeof labels.territory === "string" ? labels.territory : null,
  };
}

export function mapApprovalRow(row: any): ApprovalRecord {
  return {
    id: row.id as string,
    projectId: (row.project_id as string) ?? null,
    type: row.type as ApprovalRecord["type"],
    status: row.status as ApprovalRecord["status"],
    payload: parseJson<Record<string, unknown>>(row.payload),
    requestedBy: (row.requested_by as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    approverId: (row.approver_id as string) ?? null,
    approvedAt: parseDateTime(row.approved_at),
    declinedAt: parseDateTime(row.declined_at),
    resolutionNote: (row.resolution_note as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapProjectTaskRow(row: any): ProjectTaskRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    status: row.status as string,
    dueAt: parseDateTime(row.due_at),
    priority: row.priority != null ? Number(row.priority) : null,
    assigneeId: (row.assignee_id as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapProjectTemplateRow(row: any): ProjectTemplateRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: (row.description as string) ?? null,
    payload: parseJson(row.payload),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapProjectTemplateItemRow(row: any): ProjectTemplateItemRecord {
  return {
    id: row.id as string,
    templateId: row.template_id as string,
    itemType: row.item_type as ProjectTemplateItemRecord["itemType"],
    title: row.title as string,
    lane: (row.lane as string) ?? null,
    offsetDays: Number(row.offset_days ?? 0),
    durationDays: Number(row.duration_days ?? 0),
    metadata: parseJson(row.metadata),
    createdAt: String(row.created_at),
  };
}
