import { NextResponse } from "next/server";
import {
  normaliseLabel,
  normaliseLabels,
  ensureDefaultLabelCoverage,
} from "@kazador/shared";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase } = authResult;

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const sourceParam = url.searchParams.get("source");
  const includeRead = scope === "all";
  const seededOnly = sourceParam === "seeded" || sourceParam === "fake";

  let query = supabase.from("emails").select("category, labels");
  if (!includeRead) {
    query = query.eq("is_read", false);
  }

  if (seededOnly) {
    query = query.like("id", "seed-%");
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts: Record<string, number> = {};

  for (const row of (data as Array<{ category: unknown; labels: unknown }>) ?? []) {
    const parsedLabels = normaliseLabels(row.labels);
    const fallbackCategory = normaliseLabel(row.category);

    const baseLabels = parsedLabels.length > 0
      ? parsedLabels
      : fallbackCategory
      ? [fallbackCategory]
      : [];

    const enrichedLabels = ensureDefaultLabelCoverage(baseLabels);
    const uniqueLabels = new Set(enrichedLabels.filter(Boolean));

    if (uniqueLabels.size === 0) {
      continue;
    }

    uniqueLabels.forEach((label) => {
      counts[label] = (counts[label] ?? 0) + 1;
    });
  }

  return NextResponse.json(counts);
}
