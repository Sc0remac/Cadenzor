import { NextResponse } from "next/server";
import {
  DEFAULT_PRIORITY_CONFIG,
  calculateEmailInboxPriority,
  normaliseLabel,
  normaliseLabels,
  ensureDefaultLabelCoverage,
  normalizePriorityConfigInput,
  type EmailTriageState,
  type PriorityConfig,
  type PriorityConfigInput,
} from "@kazador/shared";
import { requireAuthenticatedUser } from "../../../../lib/serverAuth";
import { EMAIL_SELECT_COLUMNS, enrichEmailRecords, mapEmailRow } from "../utils";

const VALID_TRIAGE_STATES: EmailTriageState[] = [
  "unassigned",
  "acknowledged",
  "snoozed",
  "resolved",
];

type Params = {
  params: {
    emailId?: string;
  };
};

interface UpdateEmailPayload {
  triageState?: EmailTriageState;
  snoozedUntil?: string | null;
  isRead?: boolean;
}

function parseUpdatePayload(body: unknown): UpdateEmailPayload {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid payload");
  }

  const payload = body as Record<string, unknown>;
  const result: UpdateEmailPayload = {};

  if (payload.triageState != null) {
    if (typeof payload.triageState !== "string") {
      throw new Error("triageState must be a string");
    }
    const lower = payload.triageState.toLowerCase() as EmailTriageState;
    if (!VALID_TRIAGE_STATES.includes(lower)) {
      throw new Error("Invalid triageState value");
    }
    result.triageState = lower;
  }

  if (payload.snoozedUntil !== undefined) {
    if (payload.snoozedUntil === null) {
      result.snoozedUntil = null;
    } else if (typeof payload.snoozedUntil === "string" && payload.snoozedUntil.trim().length > 0) {
      const date = new Date(payload.snoozedUntil);
      if (Number.isNaN(date.getTime())) {
        throw new Error("Invalid snoozedUntil timestamp");
      }
      result.snoozedUntil = date.toISOString();
    } else {
      throw new Error("snoozedUntil must be a valid ISO timestamp or null");
    }
  }

  if (payload.isRead !== undefined) {
    if (typeof payload.isRead !== "boolean") {
      throw new Error("isRead must be a boolean");
    }
    result.isRead = payload.isRead;
  }

  return result;
}

async function loadPriorityConfig(supabase: any, userId: string): Promise<PriorityConfig> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("priority_config")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load priority config", error);
    return DEFAULT_PRIORITY_CONFIG;
  }

  if (!data?.priority_config) {
    return DEFAULT_PRIORITY_CONFIG;
  }

  try {
    return normalizePriorityConfigInput(data.priority_config as PriorityConfigInput, DEFAULT_PRIORITY_CONFIG);
  } catch (err) {
    console.error("Failed to parse priority config", err);
    return DEFAULT_PRIORITY_CONFIG;
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const emailId = params.emailId;
  if (!emailId) {
    return NextResponse.json({ error: "Email id is required" }, { status: 400 });
  }

  let payload: UpdateEmailPayload;
  try {
    payload = parseUpdatePayload(await request.json());
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Invalid payload" }, { status: 400 });
  }

  if (
    payload.triageState === undefined &&
    payload.snoozedUntil === undefined &&
    payload.isRead === undefined
  ) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;

  const { data: existingRow, error: existingError } = await supabase
    .from("emails")
    .select(EMAIL_SELECT_COLUMNS)
    .eq("id", emailId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (!existingRow) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  const existingEmail = mapEmailRow(existingRow);

  const { count: attachmentCount, error: attachmentError } = await supabase
    .from("email_attachments")
    .select("id", { count: "exact", head: true })
    .eq("email_id", emailId);

  if (attachmentError) {
    return NextResponse.json({ error: attachmentError.message }, { status: 500 });
  }

  const hasAttachments = typeof attachmentCount === "number" ? attachmentCount > 0 : false;

  const nextTriageState = payload.triageState ?? existingEmail.triageState ?? "unassigned";
  let nextSnoozedUntil: string | null;
  if (payload.snoozedUntil !== undefined) {
    nextSnoozedUntil = payload.snoozedUntil;
  } else if (nextTriageState === "snoozed") {
    nextSnoozedUntil = existingEmail.snoozedUntil ?? null;
  } else {
    nextSnoozedUntil = null;
  }

  if (nextTriageState === "snoozed" && !nextSnoozedUntil) {
    return NextResponse.json({ error: "snoozedUntil is required when triageState is snoozed" }, { status: 400 });
  }

  const nextIsRead = payload.isRead ?? (nextTriageState === "resolved" || nextTriageState === "acknowledged" ? true : existingEmail.isRead);

  const labels = ensureDefaultLabelCoverage(normaliseLabels(existingRow.labels));
  const category = normaliseLabel(existingRow.category);
  const priorityConfig = await loadPriorityConfig(supabase, user.id);

  const recalculatedPriority = calculateEmailInboxPriority(
    {
      category,
      labels,
      receivedAt: existingEmail.receivedAt,
      isRead: nextIsRead,
      triageState: nextTriageState,
      snoozedUntil: nextSnoozedUntil,
      fromEmail: existingEmail.fromEmail,
      fromName: existingEmail.fromName,
      subject: existingEmail.subject,
      hasAttachments,
    },
    { config: priorityConfig }
  );

  const updatePayload: Record<string, unknown> = {
    is_read: nextIsRead,
    triage_state: nextTriageState,
    snoozed_until: nextSnoozedUntil,
    priority_score: recalculatedPriority,
  };

  if (nextTriageState !== existingEmail.triageState) {
    updatePayload.triaged_at = new Date().toISOString();
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from("emails")
    .update(updatePayload)
    .eq("id", emailId)
    .eq("user_id", user.id)
    .select(EMAIL_SELECT_COLUMNS)
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updatedRow) {
    return NextResponse.json({ error: "Email not found after update" }, { status: 404 });
  }

  const updatedEmail = mapEmailRow(updatedRow);
  const [enriched] = await enrichEmailRecords(supabase, user.id, [updatedEmail]);

  return NextResponse.json({ email: enriched ?? updatedEmail });
}
