import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../../lib/projectAccess";
import { mapProjectTaskRow } from "../../../../../../lib/projectMappers";

interface Params {
  params: {
    projectId: string;
    taskId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: Request, { params }: Params) {
  const { projectId, taskId } = params;
  if (!projectId || !taskId) {
    return formatError("Project id and task id are required", 400);
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

  let payload: Partial<{
    title: string;
    description: string | null;
    status: string;
    dueAt: string | null;
    priority: number;
    assigneeId: string | null;
  }>;

  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const updatePayload: Record<string, unknown> = {};
  if (payload.title !== undefined) updatePayload["title"] = payload.title;
  if (payload.description !== undefined) updatePayload["description"] = payload.description;
  if (payload.status !== undefined) updatePayload["status"] = payload.status;
  if (payload.dueAt !== undefined) updatePayload["due_at"] = payload.dueAt;
  if (payload.priority !== undefined) updatePayload["priority"] = payload.priority;
  if (payload.assigneeId !== undefined) updatePayload["assignee_id"] = payload.assigneeId;

  if (Object.keys(updatePayload).length === 0) {
    return formatError("No fields to update", 400);
  }

  const { data, error } = await supabase
    .from("project_tasks")
    .update(updatePayload)
    .eq("id", taskId)
    .eq("project_id", projectId)
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Project task not found", 404);
  }

  return NextResponse.json({ task: mapProjectTaskRow(data) });
}

export async function DELETE(request: Request, { params }: Params) {
  const { projectId, taskId } = params;
  if (!projectId || !taskId) {
    return formatError("Project id and task id are required", 400);
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

  const { error } = await supabase
    .from("project_tasks")
    .delete()
    .eq("id", taskId)
    .eq("project_id", projectId);

  if (error) {
    return formatError(error.message, 400);
  }

  return NextResponse.json({ success: true });
}
