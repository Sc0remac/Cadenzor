import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { mapProjectRow } from "../../../../../lib/projectMappers";
import { suggestProjectsForEmail } from "@kazador/shared";

interface SuggestProjectPayload {
  emailId: string;
  limit?: number;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let payload: SuggestProjectPayload;
  try {
    payload = (await request.json()) as SuggestProjectPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.emailId) {
    return formatError("emailId is required", 400);
  }

  const { data: emailRow, error: emailError } = await supabase
    .from("emails")
    .select("id, subject, labels, from_email, from_name, received_at, category, is_read, summary")
    .eq("id", payload.emailId)
    .maybeSingle();

  if (emailError) {
    return formatError(emailError.message, 500);
  }

  if (!emailRow) {
    return formatError("Email not found", 404);
  }

  const emailLabels: string[] = Array.isArray(emailRow.labels)
    ? (emailRow.labels as string[])
    : [];

  const { data: membershipRows, error: membershipError } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id);

  if (membershipError) {
    return formatError(membershipError.message, 500);
  }

  if (!membershipRows || membershipRows.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  const projectIds = membershipRows.map((row) => row.project_id as string);

  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .in("id", projectIds);

  if (projectError) {
    return formatError(projectError.message, 500);
  }

  const { data: linkedRows, error: linkedError } = await supabase
    .from("project_email_links")
    .select("project_id")
    .eq("email_id", payload.emailId);

  if (linkedError) {
    return formatError(linkedError.message, 500);
  }

  const excludeIds = new Set<string>((linkedRows ?? []).map((row) => row.project_id as string));
  const projects = (projectRows ?? []).map(mapProjectRow);
  const emailRecord = {
    id: emailRow.id as string,
    fromName: (emailRow.from_name as string) ?? null,
    fromEmail: emailRow.from_email as string,
    subject: emailRow.subject as string,
    receivedAt: String(emailRow.received_at),
    category: emailRow.category as string,
    isRead: Boolean(emailRow.is_read),
    summary: emailRow.summary ?? null,
    labels: emailLabels,
  };

  const suggestions = suggestProjectsForEmail(emailRecord, projects, {
    excludeProjectIds: excludeIds,
    limit: payload.limit ?? 5,
  });

  return NextResponse.json({ suggestions });
}
