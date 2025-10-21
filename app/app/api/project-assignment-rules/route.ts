import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import { assertProjectRole } from "@/lib/projectAccess";
import {
  normalizeProjectAssignmentRuleInput,
  type ProjectAssignmentRule,
  type ProjectAssignmentRuleInput,
} from "@kazador/shared";

export interface RuleRow {
  id: string;
  user_id: string;
  project_id: string;
  name: string | null;
  description: string | null;
  enabled: boolean | null;
  sort_order: number | null;
  conditions: unknown;
  actions: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch (err) {
    return null;
  }
}

export function mapRow(row: RuleRow): ProjectAssignmentRule {
  const conditions = parseJson(row.conditions) ?? undefined;
  const actions = parseJson(row.actions) ?? undefined;
  const metadata = parseJson(row.metadata) ?? undefined;

  const normalized = normalizeProjectAssignmentRuleInput(
    {
      id: row.id,
      userId: row.user_id,
      projectId: row.project_id,
      name: row.name ?? undefined,
      description: row.description,
      enabled: row.enabled ?? undefined,
      sortOrder: row.sort_order ?? undefined,
      conditions: conditions as unknown,
      actions: actions as unknown,
      metadata: metadata as unknown,
    } satisfies ProjectAssignmentRuleInput,
    {
      id: row.id,
      userId: row.user_id,
      projectId: row.project_id,
      name: row.name ?? undefined,
      description: row.description,
      enabled: row.enabled ?? true,
      sortOrder: row.sort_order ?? 0,
      conditions: (conditions as ProjectAssignmentRule["conditions"]) ?? undefined,
      actions: (actions as ProjectAssignmentRule["actions"]) ?? undefined,
      metadata: (metadata as Record<string, unknown>) ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );

  return {
    ...normalized,
    userId: row.user_id,
    projectId: normalized.projectId || row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildStorePayload(rule: ProjectAssignmentRule, userId: string) {
  return {
    id: rule.id,
    user_id: userId,
    project_id: rule.projectId,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    sort_order: rule.sortOrder,
    conditions: rule.conditions,
    actions: rule.actions,
    metadata: rule.metadata,
  };
}

export function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

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
  const projectId = payload.projectId ?? payload.actions?.projectId ?? null;
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
