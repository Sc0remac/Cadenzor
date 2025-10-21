import { NextResponse } from "next/server";
import {
  normaliseLabel,
  normaliseLabels,
  ensureDefaultLabelCoverage,
} from "@kazador/shared";
import type { EmailSource } from "@kazador/shared";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  const sourceParam = url.searchParams.get("source");
  const includeRead = scope === "all";
  const normalisedSourceParam = sourceParam?.toLowerCase() ?? null;
  const KNOWN_SOURCES = new Set<EmailSource>(["gmail", "seeded", "manual", "unknown"]);
  let sourceFilter: EmailSource | null = null;
  if (normalisedSourceParam) {
    if (normalisedSourceParam === "fake") {
      sourceFilter = "seeded";
    } else if (KNOWN_SOURCES.has(normalisedSourceParam as EmailSource)) {
      sourceFilter = normalisedSourceParam as EmailSource;
    }
  }

  let query = supabase.from("emails").select("category, labels, source").eq("user_id", user.id);
  if (!includeRead) {
    query = query.eq("is_read", false);
  }

  if (sourceFilter) {
    query = query.eq("source", sourceFilter);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts: Record<string, number> = {};

  for (const row of (data as Array<{ category: unknown; labels: unknown; source?: unknown }>) ?? []) {
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
