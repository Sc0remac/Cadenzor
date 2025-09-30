export const DEFAULT_EMAIL_LABELS = [
  "booking",
  "promo_time",
  "promo_submission",
  "logistics",
  "assets_request",
  "finance",
  "fan_mail",
  "legal",
  "other",
] as const;

export type EmailLabel = string;

/**
 * A simple shape representing an email stored in the database. It contains
 * minimal information used by the frontend and worker. Additional fields
 * can be added as needed (e.g. messageId, threadId, snippet, etc.).
 */
export interface EmailRecord {
  id: string;
  fromName: string | null;
  fromEmail: string;
  subject: string;
  receivedAt: string;
  category: EmailLabel;
  isRead: boolean;
  summary?: string | null;
  labels?: EmailLabel[];
}

/**
 * Definition of a contact record persisted in the Supabase database.
 */
export interface ContactRecord {
  id: string;
  name: string | null;
  email: string;
  lastEmailAt: string;
}

export type ProjectStatus = "active" | "paused" | "archived";

export type ProjectMemberRole = "owner" | "editor" | "viewer";

export interface ProjectRecord {
  id: string;
  artistId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  color: string | null;
  labels: Record<string, string | number | boolean | null>;
  priorityProfile: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberRecord {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  createdAt: string;
}

export type ProjectSourceKind = "drive_folder" | "sheet" | "calendar" | "external_url";

export interface ProjectSourceRecord {
  id: string;
  projectId: string;
  kind: ProjectSourceKind;
  externalId: string;
  title: string | null;
  watch: boolean;
  scope: string | null;
  metadata: Record<string, unknown> | null;
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectLinkSource = "manual" | "ai" | "rule";

export interface ProjectItemLinkRecord {
  id: string;
  projectId: string;
  refTable: string;
  refId: string;
  confidence: number | null;
  source: ProjectLinkSource;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProjectEmailLinkRecord {
  id: string;
  projectId: string;
  emailId: string;
  confidence: number | null;
  source: ProjectLinkSource;
  createdAt: string;
}

export type TimelineItemType = "event" | "milestone" | "task" | "hold" | "lead" | "gate";

export interface TimelineItemRecord {
  id: string;
  projectId: string;
  type: TimelineItemType;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  lane: string | null;
  territory: string | null;
  status: string | null;
  priority: number;
  refTable: string | null;
  refId: string | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTaskRecord {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  priority: number;
  assigneeId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTemplateRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTemplateItemRecord {
  id: string;
  templateId: string;
  itemType: TimelineItemType;
  title: string;
  lane: string | null;
  offsetDays: number;
  durationDays: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}
