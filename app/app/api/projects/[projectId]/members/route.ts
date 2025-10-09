import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapProjectMemberRow } from "../../../../../lib/projectMappers";
import type { ProjectMemberRole } from "@kazador/shared";

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
    .from("project_members")
    .select("id, project_id, user_id, role, created_at")
    .eq("project_id", projectId);

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ members: (data ?? []).map(mapProjectMemberRow) });
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
    await assertProjectRole(supabase, projectId, user.id, "owner");
  } catch (err: any) {
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  let payload: { userId: string; role: ProjectMemberRole };
  try {
    payload = (await request.json()) as { userId: string; role: ProjectMemberRole };
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.userId) {
    return formatError("userId is required", 400);
  }

  const role: ProjectMemberRole = payload.role ?? "viewer";

  const { data, error } = await supabase
    .from("project_members")
    .upsert(
      {
        project_id: projectId,
        user_id: payload.userId,
        role,
      },
      { onConflict: "project_id,user_id" }
    )
    .select("id, project_id, user_id, role, created_at")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Failed to upsert member", 500);
  }

  return NextResponse.json({ member: mapProjectMemberRow(data) });
}
