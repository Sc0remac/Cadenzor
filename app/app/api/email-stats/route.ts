import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function normaliseLabel(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().toLowerCase();
  }
  return "general";
}

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

function normaliseCounts(rows: Array<{ category: unknown; count: number }>) {
  const result: Record<string, number> = {};
  for (const row of rows) {
    const label = normaliseLabel(row.category);
    result[label] = (result[label] ?? 0) + Number(row.count || 0);
  }
  return result;
}

export async function GET() {
  const clientResult = createServiceClient();
  if (!clientResult.ok) {
    return NextResponse.json({ error: clientResult.error }, { status: 500 });
  }

  const { supabase } = clientResult;

  const { data, error } = await supabase
    .from("emails")
    .select("category, count: count()")
    .eq("is_read", false)
    .group("category");

  if (!error && data) {
    return NextResponse.json(normaliseCounts(data as any));
  }

  if (error) {
    console.error("Aggregation query failed, falling back to manual count", error);
  }

  const fallback = await supabase
    .from("emails")
    .select("category")
    .eq("is_read", false);

  if (fallback.error) {
    return NextResponse.json({ error: fallback.error.message }, { status: 500 });
  }

  const counts = normaliseCounts(
    (fallback.data as Array<{ category: unknown }>).map((row) => ({
      category: row.category,
      count: 1,
    }))
  );

  return NextResponse.json(counts);
}
