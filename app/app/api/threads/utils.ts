import {
  normaliseThreadRollingSummary,
  type EmailAttachmentRecord,
  type EmailRecord,
  type EmailThreadParticipant,
  type EmailThreadRecord,
  type ThreadEmailMessage,
} from "@kazador/shared";
import { EMAIL_SELECT_COLUMNS, mapEmailRow } from "../emails/utils";

export const THREAD_SELECT_COLUMNS = [
  "id",
  "user_id",
  "gmail_thread_id",
  "subject_canonical",
  "participants",
  "message_count",
  "first_message_at",
  "last_message_at",
  "unread_count",
  "primary_label",
  "labels",
  "rolling_summary",
  "last_summarized_at",
  "priority_score",
  "priority_components",
  "primary_project_id",
  "project_ids",
  "created_at",
  "updated_at",
].join(", ");

export const THREAD_EMAIL_SELECT_COLUMNS = `${EMAIL_SELECT_COLUMNS}, thread_id, gmail_thread_id, gmail_message_id, message_index, in_reply_to, references, reference_ids`;

function coerceIsoString(value: unknown, fallback: () => Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const fallbackDate = fallback();
  return fallbackDate.toISOString();
}

function coerceIsoStringOrNull(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
}

function normaliseParticipants(value: unknown): EmailThreadParticipant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const participants: EmailThreadParticipant[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const email = typeof record.email === "string" ? record.email.trim() : "";
    if (!email) continue;
    const role =
      record.role === "from" || record.role === "to" || record.role === "cc" || record.role === "bcc"
        ? (record.role as EmailThreadParticipant["role"])
        : undefined;
    const key = `${role ?? "_"}:${email.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    participants.push({
      name: typeof record.name === "string" ? record.name.trim() || null : null,
      email,
      role,
      isUser: typeof record.isUser === "boolean" ? record.isUser : undefined,
    });
  }

  return participants;
}

function normaliseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => Boolean(entry));
}

function normaliseUuidArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => Boolean(entry));
}

export function mapThreadRow(row: any): EmailThreadRecord {
  const now = () => new Date();

  const rollingSummary = normaliseThreadRollingSummary(row.rolling_summary ?? null);

  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : "",
    gmailThreadId: typeof row.gmail_thread_id === "string" ? row.gmail_thread_id : "",
    subjectCanonical: typeof row.subject_canonical === "string" ? row.subject_canonical : "",
    participants: normaliseParticipants(row.participants),
    messageCount: typeof row.message_count === "number" ? row.message_count : 0,
    firstMessageAt: coerceIsoString(row.first_message_at, now),
    lastMessageAt: coerceIsoString(row.last_message_at, now),
    unreadCount: typeof row.unread_count === "number" ? row.unread_count : 0,
    primaryLabel: typeof row.primary_label === "string" ? row.primary_label : null,
    labels: normaliseStringArray(row.labels),
    rollingSummary,
    lastSummarizedAt: coerceIsoStringOrNull(row.last_summarized_at),
    priorityScore:
      row.priority_score != null && row.priority_score !== ""
        ? Number(row.priority_score)
        : null,
    priorityComponents:
      row.priority_components && typeof row.priority_components === "object"
        ? (row.priority_components as Record<string, unknown>)
        : null,
    primaryProjectId:
      typeof row.primary_project_id === "string" ? row.primary_project_id : null,
    projectIds: normaliseUuidArray(row.project_ids),
    createdAt: coerceIsoString(row.created_at, now),
    updatedAt: coerceIsoString(row.updated_at, now),
  } satisfies EmailThreadRecord;
}

export type ThreadEmailDetail = ThreadEmailMessage;

export function mapThreadEmailRow(row: any): EmailRecord {
  return mapEmailRow(row);
}

export function mergeThreadEmailMetadata(
  email: EmailRecord,
  row: any,
  attachments?: EmailAttachmentRecord[] | null
): ThreadEmailDetail {
  const messageIndex =
    typeof row.message_index === "number"
      ? row.message_index
      : typeof row.message_index === "string"
      ? Number.parseInt(row.message_index, 10)
      : null;

  const referencesRaw = row.references ?? row.reference_ids;
  const references = normaliseStringArray(referencesRaw);

  return {
    ...email,
    attachments: attachments ?? email.attachments,
    hasAttachments: attachments ? attachments.length > 0 : email.hasAttachments,
    attachmentCount: attachments ? attachments.length : email.attachmentCount,
    messageIndex,
    gmailMessageId: typeof row.gmail_message_id === "string" ? row.gmail_message_id : null,
    gmailThreadId: typeof row.gmail_thread_id === "string" ? row.gmail_thread_id : null,
    inReplyTo: typeof row.in_reply_to === "string" ? row.in_reply_to : null,
    references,
  } satisfies ThreadEmailDetail;
}
