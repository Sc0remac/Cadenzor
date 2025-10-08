import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  mapProjectRow,
  mapProjectTaskRow,
  mapTimelineItemRow,
  mapTimelineDependencyRow,
  mapApprovalRow,
} from "@/lib/projectMappers";
import {
  buildDigestPayload,
  ensureDefaultLabelCoverage,
  normaliseLabels,
  normaliseLabel,
  type DigestPayload,
  type UserPreferenceRecord,
  type ProjectDigestMetrics,
  type EmailRecord,
} from "@cadenzor/shared";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parseJson<T>(value: any): T {
  if (value == null) return {} as T;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch (err) {
    return {} as T;
  }
}

function mapPreferenceRow(row: any): UserPreferenceRecord {
  const channels = Array.isArray(row.channels)
    ? (row.channels as string[])
    : parseJson<string[]>(row.channels);

  const quietHours = row.quiet_hours ? parseJson<Record<string, unknown>>(row.quiet_hours) : null;

  return {
    id: row.id as string,
    userId: row.user_id as string,
    digestFrequency: (row.digest_frequency as UserPreferenceRecord["digestFrequency"]) ?? "daily",
    digestHour: row.digest_hour != null ? Number(row.digest_hour) : 8,
    timezone: (row.timezone as string) ?? "UTC",
    channels,
    quietHours,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  } satisfies UserPreferenceRecord;
}

