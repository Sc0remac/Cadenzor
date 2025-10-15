import { config } from "dotenv";
config();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PRIORITY_CONFIG,
  buildDigestPayload,
  getPriorityConfig,
  ensureDefaultLabelCoverage,
  normaliseLabel,
  normaliseLabels,
  normalizePriorityConfigInput,
  getTimelineLaneForType,
  type DigestPayload,
  type ProjectRecord,
  type ProjectTaskRecord,
  type TimelineItemRecord,
  type TimelineDependencyRecord,
  type ApprovalRecord,
  type EmailRecord,
  type UserPreferenceRecord,
  type ProjectDigestMetrics,
  type PriorityConfig,
} from "@kazador/shared";

type ServiceClient = SupabaseClient<any, any, any>;

function parseJson<T>(value: any): T {
  if (value == null) return {} as T;
  if (typeof value === "object") return value as T;
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
  } satisfies ProjectRecord;
}

function mapTaskRow(row: any): ProjectTaskRecord {
  const laneRelation = row.lane ?? null;
  const laneId = (row.lane_id as string) ?? (laneRelation?.id as string) ?? null;
  const laneSlugValue = (row as Record<string, unknown>).lane_slug ?? laneRelation?.slug;
  const laneNameValue = (row as Record<string, unknown>).lane_name ?? laneRelation?.name;
  const laneColorValue = (row as Record<string, unknown>).lane_color ?? laneRelation?.color;
  const laneIconValue = (row as Record<string, unknown>).lane_icon ?? laneRelation?.icon;
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    status: row.status as ProjectTaskRecord["status"],
    dueAt: row.due_at ? String(row.due_at) : null,
    priority: row.priority != null ? Number(row.priority) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    assigneeId: (row.assignee_id as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    laneId,
    laneSlug: typeof laneSlugValue === "string" ? laneSlugValue : null,
    laneName: typeof laneNameValue === "string" ? laneNameValue : null,
    laneColor: typeof laneColorValue === "string" ? laneColorValue : null,
    laneIcon: typeof laneIconValue === "string" ? laneIconValue : null,
  } satisfies ProjectTaskRecord;
}

function mapTimelineItemRow(row: any): TimelineItemRecord {
  const type = row.type as TimelineItemRecord["type"];
  const labels = parseJson<TimelineItemRecord["labels"]>(row.labels);
  const priorityComponentsRaw = row.priority_components != null
    ? parseJson<TimelineItemRecord["priorityComponents"]>(row.priority_components)
    : null;
  const priorityComponents = priorityComponentsRaw && Object.keys(priorityComponentsRaw).length > 0 ? priorityComponentsRaw : null;
  const links = parseJson<TimelineItemRecord["links"]>(row.links);
  const lane = (row.lane as TimelineItemRecord["lane"]) ?? getTimelineLaneForType(type);
  const conflictFlags = row.conflict_flags ?? null;
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    type,
    lane,
    kind: (row.kind as string) ?? null,
    title: row.title as string,
    description: (row.description as string) ?? null,
    startsAt: row.start_at ? String(row.start_at) : null,
    endsAt: row.end_at ? String(row.end_at) : null,
    dueAt: row.due_at ? String(row.due_at) : null,
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
  } satisfies TimelineItemRecord;
}

function mapTimelineDependencyRow(row: any): TimelineDependencyRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    fromItemId: row.from_item_id as string,
    toItemId: row.to_item_id as string,
    kind: row.kind as TimelineDependencyRecord["kind"],
    note: (row.note as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  } satisfies TimelineDependencyRecord;
}

