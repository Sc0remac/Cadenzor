import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../lib/projectAccess";
import {
  mapProjectRow,
  mapProjectMemberRow,
  mapProjectSourceRow,
  mapTimelineItemRow,
  mapProjectTaskRow,
  mapProjectItemLinkRow,
  mapProjectEmailLinkRow,
  mapTimelineDependencyRow,
  mapApprovalRow,
} from "../../../../lib/projectMappers";
import type {
  ProjectRecord,
  EmailRecord,
  TimelineItemRecord,
  ProjectConflictRecord,
  ProjectTopAction,
} from "@cadenzor/shared";
import {
  ensureDefaultLabelCoverage,
  normaliseLabel,
  normaliseLabels,
} from "@cadenzor/shared";
import * as sharedModule from "@cadenzor/shared";

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

  const [membersRes, sourcesRes, timelineRes, dependenciesRes, tasksRes, linksRes, emailLinksRes, approvalsRes] = await Promise.all([
    supabase
      .from("project_members")
      .select("id, project_id, user_id, role, created_at")
      .eq("project_id", projectId),
    supabase
      .from("project_sources")
      .select("*")
      .eq("project_id", projectId),
    supabase
      .from("timeline_items")
      .select("*")
      .eq("project_id", projectId)
      .order("starts_at", { ascending: true }),
    supabase
      .from("timeline_dependencies")
      .select("*")
      .eq("project_id", projectId),
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
  if (timelineRes.error) {
    return formatError(timelineRes.error.message, 500);
  }
  if (dependenciesRes.error) {
    return formatError(dependenciesRes.error.message, 500);
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
  const timelineItems = (timelineRes.data ?? []).map(mapTimelineItemRow);
  const timelineDependencies = (dependenciesRes.data ?? []).map(mapTimelineDependencyRow);
  const tasks = (tasksRes.data ?? []).map(mapProjectTaskRow);
  const itemLinks = (linksRes.data ?? []).map(mapProjectItemLinkRow);

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

  if (approvalsRes.error) {
    return formatError(approvalsRes.error.message, 500);
  }

  const approvals = (approvalsRes.data ?? []).map(mapApprovalRow);

  const { conflicts, conflictItemIds } = detectConflicts(timelineItems, 4);

  const buildTopActionsExport = (sharedModule as Record<string, unknown>)[
    "buildTopActions"
  ];
  let topActions: ProjectTopAction[] = [];

  if (typeof buildTopActionsExport === "function") {
    topActions = (buildTopActionsExport as typeof sharedModule.buildTopActions)(
      timelineItems,
      tasks,
      conflictItemIds,
      8,
    );
  } else {
    console.warn(
      "[api/projects/[projectId]] buildTopActions export missing. Falling back to empty top actions list.",
    );
  }

  const stats = {
    memberCount: members.length,
    sourceCount: sources.length,
    linkedEmailCount: emailLinks.length,
    openTaskCount: tasks.filter((task) => task.status !== "done" && task.status !== "completed").length,
    upcomingTimelineCount: timelineItems.filter((item) => item.startsAt && new Date(item.startsAt) >= new Date()).length,
    conflictCount: conflicts.length,
    lastUpdatedAt: new Date().toISOString(),
  };

  return NextResponse.json({
    project,
    members,
    sources,
    timelineItems,
    timelineDependencies,
    tasks,
    itemLinks,
    emailLinks,
    approvals,
    conflicts,
    topActions,
    stats,
  });
}

function detectConflicts(items: TimelineItemRecord[], bufferHours: number): {
  conflicts: ProjectConflictRecord[];
  conflictItemIds: Set<string>;
} {
  const conflicts: ProjectConflictRecord[] = [];
  const conflictItemIds = new Set<string>();
  const scheduled = items
    .map((item) => {
      const start = item.startsAt ? Date.parse(item.startsAt) : null;
      const end = item.endsAt ? Date.parse(item.endsAt) : null;
      if (start == null) return null;
      const effectiveEnd = end && end > start ? end : start + 2 * 60 * 60 * 1000;
      return { item, start, end: effectiveEnd };
    })
    .filter((value): value is { item: TimelineItemRecord; start: number; end: number } => Boolean(value));

  const bufferMs = bufferHours * 60 * 60 * 1000;

  for (let i = 0; i < scheduled.length; i += 1) {
    for (let j = i + 1; j < scheduled.length; j += 1) {
      const a = scheduled[i];
      const b = scheduled[j];

      const overlaps = a.end > b.start && b.end > a.start;
      if (overlaps && a.item.lane === b.item.lane) {
        conflictItemIds.add(a.item.id);
        conflictItemIds.add(b.item.id);
        conflicts.push({
          id: `${a.item.id}:${b.item.id}:overlap`,
          itemIds: [a.item.id, b.item.id],
          severity: "warning",
          message: `${a.item.title} overlaps with ${b.item.title} in ${a.item.lane || "General"}`,
        });
      }

      if (a.item.territory && b.item.territory && a.item.territory === b.item.territory) {
        const delta = Math.abs(a.start - b.start);
        if (delta < bufferMs) {
          conflictItemIds.add(a.item.id);
          conflictItemIds.add(b.item.id);
          conflicts.push({
            id: `${a.item.id}:${b.item.id}:territory`,
            itemIds: [a.item.id, b.item.id],
            severity: "error",
            message: `${a.item.title} and ${b.item.title} are both in ${a.item.territory} without ${bufferHours}h buffer`,
          });
        }
      }
    }
  }

  return { conflicts, conflictItemIds };
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