function deriveMetricsFromProfile(profile: Record<string, unknown> | null): Partial<ProjectDigestMetrics> | undefined {
  if (!profile || typeof profile !== "object") {
    return undefined;
  }
  const metrics = profile.metrics as Record<string, unknown> | undefined;
  if (!metrics) {
    return undefined;
  }

  const snapshot: Partial<ProjectDigestMetrics> = {};
  if (typeof metrics.openTaskCount === "number") snapshot.openTasks = metrics.openTaskCount;
  if (typeof metrics.upcomingTimelineCount === "number") snapshot.upcomingTimeline = metrics.upcomingTimelineCount;
  if (typeof metrics.linkedEmailCount === "number") snapshot.linkedEmails = metrics.linkedEmailCount;
  if (typeof metrics.conflictCount === "number") snapshot.conflicts = metrics.conflictCount;
  if (typeof metrics.healthScore === "number") snapshot.healthScore = metrics.healthScore;
  if (typeof metrics.healthTrend === "string") snapshot.trend = metrics.healthTrend as ProjectDigestMetrics["trend"];

  return snapshot;
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

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const [{ data: prefRow, error: prefError }, { data: membershipRows, error: membershipError }] = await Promise.all([
    supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("project_members")
      .select("project_id, role")
      .eq("user_id", user.id),
  ]);

  if (prefError) {
    return formatError(prefError.message, 500);
  }
  if (membershipError) {
    return formatError(membershipError.message, 500);
  }

  let preferences: UserPreferenceRecord | null = prefRow ? mapPreferenceRow(prefRow) : null;

  if (!preferences) {
    const { data: insertedPref, error: insertPrefError } = await supabase
      .from("user_preferences")
      .insert({ user_id: user.id })
      .select("*")
      .maybeSingle();
    if (insertPrefError) {
      return formatError(insertPrefError.message, 500);
    }
    preferences = insertedPref ? mapPreferenceRow(insertPref) : null;
  }

  const projectIds = Array.from(
    new Set((membershipRows ?? []).map((row) => row.project_id as string).filter((value): value is string => Boolean(value)))
  );

  const now = new Date();

  if (projectIds.length === 0) {
    const digest = buildDigestPayload({ projects: [], now });
    return NextResponse.json({
      digest,
      preferences,
      generatedFor: now.toISOString().slice(0, 10),
    });
  }

  const [
    projectsRes,
    tasksRes,
    timelineRes,
    dependenciesRes,
    approvalsRes,
    emailLinkRes,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .in("id", projectIds),
    supabase
      .from("project_tasks")
      .select("*")
      .in("project_id", projectIds),
    supabase
      .from("timeline_items")
      .select("*")
      .in("project_id", projectIds),
    supabase
      .from("timeline_dependencies")
      .select("*")
      .in("project_id", projectIds),
    supabase
      .from("approvals")
      .select("*")
      .in("project_id", projectIds)
      .eq("status", "pending"),
    supabase
      .from("project_email_links")
      .select("project_id, email_id")
      .in("project_id", projectIds),
  ]);

  if (projectsRes.error) return formatError(projectsRes.error.message, 500);
  if (tasksRes.error) return formatError(tasksRes.error.message, 500);
  if (timelineRes.error) return formatError(timelineRes.error.message, 500);
  if (dependenciesRes.error) return formatError(dependenciesRes.error.message, 500);
  if (approvalsRes.error) return formatError(approvalsRes.error.message, 500);
  if (emailLinkRes.error) return formatError(emailLinkRes.error.message, 500);

  const projects = (projectsRes.data ?? []).map(mapProjectRow);
  const tasksByProject = new Map<string, ReturnType<typeof mapProjectTaskRow>[]>();
  const timelineByProject = new Map<string, ReturnType<typeof mapTimelineItemRow>[]>();
  const dependenciesByProject = new Map<string, ReturnType<typeof mapTimelineDependencyRow>[]>();
  const approvalsByProject = new Map<string, ReturnType<typeof mapApprovalRow>[]>();
  const emailIds: string[] = [];
  const emailIdsByProject = new Map<string, Set<string>>();

  for (const row of tasksRes.data ?? []) {
    const mapped = mapProjectTaskRow(row);
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
    const list = dependenciesByProject.get(mapped.projectId) ?? [];
    list.push(mapped);
    dependenciesByProject.set(mapped.projectId, list);
  }

  for (const row of approvalsRes.data ?? []) {
    if (!row.project_id) continue;
    const mapped = mapApprovalRow(row);
    const list = approvalsByProject.get(mapped.projectId ?? "") ?? [];
    list.push(mapped);
    approvalsByProject.set(mapped.projectId ?? "", list);
  }

  for (const row of emailLinkRes.data ?? []) {
    const projectId = row.project_id as string | null;
    const emailId = row.email_id as string | null;
    if (!projectId || !emailId) continue;
    emailIds.push(emailId);
    const existing = emailIdsByProject.get(projectId) ?? new Set<string>();
    existing.add(emailId);
    emailIdsByProject.set(projectId, existing);
  }

  let emailsById = new Map<string, EmailRecord>();
  if (emailIds.length > 0) {
    const { data: emailRows, error: emailError } = await supabase
      .from("emails")
      .select(
        "id, from_name, from_email, subject, received_at, category, is_read, summary, labels, triage_state, triaged_at, priority_score"
      )
      .in("id", Array.from(new Set(emailIds)));
    if (emailError) {
      return formatError(emailError.message, 500);
    }
    if (emailRows) {
      emailsById = new Map(emailRows.map((row: any) => [row.id as string, mapEmailRow(row)]));
    }
  }

  const digestProjects = projects.map((project) => {
    const metrics = deriveMetricsFromProfile(project.priorityProfile ?? null);
    const emailSet = emailIdsByProject.get(project.id) ?? new Set<string>();
    const emails = Array.from(emailSet)
      .map((emailId) => emailsById.get(emailId))
      .filter((email): email is EmailRecord => Boolean(email))
      .filter((email) => email.triageState !== "resolved");

    return {
      project,
      tasks: tasksByProject.get(project.id) ?? [],
      timelineItems: timelineByProject.get(project.id) ?? [],
      dependencies: dependenciesByProject.get(project.id) ?? [],
      approvals: approvalsByProject.get(project.id) ?? [],
      emails,
      metrics,
    };
  });

  const digest = buildDigestPayload({
    projects: digestProjects,
    now,
    perProjectLimit: 5,
    topActionLimit: 12,
  });

  const generatedFor = now.toISOString().slice(0, 10);

  await supabase
    .from("digests")
    .upsert(
      {
        user_id: user.id,
        generated_for: generatedFor,
        channel: "web",
        status: "generated",
        payload: digest as DigestPayload,
      },
      { onConflict: "user_id,generated_for,channel" }
    );

  await supabase.from("action_logs").insert({
    user_id: user.id,
    action: "digest.generated",
    project_id: null,
    ref_id: generatedFor,
    metadata: {
      channel: "web",
      projects: digestProjects.length,
      topActions: digest.topActions.length,
    },
  });

  return NextResponse.json({ digest, preferences, generatedFor });
}
