import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import { mapAssetRow } from "@/lib/projectMappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_FILTERS: Record<string, string> = {
  audio: "mime_type.ilike.audio/%",
  artwork: "mime_type.ilike.image/%",
  docs: "mime_type.ilike.application/%",
  video: "mime_type.ilike.video/%",
};

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request, { params }: { params: { projectId: string } }) {
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

  const { searchParams } = new URL(request.url);
  const sourceId = searchParams.get("sourceId");
  const typeFilter = searchParams.get("type");
  const pathContains = searchParams.get("path");
  const updated = searchParams.get("updated");
  const canonicalOnly = searchParams.get("canonical") === "true";
  const confidentialOnly = searchParams.get("confidential") === "true";

  const page = Math.max(Number(searchParams.get("page")) || 1, 1);
  const perPage = Math.min(Math.max(Number(searchParams.get("perPage")) || 50, 1), 200);
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = supabase
    .from("assets")
    .select("*", { count: "exact" })
    .eq("project_id", projectId)
    .order("is_canonical", { ascending: false })
    .order("modified_at", { ascending: false, nullsFirst: false });

  if (sourceId) {
    query = query.eq("project_source_id", sourceId);
  }

  if (canonicalOnly) {
    query = query.eq("is_canonical", true);
  }

  if (confidentialOnly) {
    query = query.eq("confidential", true);
  }

  if (typeFilter && TYPE_FILTERS[typeFilter]) {
    query = query.or(TYPE_FILTERS[typeFilter]);
  }

  if (pathContains) {
    query = query.ilike("path", `%${pathContains}%`);
  }

  if (updated === "last7") {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("modified_at", since);
  } else if (updated === "last30") {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte("modified_at", since);
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    return formatError(error.message, 500);
  }

  const items = (data ?? []).map(mapAssetRow);
  const total = typeof count === "number" ? count : items.length;
  const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;

  return NextResponse.json({
    items,
    pagination: {
      page,
      perPage,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  });
}
