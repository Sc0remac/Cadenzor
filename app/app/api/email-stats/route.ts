import { NextResponse } from "next/server";
import {
  normaliseLabel,
  normaliseLabels,
  ensureDefaultLabelCoverage,
  selectPrimaryCategory,
} from "@cadenzor/shared";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase } = authResult;

  const { data, error } = await supabase
    .from("emails")
    .select("category, labels")
    .eq("is_read", false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts: Record<string, number> = {};

  for (const row of (data as Array<{ category: unknown; labels: unknown }>) ?? []) {
    const parsedLabels = normaliseLabels(row.labels);
    const withFallback = parsedLabels.length > 0 ? parsedLabels : normaliseLabels([row.category]);
    const enrichedLabels = ensureDefaultLabelCoverage(withFallback);

    if (enrichedLabels.length === 0) {
      continue;
    }

    const category = selectPrimaryCategory(enrichedLabels) ?? normaliseLabel(row.category);
    if (!category) {
      continue;
    }

    counts[category] = (counts[category] ?? 0) + 1;
  }

  return NextResponse.json(counts);
}
