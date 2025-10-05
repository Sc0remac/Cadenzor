import { config } from "dotenv";
config();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  suggestProjectsForEmail,
  ensureDefaultLabelCoverage,
  normaliseLabels,
  normaliseLabel,
  type EmailRecord,
  type ProjectRecord,
} from "@cadenzor/shared";

type ServiceSupabase = SupabaseClient<any, any, any>;

interface Metrics {
  openTaskCount: number;
  upcomingTimelineCount: number;
  linkedEmailCount: number;
  sourceCount: number;
  memberCount: number;
  refreshedAt: string;
}

const ORIGIN = "projectMetricsRefresh";

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

function mapProjectRow(row: any): ProjectRecord {
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

function mapEmailRow(row: any): EmailRecord {
  const labels = ensureDefaultLabelCoverage(normaliseLabels(row.labels));
  return {
    id: row.id as string,
    fromName: (row.from_name as string) ?? null,
    fromEmail: row.from_email as string,
    subject: row.subject as string,
    receivedAt: String(row.received_at),
    category: normaliseLabel(row.category),
    isRead: Boolean(row.is_read),
    summary: row.summary ?? null,
    labels,
  };
}

async function getSupabaseClient(): Promise<ServiceSupabase> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for project jobs");
  }

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function countRows(client: ServiceSupabase, table: string, filters: Record<string, unknown> = {}) {
  let query = client.from(table).select("id", { count: "exact", head: true });

  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value as never);
  }

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function countUpcomingTimeline(client: ServiceSupabase, projectId: string) {
  const nowIso = new Date().toISOString();
  const { count, error } = await client
    .from("timeline_items")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .gte("starts_at", nowIso);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function refreshProjectMetrics(projectId: string) {
  const client = await getSupabaseClient();

  const openTaskPromise = client
    .from("project_tasks")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .neq("status", "done")
    .neq("status", "completed");

  const [openTasks, timelineCount, emailCount, sourceCount, memberCount, projectRow] = await Promise.all([
    openTaskPromise.then(({ count, error }) => {
      if (error) throw error;
      return count ?? 0;
    }),
    countUpcomingTimeline(client, projectId),
    countRows(client, "project_email_links", { project_id: projectId }),
    countRows(client, "project_sources", { project_id: projectId }),
    countRows(client, "project_members", { project_id: projectId }),
    client
      .from("projects")
      .select("id, priority_profile")
      .eq("id", projectId)
      .maybeSingle(),
  ]);

  if (projectRow.error) {
    throw projectRow.error;
  }

  const existingProfile = (projectRow.data?.priority_profile as Record<string, unknown> | null) ?? {};
  const metrics: Metrics = {
    openTaskCount: openTasks,
    upcomingTimelineCount: timelineCount,
    linkedEmailCount: emailCount,
    sourceCount,
    memberCount,
    refreshedAt: new Date().toISOString(),
  };

  const updatedProfile = {
    ...existingProfile,
    metrics,
    last_origin: ORIGIN,
  };

  const { error: updateError } = await client
    .from("projects")
    .update({ priority_profile: updatedProfile })
    .eq("id", projectId);

  if (updateError) {
    throw updateError;
  }

  console.log(`[projects] Updated metrics for ${projectId}`, metrics);
}

async function refreshAllProjects() {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("projects")
    .select("id")
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    const projectId = row.id as string;
    try {
      await refreshProjectMetrics(projectId);
    } catch (err) {
      console.error(`[projects] Failed to refresh metrics for ${projectId}`, err);
    }
  }
}

function shouldBootstrapTimeline(labels: string[] | undefined): boolean {
  if (!labels || labels.length === 0) {
    return false;
  }
  return labels.some((label) => {
    const upper = label.toUpperCase();
    return (
      upper.startsWith("LOGISTICS/") ||
      upper.startsWith("BOOKING/") ||
      upper.startsWith("PROMO/" ) ||
      upper.startsWith("LEGAL/")
    );
  });
}

function inferTimelineDefaults(label: string | undefined | null) {
  if (!label) {
    return { type: "event", lane: "General" } as const;
  }
  const upper = label.toUpperCase();
  if (upper.startsWith("LOGISTICS/")) {
    return { type: "event", lane: "Live" } as const;
  }
  if (upper.startsWith("BOOKING/")) {
    return { type: "hold", lane: "Live" } as const;
  }
  if (upper.startsWith("PROMO/")) {
    return { type: "task", lane: "Promo" } as const;
  }
  if (upper.startsWith("ASSETS/")) {
    return { type: "task", lane: "Brand" } as const;
  }
  return { type: "event", lane: "General" } as const;
}

