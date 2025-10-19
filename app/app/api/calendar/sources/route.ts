import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { mapProjectSourceRow, mapProjectRow } from "@/lib/projectMappers";
import type { CalendarSourceSummary } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser(request);
  if (!auth.ok) {
    return formatError(auth.error, auth.status);
  }

  const { supabase, user } = auth;

  const { data: sourceRows, error } = await supabase
    .from("project_sources")
    .select("*, projects:projects(*)")
    .eq("kind", "calendar");

  if (error) {
    return formatError(error.message, 500);
  }

  const sources: CalendarSourceSummary[] = (sourceRows ?? []).map((row: any) => {
    const source = mapProjectSourceRow(row);
    const projectRow = row.projects ?? null;
    return {
      source,
      project: projectRow ? mapProjectRow(projectRow) : null,
    };
  });

  return NextResponse.json({ sources });
}
