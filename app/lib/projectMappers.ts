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
  ApprovalStatus,
} from "@cadenzor/shared";

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

export function mapTimelineItemRow(row: any): TimelineItemRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    type: row.type as TimelineItemRecord["type"],
    title: row.title as string,
    startsAt: parseDateTime(row.starts_at),
    endsAt: parseDateTime(row.ends_at),
    lane: (row.lane as string) ?? null,
    territory: (row.territory as string) ?? null,
    status: (row.status as string) ?? null,
    priority: Number(row.priority ?? 0),
    refTable: (row.ref_table as string) ?? null,
    refId: (row.ref_id as string) ?? null,
    metadata: parseJson(row.metadata),
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapTimelineDependencyRow(row: any): TimelineDependencyRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    fromItemId: row.from_item_id as string,
    toItemId: row.to_item_id as string,
    kind: (row.kind as TimelineDependencyRecord["kind"]) ?? "FS",
    note: (row.note as string) ?? null,
    createdAt: String(row.created_at),
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
    priority: Number(row.priority ?? 0),
    assigneeId: (row.assignee_id as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseApprovalStatus(value: any): ApprovalStatus {
  if (value === "approved" || value === "declined" || value === "pending") {
    return value;
  }
  return "pending";
}

export function mapApprovalRow(row: any): ApprovalRecord {
  return {
    id: row.id as string,
    projectId: (row.project_id as string) ?? null,
    type: (row.type as string) ?? "unknown",
    status: parseApprovalStatus(row.status),
    payload: parseJson(row.payload),
    requestedBy: (row.requested_by as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    approverId: (row.approver_id as string) ?? null,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    declinedAt: row.declined_at ? String(row.declined_at) : null,
    resolutionNote: (row.resolution_note as string) ?? null,
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