export async function suggestProjectLinksForEmail(emailId: string, limit = 3) {
  const client = await getSupabaseClient();

  const { data: emailRow, error: emailError } = await client
    .from("emails")
    .select("id, subject, summary, from_name, from_email, received_at, category, is_read, labels")
    .eq("id", emailId)
    .maybeSingle();

  if (emailError) {
    throw emailError;
  }

  if (!emailRow) {
    throw new Error(`Email ${emailId} not found`);
  }

  const email = mapEmailRow(emailRow);

  const { data: projectRows, error: projectError } = await client
    .from("projects")
    .select("*")
    .not("status", "eq", "archived");

  if (projectError) {
    throw projectError;
  }

  const projects = (projectRows ?? []).map(mapProjectRow);

  if (projects.length === 0) {
    return [];
  }

  const [{ data: linkedRows, error: linkError }, { data: pendingRows, error: pendingError }] = await Promise.all([
    client
      .from("project_email_links")
      .select("project_id")
      .eq("email_id", emailId),
    client
      .from("approvals")
      .select("project_id")
      .eq("type", "project_email_link")
      .eq("status", "pending")
      .eq("payload->>emailId", emailId),
  ]);

  if (linkError) {
    throw linkError;
  }
  if (pendingError) {
    throw pendingError;
  }

  const exclude = new Set<string>();
  for (const row of linkedRows ?? []) {
    if (row.project_id) exclude.add(row.project_id as string);
  }
  for (const row of pendingRows ?? []) {
    if (row.project_id) exclude.add(row.project_id as string);
  }

  const suggestions = suggestProjectsForEmail(email, projects, {
    excludeProjectIds: exclude,
    limit,
  });

  if (suggestions.length === 0) {
    return [];
  }

  const approvalPayloads = suggestions.map((suggestion) => {
    const confidence = Math.max(0.1, Math.min(0.95, suggestion.score / 100));
    const shouldCreateTimeline = shouldBootstrapTimeline(email.labels);
    return {
      project_id: suggestion.project.id,
      type: "project_email_link",
      status: "pending",
      payload: {
        projectId: suggestion.project.id,
        emailId,
        score: suggestion.score,
        confidence,
        rationales: suggestion.rationales,
        emailSubject: email.subject,
        emailReceivedAt: email.receivedAt,
        primaryLabel: email.labels?.[0] ?? email.category,
        shouldCreateTimeline,
      },
    };
  });

  for (const row of approvalPayloads) {
    await client.from("approvals").insert(row);
  }

  console.log(
    `[approvals] queued ${approvalPayloads.length} suggestion(s) for email ${emailId}`,
    approvalPayloads.map((row) => ({ projectId: row.project_id, score: row.payload.score }))
  );

  return approvalPayloads;
}

async function applyProjectEmailLink(
  client: SupabaseClient,
  approvalRow: any,
  actorId: string | null,
  payload: Record<string, unknown>
) {
  const projectId = String(payload.projectId ?? approvalRow.project_id);
  const emailId = String(payload.emailId);
  const confidence = typeof payload.confidence === "number" ? payload.confidence : null;
  const source = typeof payload.source === "string" ? payload.source : "ai";

  await client
    .from("project_email_links")
    .upsert({
      project_id: projectId,
      email_id: emailId,
      confidence,
      source,
    }, { onConflict: "project_id,email_id" });

  if (payload.shouldCreateTimeline) {
    const { data: emailRow, error: emailError } = await client
      .from("emails")
      .select("id, subject, received_at, labels")
      .eq("id", emailId)
      .maybeSingle();

    if (emailError) {
      throw emailError;
    }

    if (emailRow) {
      const email = mapEmailRow(emailRow);
      const defaults = inferTimelineDefaults(String(payload.primaryLabel ?? email.labels?.[0] ?? ""));
      const insertPayload: Record<string, unknown> = {
        project_id: projectId,
        title: email.subject,
        type: defaults.type,
        lane: defaults.lane,
        starts_at: email.receivedAt,
        priority: 50,
        metadata: {
          source: "email",
          approvalId: approvalRow.id,
        },
        ref_table: "emails",
        ref_id: email.id,
        created_by: actorId,
      };

      await client.from("timeline_items").insert(insertPayload);
    }
  }
}

export async function applyApproval(
  approvalId: string,
  action: "approve" | "decline" = "approve",
  actorId?: string
) {
  const client = await getSupabaseClient();
  const { data: approvalRow, error } = await client
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!approvalRow) {
    throw new Error(`Approval ${approvalId} not found`);
  }

  if (approvalRow.status !== "pending") {
    return approvalRow;
  }

  const payload = (approvalRow.payload as Record<string, unknown>) ?? {};
  const approverId = actorId ?? (approvalRow.approver_id as string | null) ?? null;

  if (action === "approve") {
    switch (approvalRow.type) {
      case "project_email_link":
        await applyProjectEmailLink(client, approvalRow, approverId, payload);
        break;
      default:
        break;
    }
  }

  const nowIso = new Date().toISOString();
  const updateFields: Record<string, unknown> = {
    status: action === "approve" ? "approved" : "declined",
    approver_id: approverId,
    resolution_note: null,
    updated_at: nowIso,
  };

  if (action === "approve") {
    updateFields["approved_at"] = nowIso;
  } else {
    updateFields["declined_at"] = nowIso;
  }

  await client.from("approvals").update(updateFields).eq("id", approvalId);
  console.log(`[approvals] ${action}d approval ${approvalId}`);

  return updateFields;
}

if (require.main === module) {
  refreshAllProjects()
    .then(() => {
      console.log("Project metrics refresh complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Project metrics refresh failed", err);
      process.exit(1);
    });
}
