import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_EMAIL_SOURCE,
  ensureDefaultLabelCoverage,
  normaliseLabel,
  normaliseLabels,
  type EmailAttachmentRecord,
  type EmailProjectContext,
  type EmailRecord,
} from "@kazador/shared";

export const EMAIL_SELECT_COLUMNS =
  "id, user_id, from_name, from_email, subject, received_at, category, is_read, summary, labels, source, triage_state, triaged_at, snoozed_until, priority_score";

export function mapEmailRow(row: any): EmailRecord {
  const labels = ensureDefaultLabelCoverage(normaliseLabels(row.labels));
  const rawSource = typeof row.source === "string" ? (row.source.toLowerCase() as EmailRecord["source"]) : DEFAULT_EMAIL_SOURCE;
  const source = rawSource ?? DEFAULT_EMAIL_SOURCE;

  return {
    id: row.id as string,
    userId: (row.user_id as string) ?? null,
    fromName: (row.from_name as string) ?? null,
    fromEmail: row.from_email as string,
    subject: row.subject as string,
    receivedAt: String(row.received_at),
    category: normaliseLabel(row.category),
    isRead: Boolean(row.is_read),
    summary: row.summary ?? null,
    labels,
    priorityScore: row.priority_score != null ? Number(row.priority_score) : null,
    triageState: (row.triage_state as EmailRecord["triageState"]) ?? "unassigned",
    triagedAt: row.triaged_at ? String(row.triaged_at) : null,
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : null,
    source,
    attachments: null,
    linkedProjects: null,
    hasAttachments: null,
    attachmentCount: null,
  } satisfies EmailRecord;
}

export async function enrichEmailRecords(
  supabase: SupabaseClient,
  userId: string,
  emails: EmailRecord[]
): Promise<EmailRecord[]> {
  if (emails.length === 0) {
    return emails;
  }

  const emailIds = Array.from(new Set(emails.map((email) => email.id))).filter(Boolean);
  if (emailIds.length === 0) {
    return emails;
  }

  const attachmentsByEmail = new Map<string, EmailAttachmentRecord[]>();
  try {
    const { data: attachmentRows, error: attachmentError } = await supabase
      .from("email_attachments")
      .select(
        "id, email_id, filename, mime_type, size, storage_bucket, storage_path, sha256, metadata, created_at"
      )
      .in("email_id", emailIds);

    if (attachmentError) {
      console.error("Failed to load email attachments", attachmentError);
    } else {
      for (const row of attachmentRows ?? []) {
        const emailId = row.email_id as string | undefined;
        if (!emailId) continue;
        const record: EmailAttachmentRecord = {
          id: row.id as string,
          emailId,
          filename: row.filename as string,
          mimeType: (row.mime_type as string) ?? null,
          size: typeof row.size === "number" ? row.size : null,
          storageBucket: (row.storage_bucket as string) ?? null,
          storagePath: (row.storage_path as string) ?? null,
          sha256: (row.sha256 as string) ?? null,
          metadata: (row.metadata as Record<string, unknown>) ?? {},
          createdAt: String(row.created_at),
        };

        const list = attachmentsByEmail.get(emailId) ?? [];
        list.push(record);
        attachmentsByEmail.set(emailId, list);
      }
    }
  } catch (err) {
    console.error("Unexpected error loading email attachments", err);
  }

  const linkedProjectsByEmail = new Map<string, EmailProjectContext[]>();
  try {
    const { data: membershipRows, error: membershipError } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId);

    if (membershipError) {
      console.error("Failed to load project memberships", membershipError);
    } else {
      const accessibleProjectIds = Array.from(
        new Set((membershipRows ?? []).map((row) => row.project_id as string).filter(Boolean))
      );

      if (accessibleProjectIds.length > 0) {
        const { data: linkRows, error: linkError } = await supabase
          .from("project_email_links")
          .select("email_id, project_id, projects(id, name, color, status)")
          .in("email_id", emailIds)
          .in("project_id", accessibleProjectIds);

        if (linkError) {
          console.error("Failed to load project email links", linkError);
        } else {
          for (const row of linkRows ?? []) {
            const emailId = row.email_id as string | undefined;
            const project = (row.projects ?? row.project) as
              | { id?: string; name?: string; color?: string | null; status?: string }
              | undefined;

            if (!emailId || !project?.id) {
              continue;
            }

            const projectInfo: EmailProjectContext = {
              projectId: project.id,
              name: project.name ?? "Unnamed project",
              color: project.color ?? null,
              status: (project.status as EmailProjectContext["status"]) ?? "active",
            };

            const list = linkedProjectsByEmail.get(emailId) ?? [];
            if (!list.some((existing) => existing.projectId === projectInfo.projectId)) {
              list.push(projectInfo);
              linkedProjectsByEmail.set(emailId, list);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Unexpected error loading project links", err);
  }

  return emails.map((email) => {
    const attachments = attachmentsByEmail.get(email.id) ?? null;
    const linkedProjects = linkedProjectsByEmail.get(email.id) ?? null;
    return {
      ...email,
      attachments,
      linkedProjects,
      hasAttachments: attachments ? attachments.length > 0 : email.hasAttachments ?? null,
      attachmentCount: attachments ? attachments.length : email.attachmentCount ?? null,
    } satisfies EmailRecord;
  });
}
