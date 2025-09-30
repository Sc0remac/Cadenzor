import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapProjectTaskRow } from "../../../../../lib/projectMappers";

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
    .from("project_tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("priority", { ascending: false })
    .order("due_at", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ tasks: (data ?? []).map(mapProjectTaskRow) });
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
    title: string;
    description?: string | null;
    status?: string;
    dueAt?: string | null;
    priority?: number;
    assigneeId?: string | null;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.title) {
    return formatError("title is required", 400);
  }

  const insertPayload = {
    project_id: projectId,
    title: payload.title,
    description: payload.description ?? null,
    status: payload.status ?? "todo",
    due_at: payload.dueAt ?? null,
    priority: payload.priority ?? 0,
    assignee_id: payload.assigneeId ?? null,
    created_by: user.id,
  };

  const { data, error } = await supabase
    .from("project_tasks")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Failed to create task", 500);
  }

  return NextResponse.json({ task: mapProjectTaskRow(data) });
}
