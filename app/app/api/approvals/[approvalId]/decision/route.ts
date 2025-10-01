import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapApprovalRow, mapTimelineItemRow } from "../../../../../lib/projectMappers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ApprovalDecisionInput,
  ApprovalRecord,
  ApprovalType,
  ProjectLinkSource,
} from "@cadenzor/shared";

interface Params {
  params: {
    approvalId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, { params }: Params) {
  const { approvalId } = params;
  if (!approvalId) {
    return formatError("approvalId is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let payload: ApprovalDecisionInput;
  try {
    payload = (await request.json()) as ApprovalDecisionInput;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.status || (payload.status !== "approved" && payload.status !== "declined")) {
    return formatError("status must be approved or declined", 400);
  }

  const { data, error } = await supabase
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .maybeSingle();

  if (error) {
    return formatError(error.message, 500);
  }

  if (!data) {
    return formatError("Approval not found", 404);
  }

  const approval = mapApprovalRow(data);

  if (approval.status !== "pending") {
    return formatError("Approval already resolved", 409);
  }

  if (approval.projectId) {
    try {
      await assertProjectRole(supabase, approval.projectId, user.id, "editor");
    } catch (err: any) {
      return formatError(err?.message || "Forbidden", err?.status ?? 403);
    }
  }

  if (payload.status === "approved") {
    const applyResult = await applyApproval(supabase, approval, user.id);
    if (!applyResult.ok) {
      return formatError(applyResult.error ?? "Failed to apply approval", applyResult.status ?? 400);
    }
  }

  const updatePayload: Record<string, unknown> = {
    status: payload.status,
    approver_id: user.id,
    resolution_note: payload.resolutionNote ?? null,
  };

  if (payload.status === "approved") {
    updatePayload["approved_at"] = new Date().toISOString();
  } else {
    updatePayload["declined_at"] = new Date().toISOString();
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from("approvals")
    .update(updatePayload)
    .eq("id", approvalId)
    .select("*")
    .maybeSingle();

  if (updateError) {
    return formatError(updateError.message, 500);
  }

  return NextResponse.json({ approval: mapApprovalRow(updatedRow) });
}

async function applyApproval(
  supabase: SupabaseClient,
  approval: ApprovalRecord,
  approverId: string
): Promise<{ ok: true } | { ok: false; error?: string; status?: number }> {
  const payload = approval.payload;
  const type = (approval.type as ApprovalType) ?? (payload?.type as ApprovalType);

  switch (type) {
    case "project_email_link":
      return applyProjectEmailLinkApproval(supabase, approval, approverId);
    case "timeline_item_create":
      return applyTimelineItemApproval(supabase, approval, approverId);
    case "project_task_create":
      return applyProjectTaskApproval(supabase, approval, approverId);
    default:
      return { ok: false, error: `Unsupported approval type: ${type}`, status: 400 };
  }
}

async function applyProjectEmailLinkApproval(
  supabase: SupabaseClient,
  approval: ApprovalRecord,
  _approverId: string
): Promise<{ ok: true } | { ok: false; error?: string; status?: number }> {
  const payload = approval.payload ?? {};
  const projectId = approval.projectId;
  const emailId = payload.emailId as string | undefined;
  const confidence = payload.confidence as number | undefined;
  const source = ((payload.source as ProjectLinkSource) ?? "ai") as ProjectLinkSource;

  if (!projectId || !emailId) {
    return { ok: false, error: "Missing projectId or emailId in approval payload", status: 400 };
  }

  const { error } = await supabase
    .from("project_email_links")
    .upsert(
      {
        project_id: projectId,
        email_id: emailId,
        confidence: confidence ?? null,
        source,
      },
      { onConflict: "project_id,email_id" }
    );

  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }

  const timelinePayload = payload.timelineItem;
  if (timelinePayload && typeof timelinePayload === "object") {
    const insertPayload = {
      project_id: projectId,
      title: (timelinePayload.title as string) ?? "Email follow-up",
      type: (timelinePayload.type as string) ?? "task",
      lane: (timelinePayload.lane as string) ?? null,
      starts_at: (timelinePayload.startsAt as string) ?? null,
      ends_at: (timelinePayload.endsAt as string) ?? null,
      priority: Number(timelinePayload.priority ?? 0),
      metadata: timelinePayload.metadata ?? {
        source: "approval",
        approvalId: approval.id,
        emailId,
      },
      created_by: approval.createdBy ?? null,
      status: (timelinePayload.status as string) ?? null,
      ref_table: "emails",
      ref_id: emailId,
    };

    const { error: timelineError } = await supabase
      .from("timeline_items")
      .insert(insertPayload);

    if (timelineError) {
      return { ok: false, error: timelineError.message, status: 500 };
    }
  }

  return { ok: true };
}

async function applyTimelineItemApproval(
  supabase: SupabaseClient,
  approval: ApprovalRecord,
  approverId: string
): Promise<{ ok: true } | { ok: false; error?: string; status?: number }> {
  const payload = approval.payload ?? {};
  const projectId = approval.projectId;
  if (!projectId) {
    return { ok: false, error: "Missing projectId in approval payload", status: 400 };
  }

  const insertPayload = {
    project_id: projectId,
    title: (payload.title as string) ?? "New timeline item",
    type: (payload.type as string) ?? "task",
    starts_at: (payload.startsAt as string) ?? null,
    ends_at: (payload.endsAt as string) ?? null,
    lane: (payload.lane as string) ?? null,
    territory: (payload.territory as string) ?? null,
    status: (payload.status as string) ?? null,
    priority: Number(payload.priority ?? 0),
    metadata: payload.metadata ?? { approvalId: approval.id },
    created_by: approverId,
    ref_table: (payload.refTable as string) ?? null,
    ref_id: (payload.refId as string) ?? null,
  };

  const { data, error } = await supabase
    .from("timeline_items")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }

  const dependencies = Array.isArray(payload.dependencies)
    ? payload.dependencies.filter((entry: any) => entry?.itemId)
    : [];

  if (dependencies.length > 0 && data) {
    const mapped = mapTimelineItemRow(data);
    const insertDependencies = dependencies.map((dependency: any) => ({
      project_id: projectId,
      from_item_id: dependency.itemId,
      to_item_id: mapped.id,
      kind: dependency.kind === "SS" ? "SS" : "FS",
      note: dependency.note ?? null,
    }));

    const { error: depError } = await supabase
      .from("timeline_dependencies")
      .insert(insertDependencies);

    if (depError) {
      return { ok: false, error: depError.message, status: 500 };
    }
  }

  return { ok: true };
}

async function applyProjectTaskApproval(
  supabase: SupabaseClient,
  approval: ApprovalRecord,
  approverId: string
): Promise<{ ok: true } | { ok: false; error?: string; status?: number }> {
  const payload = approval.payload ?? {};
  const projectId = approval.projectId;

  if (!projectId) {
    return { ok: false, error: "Missing projectId in approval payload", status: 400 };
  }

  const insertPayload = {
    project_id: projectId,
    title: (payload.title as string) ?? "New task",
    description: (payload.description as string) ?? null,
    status: (payload.status as string) ?? "todo",
    due_at: (payload.dueAt as string) ?? null,
    priority: Number(payload.priority ?? 0),
    assignee_id: (payload.assigneeId as string) ?? approverId,
    created_by: approverId,
  };

  const { error } = await supabase.from("project_tasks").insert(insertPayload);

  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }

  return { ok: true };
}
