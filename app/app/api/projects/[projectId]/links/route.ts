import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapProjectItemLinkRow } from "../../../../../lib/projectMappers";
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
    .from("project_item_links")
    .select("*")
    .eq("project_id", projectId);

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ links: (data ?? []).map(mapProjectItemLinkRow) });
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
    refTable: string;
    refId: string;
    confidence?: number | null;
    source?: ProjectLinkSource;
    metadata?: Record<string, unknown> | null;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.refTable || !payload?.refId) {
    return formatError("refTable and refId are required", 400);
  }

  const insertPayload = {
    project_id: projectId,
    ref_table: payload.refTable,
    ref_id: payload.refId,
    confidence: payload.confidence ?? null,
    source: payload.source ?? "manual",
    metadata: payload.metadata ?? null,
  };

  const { data, error } = await supabase
    .from("project_item_links")
    .upsert(insertPayload, { onConflict: "project_id,ref_table,ref_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 400);
  }

  if (!data) {
    return formatError("Failed to create project link", 500);
  }

  return NextResponse.json({ link: mapProjectItemLinkRow(data) });
}
