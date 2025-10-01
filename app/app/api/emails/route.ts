import { NextResponse } from "next/server";
import type { EmailRecord } from "@cadenzor/shared";
import {
  normaliseLabel,
  normaliseLabels,
  ensureDefaultLabelCoverage,
  EMAIL_FALLBACK_LABEL,
} from "@cadenzor/shared";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";

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
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase } = authResult;

  const { searchParams } = new URL(request.url);
  const pageParam = searchParams.get("page");
  const perPageParam = searchParams.get("perPage") ?? searchParams.get("limit");
  const labelParam = searchParams.get("label");

  const page = Math.max(Number(pageParam) || 1, 1);
  const perPage = Math.min(Math.max(Number(perPageParam) || 10, 1), 100);
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

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
    .select(
      "id, from_name, from_email, subject, received_at, category, is_read, summary, labels",
      { count: "exact" }
    )
    .order("received_at", { ascending: false });

  if (labelFilter) {
    // Supabase's jsonb contains filter expects a JSON-encoded string input.
    query = query.contains("labels", JSON.stringify([labelFilter]));
  }

  const { data, error, count } = await query.range(from, to);

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
