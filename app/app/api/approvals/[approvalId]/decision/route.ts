import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/serverAuth";
import { assertProjectRole } from "../../../../../lib/projectAccess";
import { mapApprovalRow } from "../../../../../lib/projectMappers";
import { applyApproval } from "../../../../../lib/approvalActions";
import type { ApprovalDecisionInput } from "@cadenzor/shared";

interface Params {
  params: {
    approvalId: string;
  };
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, { params }: Params) {
  const { approvalId } = params;
  if (!approvalId) {
    return formatError("approvalId is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let payload: ApprovalDecisionInput;
  try {
    payload = (await request.json()) as ApprovalDecisionInput;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!payload?.status || (payload.status !== "approved" && payload.status !== "declined")) {
    return formatError("status must be approved or declined", 400);
  }

  const { data, error } = await supabase
    .from("approvals")
    .select("*")
    .eq("id", approvalId)
    .maybeSingle();

  if (error) {
    return formatError(error.message, 500);
  }

  if (!data) {
    return formatError("Approval not found", 404);
  }

  const approval = mapApprovalRow(data);

  if (approval.status !== "pending") {
    return formatError("Approval already resolved", 409);
  }

  if (approval.projectId) {
    try {
      await assertProjectRole(supabase, approval.projectId, user.id, "editor");
    } catch (err: any) {
      return formatError(err?.message || "Forbidden", err?.status ?? 403);
    }
  }

  if (payload.status === "approved") {
    const applyResult = await applyApproval(supabase, approval, user.id);
    if (!applyResult.ok) {
      return formatError(applyResult.error ?? "Failed to apply approval", applyResult.status ?? 400);
    }
  }

  const updatePayload: Record<string, unknown> = {
    status: payload.status,
    approver_id: user.id,
    resolution_note: payload.resolutionNote ?? null,
  };

  if (payload.status === "approved") {
    updatePayload["approved_at"] = new Date().toISOString();
  } else {
    updatePayload["declined_at"] = new Date().toISOString();
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from("approvals")
    .update(updatePayload)
    .eq("id", approvalId)
    .select("*")
    .maybeSingle();

  if (updateError) {
    return formatError(updateError.message, 500);
  }

  return NextResponse.json({ approval: mapApprovalRow(updatedRow) });
}