function mapApprovalRow(row: any): ApprovalRecord {
  return {
    id: row.id as string,
    projectId: (row.project_id as string) ?? null,
    type: row.type as ApprovalRecord["type"],
    status: row.status as ApprovalRecord["status"],
    payload: parseJson(row.payload),
    requestedBy: (row.requested_by as string) ?? null,
    createdBy: (row.created_by as string) ?? null,
    approverId: (row.approver_id as string) ?? null,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    declinedAt: row.declined_at ? String(row.declined_at) : null,
    resolutionNote: (row.resolution_note as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  } satisfies ApprovalRecord;
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
    priorityScore: row.priority_score != null ? Number(row.priority_score) : null,
    triageState: (row.triage_state as EmailRecord["triageState"]) ?? "unassigned",
    triagedAt: row.triaged_at ? String(row.triaged_at) : null,
  } satisfies EmailRecord;
}

function mapPreferenceRow(row: any): UserPreferenceRecord {
  const channels = Array.isArray(row.channels)
    ? (row.channels as string[])
    : parseJson<string[]>(row.channels);
  const quietHours = row.quiet_hours ? parseJson<Record<string, unknown>>(row.quiet_hours) : null;
  const rawPriorityConfig = row.priority_config ?? null;
  let priorityConfig = DEFAULT_PRIORITY_CONFIG;
  let priorityConfigSource: UserPreferenceRecord["priorityConfigSource"] = "default";

  if (rawPriorityConfig) {
    try {
      const parsed = typeof rawPriorityConfig === "object" ? rawPriorityConfig : JSON.parse(String(rawPriorityConfig));
      priorityConfig = normalizePriorityConfigInput(parsed);
      priorityConfigSource = "custom";
    } catch (err) {
      priorityConfig = DEFAULT_PRIORITY_CONFIG;
      priorityConfigSource = "default";
    }
  }

  const priorityConfigUpdatedAt = row.priority_config_updated_at
    ? String(row.priority_config_updated_at)
    : row.updated_at
    ? String(row.updated_at)
    : null;

  return {
    id: row.id as string,
    userId: row.user_id as string,
    digestFrequency: (row.digest_frequency as UserPreferenceRecord["digestFrequency"]) ?? "daily",
    digestHour: row.digest_hour != null ? Number(row.digest_hour) : 8,
    timezone: (row.timezone as string) ?? "UTC",
    channels,
    quietHours,
    priorityConfig,
    priorityConfigSource,
    priorityConfigUpdatedAt,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  } satisfies UserPreferenceRecord;
}

function deriveMetrics(profile: Record<string, unknown> | null): Partial<ProjectDigestMetrics> | undefined {
  if (!profile) return undefined;
  const metrics = profile.metrics as Record<string, unknown> | undefined;
  if (!metrics) return undefined;
  const result: Partial<ProjectDigestMetrics> = {};
  if (typeof metrics.openTaskCount === "number") result.openTasks = metrics.openTaskCount;
  if (typeof metrics.upcomingTimelineCount === "number") result.upcomingTimeline = metrics.upcomingTimelineCount;
  if (typeof metrics.linkedEmailCount === "number") result.linkedEmails = metrics.linkedEmailCount;
  if (typeof metrics.conflictCount === "number") result.conflicts = metrics.conflictCount;
  if (typeof metrics.healthScore === "number") result.healthScore = metrics.healthScore;
  if (typeof metrics.healthTrend === "string") result.trend = metrics.healthTrend as ProjectDigestMetrics["trend"];
  return result;
}

async function getClient(): Promise<ServiceClient> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for digest job");
  }
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function ensurePreference(client: ServiceClient, userId: string): Promise<UserPreferenceRecord> {
  const { data, error } = await client
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return mapPreferenceRow(data);
  }

  const { data: inserted, error: insertError } = await client
    .from("user_preferences")
    .insert({ user_id: userId })
    .select("*")
    .maybeSingle();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to provision user preferences");
  }

  return mapPreferenceRow(inserted);
}

async function loadProjectsForUser(client: ServiceClient, userId: string) {
  const { data: memberRows, error: memberError } = await client
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId);

  if (memberError) throw memberError;

  const projectIds = Array.from(
    new Set((memberRows ?? []).map((row) => row.project_id as string).filter(Boolean))
  );

  if (projectIds.length === 0) {
    return [] as Array<ReturnType<typeof mapProjectRow>>;
  }

  const { data: projectRows, error: projectError } = await client
    .from("projects")
    .select("*")
    .in("id", projectIds);

  if (projectError) throw projectError;

  return (projectRows ?? []).map(mapProjectRow);
}

