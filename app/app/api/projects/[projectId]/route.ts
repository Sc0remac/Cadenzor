import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../lib/projectAccess";
import {
  mapProjectRow,
  mapProjectMemberRow,
  mapProjectSourceRow,
  mapAssetRow,
  mapAssetLinkRow,
  mapTimelineItemRow,
  mapProjectTaskRow,
  mapProjectItemLinkRow,
  mapProjectEmailLinkRow,
  mapTimelineDependencyRow,
  mapApprovalRow,
} from "../../../../lib/projectMappers";
import type { ProjectRecord, EmailRecord } from "@cadenzor/shared";
import {
  ensureDefaultLabelCoverage,
  normaliseLabel,
  normaliseLabels,
  detectTimelineConflicts,
  computeTopActions,
} from "@cadenzor/shared";

interface Params {
  params: {
    projectId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request, { params }: Params) {
  const { projectId } = params;
  if (!projectId) {
    return formatError("Project id is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  try {
    await assertProjectRole(supabase, projectId, user.id, "viewer");
  } catch (err: any) {
    const status = err?.status ?? 403;
    return formatError(err?.message || "Forbidden", status);
  }

  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    return formatError(projectError.message, 500);
  }

  if (!projectRow) {
    return formatError("Project not found", 404);
  }

  const project = mapProjectRow(projectRow);

  const [
    membersRes,
    sourcesRes,
    assetsRes,
    assetLinksRes,
    timelineRes,
    tasksRes,
    linksRes,
    emailLinksRes,
    dependenciesRes,
    approvalsRes,
  ] = await Promise.all([
    supabase
      .from("project_members")
      .select("id, project_id, user_id, role, created_at")
      .eq("project_id", projectId),
    supabase
      .from("project_sources")
      .select("*")
      .eq("project_id", projectId),
    supabase
      .from("assets")
      .select("*")
      .eq("project_id", projectId)
      .order("is_canonical", { ascending: false })
      .order("modified_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("asset_links")
      .select("*")
      .eq("project_id", projectId),
    supabase
      .from("timeline_items")
      .select("*")
      .eq("project_id", projectId)
      .order("starts_at", { ascending: true }),
    supabase
      .from("project_tasks")
      .select("*")
      .eq("project_id", projectId)
      .order("priority", { ascending: false })
      .order("due_at", { ascending: true }),
    supabase
      .from("project_item_links")
      .select("*")
      .eq("project_id", projectId),
    supabase
      .from("project_email_links")
      .select("*")
      .eq("project_id", projectId),
    supabase
      .from("timeline_dependencies")
      .select("*")
      .eq("project_id", projectId),
    supabase
      .from("approvals")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  if (membersRes.error) {
    return formatError(membersRes.error.message, 500);
  }
  if (sourcesRes.error) {
    return formatError(sourcesRes.error.message, 500);
  }
  if (assetsRes.error) {
    return formatError(assetsRes.error.message, 500);
  }
  if (assetLinksRes.error) {
    return formatError(assetLinksRes.error.message, 500);
  }
  if (timelineRes.error) {
    return formatError(timelineRes.error.message, 500);
  }
  if (tasksRes.error) {
    return formatError(tasksRes.error.message, 500);
  }
  if (linksRes.error) {
    return formatError(linksRes.error.message, 500);
  }
  if (emailLinksRes.error) {
    return formatError(emailLinksRes.error.message, 500);
  }
  if (dependenciesRes.error) {
    return formatError(dependenciesRes.error.message, 500);
  }
  if (approvalsRes.error) {
    return formatError(approvalsRes.error.message, 500);
  }

  const memberRows = membersRes.data ?? [];
  let profileLookup = new Map<string, { fullName: string | null; email: string | null }>();

  if (memberRows.length > 0) {
    const userIds = Array.from(new Set(memberRows.map((row) => row.user_id as string)));
    const { data: profileRows, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);

    if (profilesError) {
      return formatError(profilesError.message, 500);
    }

    if (profileRows) {
      profileLookup = new Map(
        profileRows.map((profile) => [profile.id as string, {
          fullName: (profile.full_name as string) ?? null,
          email: (profile.email as string) ?? null,
        }])
      );
    }
  }

  const members = memberRows.map((row) => ({
    member: mapProjectMemberRow(row),
    profile: profileLookup.get(row.user_id as string) ?? null,
  }));

  const sources = (sourcesRes.data ?? []).map(mapProjectSourceRow);
  const assets = (assetsRes.data ?? []).map(mapAssetRow);
  const assetLinks = (assetLinksRes.data ?? []).map(mapAssetLinkRow);
  const timelineItems = (timelineRes.data ?? []).map(mapTimelineItemRow);
  const tasks = (tasksRes.data ?? []).map(mapProjectTaskRow);
  const itemLinks = (linksRes.data ?? []).map(mapProjectItemLinkRow);
  const timelineDependencies = (dependenciesRes.data ?? []).map(mapTimelineDependencyRow);
  const approvals = (approvalsRes.data ?? []).map(mapApprovalRow);

  const emailLinkRows = emailLinksRes.data ?? [];
  const emailIds = emailLinkRows
    .map((row) => row.email_id as string | null)
    .filter((value): value is string => Boolean(value));

  let emailsById = new Map<string, EmailRecord>();

  if (emailIds.length > 0) {
    const { data: emailsData, error: emailsError } = await supabase
      .from("emails")
      .select("id, from_name, from_email, subject, received_at, category, is_read, summary, labels")
      .in("id", Array.from(new Set(emailIds)));

    if (emailsError) {
      return formatError(emailsError.message, 500);
    }

    if (emailsData) {
      emailsById = new Map(emailsData.map((row: any) => [row.id as string, mapEmailRow(row)]));
    }
  }

  const emailLinks = emailLinkRows.map((row) => ({
    link: mapProjectEmailLinkRow(row),
    email: row.email_id ? emailsById.get(row.email_id as string) ?? null : null,
  }));

  const conflicts = detectTimelineConflicts(timelineItems);
  const topActions = computeTopActions({
    tasks,
    timelineItems,
    dependencies: timelineDependencies,
    conflicts,
  });

  const stats = {
    openTaskCount: tasks.filter((task) => task.status !== "done" && task.status !== "completed").length,
    upcomingTimelineCount: timelineItems.filter((item) => item.startsAt && new Date(item.startsAt) >= new Date()).length,
    linkedEmailCount: emailLinks.length,
    assetCount: assets.length,
    conflictCount: conflicts.length,
  };

  return NextResponse.json({
    project,
    members,
    sources,
    assets,
    assetLinks,
    timelineItems,
    timelineDependencies,
    tasks,
    itemLinks,
    emailLinks,
    approvals,
    stats,
    topActions,
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { projectId } = params;
  if (!projectId) {
    return formatError("Project id is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  try {
    await assertProjectRole(supabase, projectId, user.id, "editor");
  } catch (err: any) {
    const status = err?.status ?? 403;
    return formatError(err?.message || "Forbidden", status);
  }

  let payload: Partial<ProjectRecord> & {
    labels?: Record<string, unknown>;
    priorityProfile?: Record<string, unknown> | null;
  };
  try {
    payload = (await request.json()) as Partial<ProjectRecord> & {
      labels?: Record<string, unknown>;
      priorityProfile?: Record<string, unknown> | null;
    };
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const updatePayload: Record<string, unknown> = {};

  if (payload.name != null) updatePayload["name"] = payload.name;
  if (payload.description !== undefined) updatePayload["description"] = payload.description;
  if (payload.status != null) updatePayload["status"] = payload.status;
  if (payload.startDate !== undefined) updatePayload["start_date"] = payload.startDate;
  if (payload.endDate !== undefined) updatePayload["end_date"] = payload.endDate;
  if (payload.color !== undefined) updatePayload["color"] = payload.color;
  if (payload.labels !== undefined) updatePayload["labels"] = payload.labels;
  if ((payload as any).priorityProfile !== undefined) {
    updatePayload["priority_profile"] = (payload as any).priorityProfile;
  }

  if (Object.keys(updatePayload).length === 0) {
    return formatError("No fields to update", 400);
  }

  const { data, error } = await supabase
    .from("projects")
    .update(updatePayload)
    .eq("id", projectId)
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Project not found", 404);
  }

  return NextResponse.json({ project: mapProjectRow(data) });
}

export async function DELETE(request: Request, { params }: Params) {
  const { projectId } = params;
  if (!projectId) {
    return formatError("Project id is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  try {
    await assertProjectRole(supabase, projectId, user.id, "owner");
  } catch (err: any) {
    const status = err?.status ?? 403;
    return formatError(err?.message || "Forbidden", status);
  }

  const { error } = await supabase.from("projects").delete().eq("id", projectId);

  if (error) {
    return formatError(error.message, 400);
  }

  return NextResponse.json({ success: true });
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
