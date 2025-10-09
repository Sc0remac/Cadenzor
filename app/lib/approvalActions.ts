import type { SupabaseClient } from "@supabase/supabase-js";
import { mapApprovalRow } from "./projectMappers";
import { getTimelineLaneForType, normaliseTimelineItemStatus, normaliseTimelineItemType } from "@cadenzor/shared";
import type { ApprovalRecord, TimelineItemRecord } from "@cadenzor/shared";

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
    dueAt?: string | null;
    timezone?: string | null;
    lane?: string | null;
    territory?: string | null;
    kind?: string | null;
    description?: string | null;
    status?: string | null;
    priority?: number;
    priorityComponents?: Record<string, unknown>;
    labels?: Record<string, unknown>;
    links?: Record<string, unknown>;
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
  dueAt?: string | null;
  timezone?: string | null;
  lane?: string | null;
  territory?: string | null;
  kind?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: number;
  priorityComponents?: Record<string, unknown>;
  labels?: Record<string, unknown>;
  links?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  dependencies?: Array<{ itemId: string; kind?: "FS" | "SS"; note?: string }>;
}

interface TimelineInsertOptions {
  title: string;
  type?: string | null;
  kind?: string | null;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  dueAt?: string | null;
  timezone?: string | null;
  status?: string | null;
  priority?: number | null;
  priorityComponents?: Record<string, unknown> | null;
  territory?: string | null;
  lane?: string | null;
  labels?: Record<string, unknown> | null;
  links?: Record<string, unknown> | null;
  source?: string | null;
}

function buildProjectItemInsert(
  projectId: string,
  actorId: string,
  options: TimelineInsertOptions
): Record<string, unknown> {
  const type = normaliseTimelineItemType(options.type);
  const status = normaliseTimelineItemStatus(options.status);
  const labels: Record<string, unknown> = options.labels ? { ...options.labels } : {};
  if (options.territory) {
    labels.territory = options.territory;
  }
  const laneLabel = options.lane ?? getTimelineLaneForType(type);
  labels.lane = laneLabel;

  const links: Record<string, unknown> = options.links ? { ...options.links } : {};
  if (options.source) {
    links.source = options.source;
  }

  return {
    project_id: projectId,
    type,
    kind: options.kind ?? null,
    title: options.title,
    description: options.description ?? null,
    start_at: options.startsAt ?? null,
    end_at: options.endsAt ?? null,
    due_at: options.dueAt ?? null,
    tz: options.timezone ?? null,
    status,
    priority_score: options.priority ?? null,
    priority_components: options.priorityComponents ?? {},
    labels,
    links,
    created_by: actorId,
  } satisfies Record<string, unknown>;
}

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
    const priorityComponents = seed.priorityComponents ?? (seed.metadata?.priorityComponents as Record<string, unknown> | undefined) ?? null;
    const labels = seed.labels ?? (seed.metadata?.labels as Record<string, unknown> | undefined) ?? null;
    const links: Record<string, unknown> = {
      ...(seed.links ?? {}),
      emailId,
      refTable: "emails",
      refId: emailId,
    };
    if (seed.metadata && Object.keys(seed.metadata).length > 0) {
      links.metadata = seed.metadata;
    }

    const insertPayload = buildProjectItemInsert(projectId, actorId, {
      title,
      type: seed.type,
      kind: seed.kind ?? null,
      description: seed.description ?? null,
      startsAt: seed.startsAt ?? null,
      endsAt: seed.endsAt ?? null,
      dueAt: seed.dueAt ?? null,
      timezone: seed.timezone ?? null,
      lane: seed.lane ?? null,
      territory: seed.territory ?? null,
      status: seed.status ?? null,
      priority: seed.priority ?? 50,
      priorityComponents,
      labels,
      links,
      source: "email_seed",
    });

    const { data: timelineRow, error: timelineError } = await supabase
      .from("project_items")
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
  const metadata = payload.metadata ?? {};
  const priorityComponents = payload.priorityComponents ?? (metadata.priorityComponents as Record<string, unknown> | undefined) ?? null;
  const labels = payload.labels ?? (metadata.labels as Record<string, unknown> | undefined) ?? null;
  const links = payload.links ?? (metadata.links as Record<string, unknown> | undefined) ?? null;
  const source = typeof metadata.source === "string" ? (metadata.source as string) : undefined;

  const insertPayload = buildProjectItemInsert(projectId, actorId, {
    title,
    type: payload.type,
    kind: payload.kind ?? null,
    description: payload.description ?? null,
    startsAt: payload.startsAt ?? null,
    endsAt: payload.endsAt ?? null,
    dueAt: payload.dueAt ?? null,
    timezone: payload.timezone ?? null,
    lane: payload.lane ?? null,
    territory: payload.territory ?? null,
    status: payload.status ?? null,
    priority: payload.priority ?? 50,
    priorityComponents,
    labels,
    links,
    source,
  });

  const { data: timelineRow, error: timelineError } = await supabase
    .from("project_items")
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
