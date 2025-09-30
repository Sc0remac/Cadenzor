import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../../lib/projectAccess";
import { mapProjectSourceRow } from "../../../../../../lib/projectMappers";
import type { ProjectSourceKind } from "@cadenzor/shared";

interface Params {
  params: {
    projectId: string;
    sourceId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: Request, { params }: Params) {
  const { projectId, sourceId } = params;
  if (!projectId || !sourceId) {
    return formatError("Project id and source id are required", 400);
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
    kind: ProjectSourceKind;
    title: string | null;
    watch: boolean;
    scope: string | null;
    metadata: Record<string, unknown> | null;
    lastIndexedAt: string | null;
  }>;

  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const updatePayload: Record<string, unknown> = {};
  if (payload.kind !== undefined) updatePayload["kind"] = payload.kind;
  if (payload.title !== undefined) updatePayload["title"] = payload.title;
  if (payload.watch !== undefined) updatePayload["watch"] = payload.watch;
  if (payload.scope !== undefined) updatePayload["scope"] = payload.scope;
  if (payload.metadata !== undefined) updatePayload["metadata"] = payload.metadata;
  if (payload.lastIndexedAt !== undefined) updatePayload["last_indexed_at"] = payload.lastIndexedAt;

  if (Object.keys(updatePayload).length === 0) {
    return formatError("No fields to update", 400);
  }

  const { data, error } = await supabase
    .from("project_sources")
    .update(updatePayload)
    .eq("id", sourceId)
    .eq("project_id", projectId)
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Project source not found", 404);
  }

  return NextResponse.json({ source: mapProjectSourceRow(data) });
}

export async function DELETE(request: Request, { params }: Params) {
  const { projectId, sourceId } = params;
  if (!projectId || !sourceId) {
    return formatError("Project id and source id are required", 400);
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
    .from("project_sources")
    .delete()
    .eq("id", sourceId)
    .eq("project_id", projectId);

  if (error) {
    return formatError(error.message, 400);
  }

  return NextResponse.json({ success: true });
}
