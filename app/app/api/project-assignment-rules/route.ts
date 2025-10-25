import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import type { ProjectAssignmentRule } from "@kazador/shared";
import { mapRow, buildStorePayload, formatError, normalizeProjectAssignmentRuleInput, type RuleRow } from "./helpers";
import type { ProjectAssignmentRuleInput } from "@kazador/shared";

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { data, error } = await supabase
    .from("project_assignment_rules")
    .select("*")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return formatError(error.message, 500);
  }

  return NextResponse.json({
    rules: (data ?? []).map((row) => mapRow(row as RuleRow)),
  });
}

export async function POST(request: Request) {
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
    return formatError("projectId is required to create a rule", 400);
  }

  try {
    await assertProjectRole(supabase, projectId, user.id, "editor");
  } catch (err: any) {
    return formatError(err?.message || "Forbidden", err?.status ?? 403);
  }

  const ruleId = randomUUID();
  const normalized = normalizeProjectAssignmentRuleInput(
    {
      ...payload,
      id: ruleId,
      userId: user.id,
      projectId,
    },
    {
      id: ruleId,
      userId: user.id,
      projectId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  );

  if (!normalized.projectId) {
    return formatError("A target project is required for this rule", 400);
  }

  const { data, error } = await supabase
    .from("project_assignment_rules")
    .insert(buildStorePayload({ ...normalized, userId: user.id }, user.id))
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return formatError(error?.message ?? "Failed to create project assignment rule", 500);
  }

  return NextResponse.json({ rule: mapRow(data as RuleRow) }, { status: 201 });
}
