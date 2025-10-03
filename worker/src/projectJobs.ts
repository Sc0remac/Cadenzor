import { config } from "dotenv";
config();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { suggestProjectsForEmail } from "@cadenzor/shared";
import type { ApprovalRecord, ProjectRecord } from "@cadenzor/shared";
import { applyApproval as applyApprovalAction, type ApplyResponse } from "../../app/lib/approvalActions";
import { mapApprovalRow as mapApprovalRowApp } from "../../app/lib/projectMappers";

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
    slug: (row.slug as string) ?? "",
    description: (row.description as string) ?? null,
    status: row.status as ProjectRecord["status"],
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    color: (row.color as string) ?? null,
    labels: parseJson(row.labels),
    priorityProfile: row.priority_profile ?? null,
    createdBy: (row.created_by as string) ?? null,
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
    updatedAt: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
  };
}

function mapApprovalRow(row: any): ApprovalRecord {
  return mapApprovalRowApp(row);
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

export async function suggestProjectLinksForEmail(emailId: string): Promise<void> {
  const client = await getSupabaseClient();

  const { data: emailRow, error: emailError } = await client
    .from("emails")
    .select("id, subject, summary, labels, from_email, from_name, received_at, category")
    .eq("id", emailId)
    .maybeSingle();

  if (emailError) {
    throw emailError;
  }

  if (!emailRow) {
    console.warn(`[projects] Email ${emailId} not found for suggestions`);
    return;
  }

  const { data: projectRows, error: projectError } = await client
    .from("projects")
    .select(
      "id, artist_id, name, slug, description, status, start_date, end_date, color, labels, priority_profile, created_by, created_at, updated_at"
    )
    .in("status", ["active", "paused"]);

  if (projectError) {
    throw projectError;
  }

  const projects = (projectRows ?? []).map(mapProjectRow);

  const suggestions = suggestProjectsForEmail(
    projects,
    {
      subject: (emailRow.subject as string) ?? "",
      summary: (emailRow.summary as string) ?? null,
      labels: emailRow.labels ?? [],
      fromEmail: (emailRow.from_email as string) ?? null,
      fromName: (emailRow.from_name as string) ?? null,
      category: (emailRow.category as string) ?? null,
      receivedAt: (emailRow.received_at as string) ?? null,
    },
    { limit: 3, threshold: 40 }
  );

  if (suggestions.length === 0) {
    return;
  }

  const { data: existingLinks, error: linksError } = await client
    .from("project_email_links")
    .select("project_id")
    .eq("email_id", emailId);

  if (linksError) {
    throw linksError;
  }

  const linkedProjectIds = new Set<string>((existingLinks ?? []).map((row: any) => row.project_id as string));

  for (const suggestion of suggestions) {
    if (linkedProjectIds.has(suggestion.project.id)) {
      continue;
    }

    const { data: existingApproval, error: approvalLookupError } = await client
      .from("approvals")
      .select("id")
      .eq("project_id", suggestion.project.id)
      .eq("type", "project_email_link")
      .eq("status", "pending")
      .eq("payload->>emailId", emailId)
      .maybeSingle();

    if (approvalLookupError) {
      console.error(
        `[projects] Failed to check existing approval for ${suggestion.project.id} and email ${emailId}`,
        approvalLookupError
      );
      continue;
    }

    if (existingApproval) {
      continue;
    }

    const payload = {
      emailId,
      subject: emailRow.subject ?? null,
      fromEmail: emailRow.from_email ?? null,
      fromName: emailRow.from_name ?? null,
      category: emailRow.category ?? null,
      labels: emailRow.labels ?? [],
      summary: emailRow.summary ?? null,
      score: suggestion.score,
      confidence: suggestion.confidence,
      rationales: suggestion.rationales,
      timelineItem: suggestion.timelineItem ?? null,
      suggestedAt: new Date().toISOString(),
      source: "worker",
    };

    const { error: insertError } = await client.from("approvals").insert({
      project_id: suggestion.project.id,
      type: "project_email_link",
      payload,
    });

    if (insertError) {
      console.error(
        `[projects] Failed to queue approval for ${suggestion.project.id} to link email ${emailId}`,
        insertError
      );
    } else {
      console.log(
        `[projects] Suggested linking email ${emailId} to project ${suggestion.project.name} (score=${suggestion.score})`
      );
    }
  }
}

export async function applyApprovalById(
  approvalId: string,
  approverId: string
): Promise<ApplyResponse> {
  const client = await getSupabaseClient();

  const { data, error } = await client
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return { ok: false, error: "Approval not found", status: 404 };
  }

  const approval: ApprovalRecord = mapApprovalRow(data);
  return applyApprovalAction(client, approval, approverId);
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
