import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import { THREAD_SELECT_COLUMNS, mapThreadRow } from "./utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_THREADS_PER_PAGE = 100;

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;
  const { searchParams } = new URL(request.url);

  const pageParam = Number(searchParams.get("page"));
  const perPageParam = Number(searchParams.get("perPage") ?? searchParams.get("limit"));
  const labelFilter = searchParams.get("label");
  const projectFilter = searchParams.get("projectId") ?? searchParams.get("project_id");

  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const perPageRaw = Number.isFinite(perPageParam) && perPageParam > 0 ? Math.floor(perPageParam) : 20;
  const perPage = Math.min(perPageRaw, MAX_THREADS_PER_PAGE);

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = supabase
    .from("email_threads")
    .select(THREAD_SELECT_COLUMNS, { count: "exact" })
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false });

  if (labelFilter && labelFilter.trim()) {
    query = query.contains("labels", [labelFilter.trim()]);
  }

  if (projectFilter && projectFilter.trim()) {
    query = query.contains("project_ids", [projectFilter.trim()]);
  }

  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error("Failed to load email threads", { error, userId: user.id });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const threads = Array.isArray(data) ? data.map(mapThreadRow) : [];
  const total = typeof count === "number" ? count : threads.length;
  const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;
  const hasMore = total > 0 ? page < totalPages : false;

  return NextResponse.json({
    threads,
    pagination: {
      page,
      perPage,
      total,
      totalPages,
      hasMore,
    },
  });
}
