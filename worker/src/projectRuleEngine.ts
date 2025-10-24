import { randomUUID } from "node:crypto";

import {
  confidenceLevelToScore,
  evaluateProjectAssignmentRule,
  normalizeProjectAssignmentRuleInput,
  type EmailSentiment,
  type EmailTriageState,
  type ProjectAssignmentRule,
  type ProjectAssignmentRuleInput,
} from "@kazador/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

interface RuleRow {
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

export async function loadProjectAssignmentRulesForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<ProjectAssignmentRule[]> {
  const { data, error } = await supabase
    .from("project_assignment_rules")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to load project assignment rules", error);
    return [];
  }

  const rules: ProjectAssignmentRule[] = [];
  for (const row of data ?? []) {
    const record = row as RuleRow;
    const conditions = parseJson(record.conditions) ?? undefined;
    const actions = parseJson(record.actions) ?? undefined;
    const metadata = parseJson(record.metadata) ?? undefined;

    const normalized = normalizeProjectAssignmentRuleInput(
      {
        id: record.id,
        userId: record.user_id,
        projectId: record.project_id,
        name: record.name ?? undefined,
        description: record.description,
        enabled: record.enabled ?? undefined,
        sortOrder: record.sort_order ?? undefined,
        conditions: conditions as unknown,
        actions: actions as unknown,
        metadata: metadata as unknown,
      } satisfies ProjectAssignmentRuleInput,
      {
        id: record.id,
        userId,
        projectId: record.project_id,
        name: record.name ?? undefined,
        description: record.description,
        enabled: record.enabled ?? true,
        sortOrder: record.sort_order ?? 0,
        conditions: conditions as any,
        actions: actions as any,
        metadata: (metadata as Record<string, unknown>) ?? {},
        createdAt: record.created_at,
        updatedAt: record.updated_at,
      }
    );

    rules.push(normalized);
  }

  return rules;
}

export async function loadProjectRuleOverridesForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const overrides = new Set<string>();
  const { data, error } = await supabase
    .from("project_email_link_overrides")
    .select("project_id, email_id")
    .eq("user_id", userId);

  if (error) {
    console.error("Failed to load project rule overrides", error);
    return overrides;
  }

  for (const row of data ?? []) {
    const projectId = (row as { project_id?: string }).project_id;
    const emailId = (row as { email_id?: string }).email_id;
    if (projectId && emailId) {
      overrides.add(`${projectId}:${emailId}`);
    }
  }

  return overrides;
}

interface ProjectRuleEmailContext {
  id: string;
  subject: string;
  fromName: string | null;
  fromEmail: string;
  body: string;
  summary: string;
  category: string;
  labels: string[];
  priorityScore: number | null;
  triageState: string | null;
  receivedAt: string;
  hasAttachments: boolean;
  sentiment: EmailSentiment;
}

export async function applyProjectAssignmentRules(
  supabase: SupabaseClient,
  userId: string,
  email: ProjectRuleEmailContext,
  rules: ProjectAssignmentRule[],
  overrides: Set<string>
): Promise<void> {
  if (rules.length === 0) {
    return;
  }

  const projectKey = (projectId: string) => `${projectId}:${email.id}`;
  const existingLinks = new Set<string>();

  try {
    const { data: linkRows, error: linkError } = await supabase
      .from("project_email_links")
      .select("project_id")
      .eq("email_id", email.id)
      .in(
        "project_id",
        rules.map((rule) => rule.projectId)
      );

    if (linkError) {
      console.error("Failed to load existing project email links", linkError);
    } else {
      for (const row of linkRows ?? []) {
        const projectId = (row as { project_id?: string }).project_id;
        if (projectId) {
          existingLinks.add(projectKey(projectId));
        }
      }
    }
  } catch (err) {
    console.error("Unexpected error loading existing project email links", err);
  }

  const sortedRules = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);
  const nowIso = new Date().toISOString();

  for (const rule of sortedRules) {
    if (!rule.enabled) continue;

    const evaluation = evaluateProjectAssignmentRule(rule, {
      email: {
        id: email.id,
        subject: email.subject,
        fromName: email.fromName,
        fromEmail: email.fromEmail,
        category: email.category,
        labels: email.labels,
        priorityScore: email.priorityScore ?? null,
        triageState: (email.triageState as EmailTriageState) ?? undefined,
        receivedAt: email.receivedAt,
        attachments: email.hasAttachments ? [{ id: "placeholder", emailId: email.id, filename: "", mimeType: null, size: null, storageBucket: null, storagePath: null, sha256: null, metadata: {}, createdAt: nowIso }] : [],
        summary: email.summary,
        body: email.body,
        sentiment: email.sentiment,
      },
    });

    if (!evaluation.matched) {
      continue;
    }

    const key = projectKey(rule.projectId);
    if (overrides.has(key) || existingLinks.has(key)) {
      continue;
    }

    const confidenceScore = confidenceLevelToScore(rule.actions.confidence ?? "high") ?? 1;
    const metadata: Record<string, unknown> = {
      rule_id: rule.id,
      rule_name: rule.name,
      confidence_level: rule.actions.confidence ?? "high",
      note: rule.actions.note ?? null,
      linked_by: userId,
      linked_at: nowIso,
      source: "rule",
    };

    try {
      await supabase.from("project_email_links").insert({
        id: randomUUID(),
        project_id: rule.projectId,
        email_id: email.id,
        confidence: confidenceScore,
        source: "rule",
        metadata,
        created_at: nowIso,
      });
      existingLinks.add(key);
    } catch (err) {
      console.error("Failed to insert project email link for rule", rule.id, err);
    }
  }
}
