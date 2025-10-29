import { NextResponse } from "next/server";
import type { EmailRecord } from "@kazador/shared";
import { EMAIL_FALLBACK_LABEL, normaliseLabels } from "@kazador/shared";
import type { EmailSource } from "@kazador/shared";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import { EMAIL_SELECT_COLUMNS, enrichEmailRecords, mapEmailRow } from "./utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_SOURCES = new Set<EmailSource>(["gmail", "seeded", "manual", "unknown"]);

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;

  const { searchParams } = new URL(request.url);
  const pageParam = searchParams.get("page");
  const perPageParam = searchParams.get("perPage") ?? searchParams.get("limit");
  const labelParam = searchParams.get("label");
  const sourceParam = searchParams.get("source");

  const page = Math.max(Number(pageParam) || 1, 1);
  const perPage = Math.min(Math.max(Number(perPageParam) || 10, 1), 100);
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const normalisedSourceParam = sourceParam?.toLowerCase() ?? null;
  let sourceFilter: EmailSource | null = null;
  if (normalisedSourceParam) {
    if (normalisedSourceParam === "fake") {
      sourceFilter = "seeded";
    } else if (KNOWN_SOURCES.has(normalisedSourceParam as EmailSource)) {
      sourceFilter = normalisedSourceParam as EmailSource;
    }
  }

  let labelFilter: string | null = null;
  if (labelParam) {
    const parsed = normaliseLabels(labelParam);
    if (parsed.length > 0) {
      labelFilter = parsed[0];
    } else if (labelParam === EMAIL_FALLBACK_LABEL) {
      labelFilter = EMAIL_FALLBACK_LABEL;
    }
  }

  let query = supabase
    .from("emails")
    .select(EMAIL_SELECT_COLUMNS, { count: "exact" })
    .eq("user_id", user.id)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .order("received_at", { ascending: false });

  if (labelFilter) {
    // Supabase's jsonb contains filter expects a JSON-encoded string input.
    query = query.contains("labels", JSON.stringify([labelFilter]));
  }

  if (sourceFilter) {
    query = query.eq("source", sourceFilter);
  }

  console.log(`[EMAILS GET DEBUG] Fetching emails for user ${user.id}`, {
    userId: user.id,
    page,
    perPage,
    labelFilter,
    sourceFilter,
  });

  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error(`[EMAILS GET ERROR] Query failed for user ${user.id}`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`[EMAILS GET DEBUG] Query returned ${data?.length ?? 0} emails, count: ${count}`);

  const baseItems = Array.isArray(data) ? data.map(mapEmailRow) : [];
  const items = await enrichEmailRecords(supabase, user.id, baseItems);

  const total = typeof count === "number" ? count : items.length;
  const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;
  const hasMore = total > 0 ? page < totalPages : false;

  console.log(`[EMAILS GET DEBUG] Returning ${items.length} emails to client`);

  return NextResponse.json({
    items,
    pagination: {
      page,
      perPage,
      total,
      totalPages,
      hasMore,
    },
  });
}
