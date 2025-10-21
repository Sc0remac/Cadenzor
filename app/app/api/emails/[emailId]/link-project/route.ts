import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapProjectEmailLinkRow, mapTimelineItemRow } from "../../../../../lib/projectMappers";
import {
  confidenceLevelToScore,
  getTimelineTypeForEmailCategory,
  type ProjectAssignmentRuleConfidence,
  type TimelineItemRecord,
} from "@kazador/shared";
import type { ProjectEmailLinkRecord } from "@kazador/shared";

interface Params {
  params: {
    emailId: string;
  };
}

interface LinkProjectPayload {
  projectId: string;
  laneId?: string | null;
  confidenceLevel?: ProjectAssignmentRuleConfidence | null;
  confidenceScore?: number | null;
  note?: string | null;
  createTimelineItem?: boolean;
}

function sanitizeMetadata(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata).filter(([, value]) => value != null);
  return Object.fromEntries(entries);
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, { params }: Params) {
  const { emailId } = params;
  if (!emailId) {
    return formatError("Email id is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let payload: LinkProjectPayload;
  try {
    payload = (await request.json()) as LinkProjectPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.projectId) {
    return formatError("projectId is required", 400);
  }

  try {
    await assertProjectRole(supabase, payload.projectId, user.id, "editor");
  } catch (err: any) {
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  const { data: emailRow, error: emailError } = await supabase
    .from("emails")
    .select("id, user_id, subject, summary, category, labels, priority_score, triage_state, received_at")
    .eq("id", emailId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (emailError) {
    return formatError(emailError.message, 500);
  }
  if (!emailRow) {
    return formatError("Email not found", 404);
  }

  const { data: existingLink, error: existingLinkError } = await supabase
    .from("project_email_links")
    .select("*")
    .eq("project_id", payload.projectId)
    .eq("email_id", emailId)
    .maybeSingle();

  if (existingLinkError) {
    return formatError(existingLinkError.message, 500);
  }

  if (existingLink) {
    return NextResponse.json({
      alreadyLinked: true,
      link: mapProjectEmailLinkRow(existingLink),
    });
  }

  let laneSlug: string | null = null;
  let laneName: string | null = null;

  if (payload.laneId) {
    const { data: laneRow, error: laneError } = await supabase
      .from("lane_definitions")
      .select("id, slug, name")
      .eq("id", payload.laneId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (laneError) {
      return formatError(laneError.message, 500);
    }

    if (!laneRow) {
      return formatError("Lane not found or not accessible", 404);
    }

    laneSlug = (laneRow.slug as string) ?? laneRow.id;
    laneName = laneRow.name as string;
  }

  const nowIso = new Date().toISOString();
  const confidenceScore =
    payload.confidenceScore ??
    confidenceLevelToScore(payload.confidenceLevel ?? null) ??
    1;

  const metadata = sanitizeMetadata({
    linked_by: user.id,
    linked_at: nowIso,
    note: payload.note,
    lane_id: payload.laneId ?? null,
    lane_slug: laneSlug,
    lane_name: laneName,
    confidence_level: payload.confidenceLevel ?? null,
    source: "manual",
  });

  const insertPayload = {
    id: randomUUID(),
    project_id: payload.projectId,
    email_id: emailId,
    confidence: confidenceScore,
    source: "manual",
    metadata,
    created_at: nowIso,
  };

  const { data: linkRow, error: insertError } = await supabase
    .from("project_email_links")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (insertError || !linkRow) {
    return formatError(insertError?.message ?? "Failed to link email", 500);
  }

  await supabase
    .from("project_email_link_overrides")
    .delete()
    .eq("user_id", user.id)
    .eq("project_id", payload.projectId)
    .eq("email_id", emailId);

  let timelineItem: TimelineItemRecord | null = null;

  if (payload.createTimelineItem) {
    const labels: Record<string, unknown> = { lane: laneSlug };
    const links: Record<string, unknown> = { emailId };
    const timelineType = getTimelineTypeForEmailCategory(emailRow.category);

    const { data: insertedItem, error: timelineError } = await supabase
      .from("project_items")
      .insert({
        project_id: payload.projectId,
        type: timelineType,
        title: (emailRow.subject as string) ?? "Email link",
        description: (emailRow.summary as string) ?? null,
        labels,
        links,
        created_by: user.id,
      })
      .select("id")
      .maybeSingle();

    if (timelineError) {
      console.error("Failed to create timeline item for linked email", timelineError);
    } else if (insertedItem?.id) {
      const { data: entryRow, error: entryError } = await supabase
        .from("timeline_entries")
        .select("*")
        .eq("id", insertedItem.id as string)
        .maybeSingle();

      if (entryError) {
        console.error("Failed to load timeline entry after insert", entryError);
      } else if (entryRow) {
        timelineItem = mapTimelineItemRow(entryRow);
        const updatedMetadata = sanitizeMetadata({
          ...metadata,
          timeline_item_id: timelineItem.id,
          timeline_item_type: timelineItem.type,
        });

        await supabase
          .from("project_email_links")
          .update({ metadata: updatedMetadata })
          .eq("id", linkRow.id)
          .eq("project_id", payload.projectId);

        linkRow.metadata = updatedMetadata;
      }
    }
  }

  const link: ProjectEmailLinkRecord = mapProjectEmailLinkRow(linkRow);

  return NextResponse.json({
    link,
    timelineItem,
  });
}
