import { NextResponse } from "next/server";
import type { EmailRecord } from "@cadenzor/shared";
import {
  normaliseLabel,
  normaliseLabels,
  ensureDefaultLabelCoverage,
} from "@cadenzor/shared";
import { createServerSupabaseClient } from "../../../lib/serverSupabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapRow(row: any): EmailRecord {
  const labels = ensureDefaultLabelCoverage(normaliseLabels(row.labels));

  return {
    id: row.id,
    fromName: row.from_name,
    fromEmail: row.from_email,
    subject: row.subject,
    receivedAt: row.received_at,
    category: normaliseLabel(row.category),
    isRead: row.is_read,
    summary: row.summary ?? null,
    labels,
  };
}

export async function GET(request: Request) {
  const clientResult = createServerSupabaseClient();
  if (!clientResult.ok) {
    return NextResponse.json({ error: clientResult.error }, { status: 500 });
  }

  const { supabase } = clientResult;

  const { searchParams } = new URL(request.url);
  const pageParam = searchParams.get("page");
  const perPageParam = searchParams.get("perPage") ?? searchParams.get("limit");

  const page = Math.max(Number(pageParam) || 1, 1);
  const perPage = Math.min(Math.max(Number(perPageParam) || 10, 1), 100);
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const { data, error, count } = await supabase
    .from("emails")
    .select(
      "id, from_name, from_email, subject, received_at, category, is_read, summary, labels",
      { count: "exact" }
    )
    .order("received_at", { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = Array.isArray(data) ? data.map(mapRow) : [];

  const total = typeof count === "number" ? count : items.length;
  const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;
  const hasMore = total > 0 ? page < totalPages : false;

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
