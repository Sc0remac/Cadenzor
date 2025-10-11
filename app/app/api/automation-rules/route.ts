import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  normalizeAutomationRuleInput,
  type AutomationRule,
  type AutomationRuleInput,
} from "@kazador/shared";

interface AutomationRuleRow {
  id: string;
  user_id: string;
  name: string | null;
  description: string | null;
  is_enabled: boolean | null;
  trigger_type: string | null;
  trigger_config: unknown;
  condition_group: unknown;
  actions: unknown;
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

function mapRow(row: AutomationRuleRow): AutomationRule {
  const trigger = parseJson(row.trigger_config) ?? undefined;
  const conditions = parseJson(row.condition_group) ?? undefined;
  const actions = parseJson(row.actions) ?? undefined;

  const normalized = normalizeAutomationRuleInput(
    {
      id: row.id,
      name: row.name ?? undefined,
      description: row.description,
      isEnabled: row.is_enabled ?? undefined,
      trigger: trigger as any,
      conditions: conditions as any,
      actions: actions as any,
    } satisfies AutomationRuleInput,
    {
      id: row.id,
      name: row.name ?? undefined,
      description: row.description,
      isEnabled: row.is_enabled ?? undefined,
      trigger: trigger as any,
      conditions: conditions as any,
      actions: actions as any,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  );

  return {
    ...normalized,
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies AutomationRule;
}

function buildStorePayload(rule: AutomationRule, userId: string) {
  return {
    id: rule.id,
    user_id: userId,
    name: rule.name,
    description: rule.description,
    is_enabled: rule.isEnabled,
    trigger_type: rule.trigger.type,
    trigger_config: rule.trigger,
    condition_group: rule.conditions,
    actions: rule.actions,
  };
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;

  const { data, error } = await supabase
    .from("automation_rules")
    .select("*")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rules = (data ?? []).map((row) => mapRow(row as AutomationRuleRow));
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;

  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const payload = (body?.rule ?? body ?? {}) as AutomationRuleInput;
  const ruleId = randomUUID();
  const normalized = normalizeAutomationRuleInput({ ...payload, id: ruleId });

  const { data, error } = await supabase
    .from("automation_rules")
    .insert(buildStorePayload({ ...normalized, id: ruleId }, user.id))
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to create automation rule" }, { status: 500 });
  }

  return NextResponse.json({ rule: mapRow(data as AutomationRuleRow) }, { status: 201 });
}

