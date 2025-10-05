import type { SupabaseClient } from "@supabase/supabase-js";
import { mapApprovalRow } from "./projectMappers";
import type { ApprovalRecord } from "@cadenzor/shared";

export type ApprovalAction = "approve" | "decline";

interface EmailLinkPayload {
  projectId?: string;
  emailId?: string;
  confidence?: number;
  source?: string;
  timelineSeed?: {
    title: string;
    type?: string;
    startsAt?: string | null;
    endsAt?: string | null;
    lane?: string | null;
    territory?: string | null;
    metadata?: Record<string, unknown>;
    dependencies?: Array<{ itemId: string; kind?: "FS" | "SS"; note?: string }>;
  };
}

interface TimelineItemPayload {
  projectId?: string;
  title?: string;
  type?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  lane?: string | null;
  territory?: string | null;
  priority?: number;
  metadata?: Record<string, unknown>;
  dependencies?: Array<{ itemId: string; kind?: "FS" | "SS"; note?: string }>;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Approval payload missing ${field}`);
  }
  return value;
}

async function applyProjectEmailLink(
  supabase: SupabaseClient,
  approvalRow: any,
  actorId: string,
  payload: EmailLinkPayload
) {
  const projectId = assertString(payload.projectId ?? approvalRow.project_id, "projectId");
  const emailId = assertString(payload.emailId, "emailId");

  const { error: linkError } = await supabase
    .from("project_email_links")
    .upsert(
      {
        project_id: projectId,
        email_id: emailId,
        confidence: payload.confidence ?? null,
        source: payload.source ?? "ai",
      },
      { onConflict: "project_id,email_id" }
    );

  if (linkError) {
    throw linkError;
  }

  if (payload.timelineSeed) {
    const seed = payload.timelineSeed;
    const title = assertString(seed.title, "timelineSeed.title");
    const type = typeof seed.type === "string" ? seed.type : "event";

    const insertPayload: Record<string, unknown> = {
      project_id: projectId,
      title,
      type,
      starts_at: seed.startsAt ?? null,
      ends_at: seed.endsAt ?? null,
      lane: seed.lane ?? null,
      territory: seed.territory ?? null,
      priority: 50,
      metadata: seed.metadata ?? { source: "email_seed" },
      ref_table: "emails",
      ref_id: emailId,
      created_by: actorId,
    };

    const { data: timelineRow, error: timelineError } = await supabase
      .from("timeline_items")
      .insert(insertPayload)
      .select("*")
      .maybeSingle();

    if (timelineError) {
      throw timelineError;
    }

    if (timelineRow && Array.isArray(seed.dependencies) && seed.dependencies.length > 0) {
      const dependencyRows = seed.dependencies
        .filter((dependency) => typeof dependency.itemId === "string" && dependency.itemId)
        .map((dependency) => ({
          project_id: projectId,
          from_item_id: dependency.itemId,
          to_item_id: timelineRow.id,
          kind: dependency.kind === "SS" ? "SS" : "FS",
          note: dependency.note ?? null,
          created_by: actorId,
        }));

      if (dependencyRows.length > 0) {
        await supabase.from("timeline_dependencies").insert(dependencyRows);
      }
    }
  }
}

async function applyTimelineItem(
  supabase: SupabaseClient,
  actorId: string,
  payload: TimelineItemPayload
) {
  const projectId = assertString(payload.projectId, "projectId");
  const title = assertString(payload.title, "title");
  const type = typeof payload.type === "string" ? payload.type : "event";

  const insertPayload: Record<string, unknown> = {
    project_id: projectId,
    title,
    type,
    starts_at: payload.startsAt ?? null,
    ends_at: payload.endsAt ?? null,
    lane: payload.lane ?? null,
    territory: payload.territory ?? null,
    priority: payload.priority ?? 50,
    metadata: payload.metadata ?? {},
    created_by: actorId,
  };

  const { data: timelineRow, error: timelineError } = await supabase
    .from("timeline_items")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (timelineError) {
    throw timelineError;
  }

  if (!timelineRow) {
    return;
  }

  if (Array.isArray(payload.dependencies) && payload.dependencies.length > 0) {
    const dependencyRows = payload.dependencies
      .filter((dependency) => typeof dependency.itemId === "string" && dependency.itemId)
      .map((dependency) => ({
        project_id: projectId,
        from_item_id: dependency.itemId,
        to_item_id: timelineRow.id,
        kind: dependency.kind === "SS" ? "SS" : "FS",
        note: dependency.note ?? null,
        created_by: actorId,
      }));

    if (dependencyRows.length > 0) {
      await supabase.from("timeline_dependencies").insert(dependencyRows);
    }
  }
}

export async function applyApprovalAction(
  supabase: SupabaseClient,
  approvalId: string,
  action: ApprovalAction,
  actorId: string,
  note?: string
): Promise<ApprovalRecord> {
  const { data: approvalRow, error: fetchError } = await supabase
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!approvalRow) {
    throw new Error("Approval not found");
  }

  if (approvalRow.status !== "pending") {
    return mapApprovalRow(approvalRow);
  }

  const payload = (approvalRow.payload as Record<string, unknown>) ?? {};

  if (action === "approve") {
    switch (approvalRow.type) {
      case "project_email_link":
        await applyProjectEmailLink(supabase, approvalRow, actorId, payload as EmailLinkPayload);
        break;
      case "timeline_item_from_email":
        await applyTimelineItem(supabase, actorId, payload as TimelineItemPayload);
        break;
      default:
        break;
    }
  }

  const resolutionFields: Record<string, unknown> = {
    status: action === "approve" ? "approved" : "declined",
    approver_id: actorId,
    resolution_note: note ?? null,
    updated_at: new Date().toISOString(),
  };

  if (action === "approve") {
    resolutionFields["approved_at"] = new Date().toISOString();
  } else {
    resolutionFields["declined_at"] = new Date().toISOString();
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from("approvals")
    .update(resolutionFields)
    .eq("id", approvalId)
    .select("*")
    .maybeSingle();

  if (updateError) {
    throw updateError;
  }

  return mapApprovalRow(updatedRow);
}