async function buildDigestForUser(
  client: ServiceClient,
  userId: string,
  priorityConfig: PriorityConfig = DEFAULT_PRIORITY_CONFIG
) {
  const projects = await loadProjectsForUser(client, userId);
  if (projects.length === 0) {
    const payload = buildDigestPayload({ projects: [], now: new Date(), priorityConfig });
    return { payload, projects }; // used for empty digest
  }

  const projectIds = projects.map((project) => project.id);

  const [tasksRes, timelineRes, dependenciesRes, approvalsRes, emailLinksRes] = await Promise.all([
    client
      .from("project_tasks")
      .select("*, lane:lane_definitions(id, slug, name, color, icon)")
      .in("project_id", projectIds),
    client
      .from("timeline_entries")
      .select("*")
      .in("project_id", projectIds),
    client
      .from("timeline_dependencies")
      .select("*")
      .in("project_id", projectIds),
    client
      .from("approvals")
      .select("*")
      .in("project_id", projectIds)
      .eq("status", "pending"),
    client
      .from("project_email_links")
      .select("project_id, email_id")
      .in("project_id", projectIds),
  ]);

  if (tasksRes.error) throw tasksRes.error;
  if (timelineRes.error) throw timelineRes.error;
  if (dependenciesRes.error) throw dependenciesRes.error;
  if (approvalsRes.error) throw approvalsRes.error;
  if (emailLinksRes.error) throw emailLinksRes.error;

  const tasksByProject = new Map<string, ProjectTaskRecord[]>();
  const timelineByProject = new Map<string, TimelineItemRecord[]>();
  const depByProject = new Map<string, TimelineDependencyRecord[]>();
  const approvalsByProject = new Map<string, ApprovalRecord[]>();
  const emailIdsByProject = new Map<string, Set<string>>();
  const emailIdAccumulator: string[] = [];

  for (const row of tasksRes.data ?? []) {
    const mapped = mapTaskRow(row);
    const list = tasksByProject.get(mapped.projectId) ?? [];
    list.push(mapped);
    tasksByProject.set(mapped.projectId, list);
  }

  for (const row of timelineRes.data ?? []) {
    const mapped = mapTimelineItemRow(row);
    const list = timelineByProject.get(mapped.projectId) ?? [];
    list.push(mapped);
    timelineByProject.set(mapped.projectId, list);
  }

  for (const row of dependenciesRes.data ?? []) {
    const mapped = mapTimelineDependencyRow(row);
    const list = depByProject.get(mapped.projectId) ?? [];
    list.push(mapped);
    depByProject.set(mapped.projectId, list);
  }

  for (const row of approvalsRes.data ?? []) {
    if (!row.project_id) continue;
    const mapped = mapApprovalRow(row);
    const list = approvalsByProject.get(mapped.projectId ?? "") ?? [];
    list.push(mapped);
    approvalsByProject.set(mapped.projectId ?? "", list);
  }

  for (const row of emailLinksRes.data ?? []) {
    const projectId = row.project_id as string | null;
    const emailId = row.email_id as string | null;
    if (!projectId || !emailId) continue;
    emailIdAccumulator.push(emailId);
    const set = emailIdsByProject.get(projectId) ?? new Set<string>();
    set.add(emailId);
    emailIdsByProject.set(projectId, set);
  }

  let emailsById = new Map<string, EmailRecord>();
  if (emailIdAccumulator.length > 0) {
    const { data: emailRows, error: emailError } = await client
      .from("emails")
      .select(
        "id, from_name, from_email, subject, received_at, category, is_read, summary, labels, triage_state, triaged_at, priority_score"
      )
      .in("id", Array.from(new Set(emailIdAccumulator)));
    if (emailError) throw emailError;
    if (emailRows) {
      emailsById = new Map(emailRows.map((row: any) => [row.id as string, mapEmailRow(row)]));
    }
  }

  const digestProjects = projects.map((project) => {
    const metrics = deriveMetrics(project.priorityProfile ?? null);
    const emailSet = emailIdsByProject.get(project.id) ?? new Set<string>();
    const emails = Array.from(emailSet)
      .map((emailId) => emailsById.get(emailId))
      .filter((email): email is EmailRecord => Boolean(email))
      .filter((email) => email.triageState !== "resolved");

    return {
      project,
      tasks: tasksByProject.get(project.id) ?? [],
      timelineItems: timelineByProject.get(project.id) ?? [],
      dependencies: depByProject.get(project.id) ?? [],
      approvals: approvalsByProject.get(project.id) ?? [],
      emails,
      metrics,
    };
  });

  const payload = buildDigestPayload({
    projects: digestProjects,
    now: new Date(),
    perProjectLimit: 5,
    topActionLimit: 12,
    priorityConfig,
  });

  return { payload, projects: digestProjects };
}

