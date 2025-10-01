import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import { assertProjectRole } from "../../../lib/projectAccess";
import { mapApprovalRow } from "../../../lib/projectMappers";
import type { ApprovalStatus } from "@cadenzor/shared";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const status = searchParams.get("status") as ApprovalStatus | null;

  if (!projectId) {
    return formatError("projectId is required", 400);
  }

  try {
    await assertProjectRole(supabase, projectId, user.id, "viewer");
  } catch (err: any) {
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  let query = supabase
    .from("approvals")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return formatError(error.message, 500);
  }

  const approvals = (data ?? []).map(mapApprovalRow);
  return NextResponse.json({ approvals });
}
