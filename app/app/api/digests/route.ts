import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import type { DigestRecord, DigestPayload } from "@cadenzor/shared";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function mapDigestRow(row: any): DigestRecord {
  const rawPayload = row.payload;
  let payload: DigestPayload;

  if (rawPayload && typeof rawPayload === "object") {
    payload = rawPayload as DigestPayload;
  } else {
    try {
      payload = JSON.parse(String(rawPayload)) as DigestPayload;
    } catch (err) {
      payload = {
        generatedAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
        topActions: [],
        projects: [],
        meta: {
          totalProjects: 0,
          totalPendingApprovals: 0,
          highlightedProjects: 0,
        },
      } satisfies DigestPayload;
    }
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    generatedFor: String(row.generated_for),
    channel: row.channel as DigestRecord["channel"],
    status: row.status as DigestRecord["status"],
    payload,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    createdAt: String(row.created_at),
  } satisfies DigestRecord;
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { data, error } = await supabase
    .from("digests")
    .select("*")
    .eq("user_id", user.id)
    .order("generated_for", { ascending: false })
    .limit(20);

  if (error) {
    return formatError(error.message, 500);
  }

  const digests = (data ?? []).map(mapDigestRow);

  return NextResponse.json({ digests });
}
