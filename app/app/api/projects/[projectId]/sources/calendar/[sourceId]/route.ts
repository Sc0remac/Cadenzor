import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import { mapProjectSourceRow } from "@/lib/projectMappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: { projectId: string; sourceId: string } }
) {
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
    await assertProjectRole(supabase, projectId, user.id, "viewer");
  } catch (err: any) {
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  const { data, error } = await supabase
    .from("project_sources")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", sourceId)
    .eq("kind", "calendar")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 500);
  }

  if (!data) {
    return formatError("Calendar source not found", 404);
  }

  return NextResponse.json({ source: mapProjectSourceRow(data) });
}
