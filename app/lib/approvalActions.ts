import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ApprovalRecord,
  ApprovalType,
  ProjectLinkSource,
} from "@cadenzor/shared";
import { mapTimelineItemRow } from "./projectMappers";

interface ApplyResult {
  ok: true;
}

interface ApplyError {
  ok: false;
  error?: string;
  status?: number;
}

export type ApplyResponse = ApplyResult | ApplyError;

export async function applyApproval(
  supabase: SupabaseClient,
  approval: ApprovalRecord,
  approverId: string
): Promise<ApplyResponse> {
  const payload = approval.payload ?? {};
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
  approverId: string
): Promise<ApplyResponse> {
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

  const timelinePayloadRaw = payload.timelineItem;
  if (timelinePayloadRaw && typeof timelinePayloadRaw === "object") {
    const timelinePayload = timelinePayloadRaw as Record<string, unknown>;
    const metadata = timelinePayload.metadata;
    const metadataValue =
      metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : undefined;

    const insertPayload = {
      project_id: projectId,
      title: (timelinePayload.title as string) ?? "Email follow-up",
      type: (timelinePayload.type as string) ?? "task",
      lane: (timelinePayload.lane as string) ?? null,
      starts_at: (timelinePayload.startsAt as string) ?? null,
      ends_at: (timelinePayload.endsAt as string) ?? null,
      priority: Number(timelinePayload.priority ?? 0),
      metadata: metadataValue ?? {
        source: "approval",
        approvalId: approval.id,
        emailId,
      },
      created_by: approverId,
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
): Promise<ApplyResponse> {
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
): Promise<ApplyResponse> {
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
