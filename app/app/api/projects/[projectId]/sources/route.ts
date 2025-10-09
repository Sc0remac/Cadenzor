import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapProjectSourceRow } from "../../../../../lib/projectMappers";
import type { ProjectSourceKind } from "@kazador/shared";

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
    .from("project_sources")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ sources: (data ?? []).map(mapProjectSourceRow) });
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
    kind: ProjectSourceKind;
    externalId: string;
    title?: string | null;
    watch?: boolean;
    scope?: string | null;
    metadata?: Record<string, unknown> | null;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.kind || !payload?.externalId) {
    return formatError("kind and externalId are required", 400);
  }

  const insertPayload = {
    project_id: projectId,
    kind: payload.kind,
    external_id: payload.externalId,
    title: payload.title ?? null,
    watch: payload.watch ?? false,
    scope: payload.scope ?? null,
    metadata: payload.metadata ?? null,
  };

  const { data, error } = await supabase
    .from("project_sources")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Failed to create project source", 500);
  }

  return NextResponse.json({ source: mapProjectSourceRow(data) });
}
