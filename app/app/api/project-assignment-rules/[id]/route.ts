import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  normalizeProjectAssignmentRuleInput,
  type ProjectAssignmentRule,
  type ProjectAssignmentRuleInput,
} from "@kazador/shared";
import type { RuleRow } from "../helpers";
import { mapRow, buildStorePayload, formatError } from "../helpers";

interface Params {
  params: {
    id: string;
  };
}

export async function GET(request: Request, { params }: Params) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { data, error } = await supabase
    .from("project_assignment_rules")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return formatError(error.message, 500);
  }
  if (!data) {
    return formatError("Project assignment rule not found", 404);
  }

  return NextResponse.json({ rule: mapRow(data as RuleRow) });
}

export async function PUT(request: Request, { params }: Params) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const payload = (body?.rule ?? body ?? {}) as ProjectAssignmentRuleInput;
  const projectId = payload.projectId ?? (payload.actions as any)?.projectId ?? null;

  if (!projectId) {
    return formatError("projectId is required to update a rule", 400);
  }

  try {
    await assertProjectRole(supabase, projectId, user.id, "editor");
  } catch (err: any) {
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  const normalized = normalizeProjectAssignmentRuleInput(
    {
      ...payload,
      id: params.id,
      userId: user.id,
      projectId,
    },
    {
      id: params.id,
      userId: user.id,
      projectId,
      updatedAt: new Date().toISOString(),
    }
  );

  const timestamp = new Date().toISOString();

  const { data, error } = await supabase
    .from("project_assignment_rules")
    .update({
      ...buildStorePayload({ ...normalized, userId: user.id } as ProjectAssignmentRule, user.id),
      updated_at: timestamp,
    })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select("*")
    .maybeSingle();

  if (error) {
    return formatError(error.message, 500);
  }
  if (!data) {
    return formatError("Project assignment rule not found", 404);
  }

  return NextResponse.json({ rule: mapRow(data as RuleRow) });
}

export async function DELETE(request: Request, { params }: Params) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { error } = await supabase
    .from("project_assignment_rules")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({ success: true });
}
