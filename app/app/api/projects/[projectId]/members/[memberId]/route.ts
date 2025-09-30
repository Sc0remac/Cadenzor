import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../../lib/projectAccess";
import type { ProjectMemberRole } from "@cadenzor/shared";

interface Params {
  params: {
    projectId: string;
    memberId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: Request, { params }: Params) {
  const { projectId, memberId } = params;
  if (!projectId || !memberId) {
    return formatError("Project id and member id are required", 400);
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

  let payload: { role: ProjectMemberRole };
  try {
    payload = (await request.json()) as { role: ProjectMemberRole };
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.role) {
    return formatError("role is required", 400);
  }

  const { error } = await supabase
    .from("project_members")
    .update({ role: payload.role })
    .eq("id", memberId)
    .eq("project_id", projectId);

  if (error) {
    return formatError(error.message, 400);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request, { params }: Params) {
  const { projectId, memberId } = params;
  if (!projectId || !memberId) {
    return formatError("Project id and member id are required", 400);
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

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("id", memberId)
    .eq("project_id", projectId);

  if (error) {
    return formatError(error.message, 400);
  }

  return NextResponse.json({ success: true });
}
