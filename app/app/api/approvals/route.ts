import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import { assertProjectRole } from "../../../lib/projectAccess";
import { applyApprovalAction } from "../../../lib/approvalActions";
import { mapApprovalRow } from "../../../lib/projectMappers";

interface ActionPayload {
  approvalId: string;
  action: "approve" | "decline";
  note?: string;
}

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
  const statusFilter = searchParams.get("status");

  let projectIds: string[] = [];

  if (projectId) {
    try {
      await assertProjectRole(supabase, projectId, user.id, "viewer");
      projectIds = [projectId];
    } catch (err: any) {
      const status = err?.status ?? 403;
      return formatError(err?.message || "Forbidden", status);
    }
  } else {
    const { data: membershipRows, error: membershipError } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);

    if (membershipError) {
      return formatError(membershipError.message, 500);
    }

    if (!membershipRows || membershipRows.length === 0) {
      return NextResponse.json({ approvals: [] });
    }

    projectIds = membershipRows
      .map((row) => row.project_id as string | null)
      .filter((value): value is string => Boolean(value));
  }

  if (projectIds.length === 0) {
    return NextResponse.json({ approvals: [] });
  }

  let query = supabase
    .from("approvals")
    .select("*")
    .in("project_id", projectIds)
    .order("created_at", { ascending: true });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ approvals: (data ?? []).map(mapApprovalRow) });
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let payload: ActionPayload;
  try {
    payload = (await request.json()) as ActionPayload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.approvalId) {
    return formatError("approvalId is required", 400);
  }

  if (payload.action !== "approve" && payload.action !== "decline") {
    return formatError("action must be approve or decline", 400);
  }

  try {
    const approval = await applyApprovalAction(supabase, payload.approvalId, payload.action, user.id, payload.note);
    return NextResponse.json({ approval });
  } catch (err: any) {
    const message = err?.message ?? "Failed to process approval";
    return formatError(message, 500);
  }
}
