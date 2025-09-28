import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  normaliseLabel,
  normaliseLabels,
  ensureDefaultLabelCoverage,
  selectPrimaryCategory,
} from "@cadenzor/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function createServiceClient() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    return {
      ok: false as const,
      error: `Missing required environment variables: ${missing.join(", ")}`,
    };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  return { ok: true as const, supabase };
}

export async function GET() {
  const clientResult = createServiceClient();
  if (!clientResult.ok) {
    return NextResponse.json({ error: clientResult.error }, { status: 500 });
  }

  const { supabase } = clientResult;

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
