import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { EmailCategory, EmailRecord } from "@cadenzor/shared";

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

function normaliseCounts(
  rows: Array<{ category: EmailRecord["category"]; count: number }>
): Record<EmailRecord["category"], number> {
  const result: Partial<Record<EmailCategory, number>> = {};
  for (const row of rows) {
    if (!row?.category) continue;
    result[row.category] = (result[row.category] ?? 0) + Number(row.count || 0);
  }
  return result as Record<EmailRecord["category"], number>;
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
    (fallback.data as Array<{ category: EmailRecord["category"] }>).map((row) => ({
      category: row.category,
      count: 1,
    }))
  );

  return NextResponse.json(counts);
}