async function persistDigest(
  client: ServiceClient,
  userId: string,
  generatedFor: string,
  channel: "web" | "email" | "slack",
  payload: DigestPayload,
  status: "generated" | "queued" | "sent" | "failed" = "generated"
) {
  await client
    .from("digests")
    .upsert(
      {
        user_id: userId,
        generated_for: generatedFor,
        channel,
        status,
        payload,
      },
      { onConflict: "user_id,generated_for,channel" }
    );
}

async function recordAction(client: ServiceClient, userId: string, generatedFor: string, payload: DigestPayload, channel: string) {
  await client.from("action_logs").insert({
    user_id: userId,
    action: "digest.generated",
    project_id: null,
    ref_id: `${generatedFor}:${channel}`,
    metadata: {
      channel,
      projects: payload.projects.length,
      topActions: payload.topActions.length,
    },
  });
}

async function generateDailyDigests(): Promise<void> {
  const client = await getClient();

  const { data: memberRows, error: memberError } = await client
    .from("project_members")
    .select("user_id")
    .not("user_id", "is", null);

  if (memberError) {
    throw memberError;
  }

  const userIds = Array.from(new Set((memberRows ?? []).map((row) => row.user_id as string).filter(Boolean)));

  const now = new Date();
  const generatedFor = now.toISOString().slice(0, 10);

  for (const userId of userIds) {
    try {
      const preferences = await ensurePreference(client, userId);
      if (preferences.digestFrequency === "off") {
        continue;
      }

      const { payload } = await buildDigestForUser(client, userId, preferences.priorityConfig);

      if (preferences.channels.includes("web")) {
        await persistDigest(client, userId, generatedFor, "web", payload, "generated");
        await recordAction(client, userId, generatedFor, payload, "web");
      }

      if (preferences.channels.includes("email")) {
        await persistDigest(client, userId, generatedFor, "email", payload, "queued");
        await recordAction(client, userId, generatedFor, payload, "email");
      }

      if (preferences.channels.includes("slack")) {
        await persistDigest(client, userId, generatedFor, "slack", payload, "queued");
        await recordAction(client, userId, generatedFor, payload, "slack");
      }
    } catch (err) {
      console.error(`[digest] Failed for user ${userId}`, err);
      await client.from("action_logs").insert({
        user_id: userId,
        action: "digest.failed",
        project_id: null,
        ref_id: generatedFor,
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}

const isExecutedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    const current = fileURLToPath(import.meta.url);
    return current === process.argv[1];
  } catch (err) {
    return false;
  }
})();

if (isExecutedDirectly) {
  generateDailyDigests()
    .then(() => {
      console.log("Digest generation completed");
    })
    .catch((err) => {
      console.error("Digest generation failed", err);
      process.exitCode = 1;
    });
}

export { generateDailyDigests };
