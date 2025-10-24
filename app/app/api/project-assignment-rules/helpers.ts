import { NextResponse } from "next/server";
import {
  normalizeProjectAssignmentRuleInput,
  type ProjectAssignmentRule,
  type ProjectAssignmentRuleInput,
} from "@kazador/shared";

export { normalizeProjectAssignmentRuleInput };

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
