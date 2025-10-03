import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { mapProjectRow } from "../../../../../lib/projectMappers";
import { suggestProjectsForEmail } from "@cadenzor/shared";

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
    .select("id, subject, summary, labels, from_email, from_name, received_at, category")
    .eq("id", payload.emailId)
    .maybeSingle();

  if (emailError) {
    return formatError(emailError.message, 500);
  }

  if (!emailRow) {
    return formatError("Email not found", 404);
  }

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

  const projects = (projectRows ?? []).map(mapProjectRow);

  const suggestions = suggestProjectsForEmail(
    projects,
    {
      subject: emailRow.subject ?? "",
      summary: emailRow.summary ?? null,
      labels: emailRow.labels ?? [],
      fromEmail: emailRow.from_email ?? null,
      fromName: emailRow.from_name ?? null,
      category: emailRow.category ?? null,
      receivedAt: emailRow.received_at ?? null,
    },
    { limit: payload.limit ?? 5 }
  );

  const response = suggestions.map((suggestion) => ({
    project: suggestion.project,
    score: suggestion.score,
    confidence: suggestion.confidence,
    rationales: suggestion.rationales,
    timelineItem: suggestion.timelineItem ?? null,
  }));

  return NextResponse.json({ suggestions: response });
}
