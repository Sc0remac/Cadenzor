import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapProjectEmailLinkRow } from "../../../../../lib/projectMappers";
import {
  confidenceLevelToScore,
  type ProjectAssignmentRuleConfidence,
} from "@kazador/shared";
import type { ProjectEmailLinkRecord } from "@kazador/shared";

interface Params {
  params: {
    emailId: string;
  };
}

interface LinkProjectPayload {
  projectId: string;
  confidenceLevel?: ProjectAssignmentRuleConfidence | null;
  confidenceScore?: number | null;
  note?: string | null;
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

  const nowIso = new Date().toISOString();
  const confidenceScore =
    payload.confidenceScore ??
    confidenceLevelToScore(payload.confidenceLevel ?? null) ??
    1;

  const metadata = sanitizeMetadata({
    linked_by: user.id,
    linked_at: nowIso,
    note: payload.note,
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

  const link: ProjectEmailLinkRecord = mapProjectEmailLinkRow(linkRow);

  return NextResponse.json({
    link,
  });
}
