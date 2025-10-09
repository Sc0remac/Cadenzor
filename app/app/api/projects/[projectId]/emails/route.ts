import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapProjectEmailLinkRow } from "../../../../../lib/projectMappers";
import type { ProjectLinkSource } from "@kazador/shared";

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
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  const { data, error } = await supabase
    .from("project_email_links")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ emailLinks: (data ?? []).map(mapProjectEmailLinkRow) });
}

export async function POST(request: Request, { params }: Params) {
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
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  let payload: {
    emailId: string;
    confidence?: number | null;
    source?: ProjectLinkSource;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.emailId) {
    return formatError("emailId is required", 400);
  }

  const insertPayload = {
    project_id: projectId,
    email_id: payload.emailId,
    confidence: payload.confidence ?? null,
    source: payload.source ?? "manual",
  };

  const { data, error } = await supabase
    .from("project_email_links")
    .upsert(insertPayload, { onConflict: "project_id,email_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Failed to link email", 500);
  }

  return NextResponse.json({ link: mapProjectEmailLinkRow(data) });
}
