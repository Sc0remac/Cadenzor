import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/serverAuth";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 25;

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function sanitizeForPattern(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const withoutSeparators = trimmed.replace(/[%,()]/g, " ");
  const normalised = withoutSeparators.replace(/\s+/g, " ").trim();
  if (!normalised) {
    return "";
  }

  return `%${normalised.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase } = authResult;

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const pattern = sanitizeForPattern(query);

  if (!pattern) {
    return NextResponse.json({ profiles: [] });
  }

  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .or(`email.ilike.${pattern},full_name.ilike.${pattern}`)
    .order("full_name", { ascending: true, nullsFirst: false })
    .order("email", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) {
    return formatError(error.message, 500);
  }

  const profiles = (data ?? []).map((row) => ({
    id: row.id as string,
    email: (row.email as string) ?? null,
    fullName: (row.full_name as string) ?? null,
  }));

  return NextResponse.json({ profiles });
}
