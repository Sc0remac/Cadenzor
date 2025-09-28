import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { EmailCategory, EmailRecord } from "@cadenzor/shared";
import { CATEGORY_VALUES } from "@cadenzor/shared";

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

const CATEGORY_SET = new Set<string>(CATEGORY_VALUES);

function normaliseCategory(value: unknown): EmailCategory {
  if (typeof value === "string" && CATEGORY_SET.has(value)) {
    return value as EmailCategory;
  }
  return "other";
}

function normaliseLabels(value: unknown): EmailCategory[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((label): label is EmailCategory => typeof label === "string" && CATEGORY_SET.has(label));
  }
  if (typeof value === "string" && CATEGORY_SET.has(value)) {
    return [value as EmailCategory];
  }
  return [];
}

function mapRow(row: any): EmailRecord {
  return {
    id: row.id,
    fromName: row.from_name,
    fromEmail: row.from_email,
    subject: row.subject,
    receivedAt: row.received_at,
    category: normaliseCategory(row.category),
    isRead: row.is_read,
    summary: row.summary ?? null,
    labels: normaliseLabels(row.labels),
  };
}

export async function GET(request: Request) {
  const clientResult = createServiceClient();
  if (!clientResult.ok) {
    return NextResponse.json({ error: clientResult.error }, { status: 500 });
  }

  const { supabase } = clientResult;

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 25, 1), 100);

  const { data, error } = await supabase
    .from("emails")
    .select(
      "id, from_name, from_email, subject, received_at, category, is_read, summary, labels"
    )
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = Array.isArray(data) ? data.map(mapRow) : [];

  return NextResponse.json({ items });
}
