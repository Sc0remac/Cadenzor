import { config } from "dotenv";
config();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
