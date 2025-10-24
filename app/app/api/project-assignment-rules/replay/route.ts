import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  evaluateProjectAssignmentRule,
  confidenceLevelToScore,
  type ProjectAssignmentRule,
} from "@kazador/shared";
import type { RuleRow } from "../helpers";
import { mapRow, formatError } from "../helpers";

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(metadata).filter(([, value]) => value != null);
  return Object.fromEntries(entries);
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { data: ruleRows, error: ruleError } = await supabase
    .from("project_assignment_rules")
    .select("*")
    .eq("user_id", user.id)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (ruleError) {
    return formatError(ruleError.message, 500);
  }

  const rules: ProjectAssignmentRule[] = (ruleRows ?? []).map((row) => mapRow(row as RuleRow));

  if (rules.length === 0) {
    return NextResponse.json({ processed: 0, linksCreated: 0, skipped: 0 });
  }

  const projectIds = Array.from(new Set(rules.map((rule) => rule.projectId).filter(Boolean)));
  if (projectIds.length === 0) {
    return NextResponse.json({ processed: 0, linksCreated: 0, skipped: 0 });
  }

  const chunkSize = 200;
  let offset = 0;
  let processed = 0;
  let created = 0;
  let skipped = 0;
  const now = new Date();
  const nowIso = now.toISOString();

  for (;;) {
    const { data: emailRows, error: emailError } = await supabase
      .from("emails")
      .select("id, subject, from_name, from_email, category, labels, priority_score, triage_state, received_at, summary")
      .eq("user_id", user.id)
      .order("received_at", { ascending: false })
      .range(offset, offset + chunkSize - 1);

    if (emailError) {
      return formatError(emailError.message, 500);
    }

    if (!emailRows || emailRows.length === 0) {
      break;
    }

    processed += emailRows.length;
    const emailIds = emailRows.map((row) => row.id as string);

    const { data: existingLinks, error: linkError } = await supabase
      .from("project_email_links")
      .select("project_id, email_id")
      .in("email_id", emailIds)
      .in("project_id", projectIds);

    if (linkError) {
      return formatError(linkError.message, 500);
    }

    const existing = new Set<string>(
      (existingLinks ?? []).map((row) => `${row.project_id as string}:${row.email_id as string}`)
    );

    const { data: overrideRows, error: overrideError } = await supabase
      .from("project_email_link_overrides")
      .select("project_id, email_id")
      .eq("user_id", user.id)
      .in("email_id", emailIds)
      .in("project_id", projectIds);

    if (overrideError) {
      return formatError(overrideError.message, 500);
    }

    const overrides = new Set<string>(
      (overrideRows ?? []).map((row) => `${row.project_id as string}:${row.email_id as string}`)
    );

    const insertPayloads: Array<Record<string, unknown>> = [];

    for (const row of emailRows) {
      const emailId = row.id as string;
      const emailContext = {
        id: emailId,
        subject: (row.subject as string) ?? "",
        fromName: (row.from_name as string) ?? null,
        fromEmail: (row.from_email as string) ?? "",
        category: (row.category as string) ?? "",
        labels: Array.isArray(row.labels) ? (row.labels as string[]) : [],
        priorityScore: row.priority_score != null ? Number(row.priority_score) : null,
        triageState: (row.triage_state as string) ?? null,
        receivedAt: String(row.received_at),
        attachments: [],
        summary: (row.summary as string) ?? null,
      };

      for (const rule of rules) {
        const evaluation = evaluateProjectAssignmentRule(rule, { email: emailContext, now });
        if (!evaluation.matched) {
          continue;
        }

        const key = `${rule.projectId}:${emailId}`;
        if (existing.has(key) || overrides.has(key)) {
          skipped += 1;
          continue;
        }

        existing.add(key);
        const confidenceScore = confidenceLevelToScore(rule.actions.confidence ?? "high") ?? 1;
        const metadata = sanitizeMetadata({
          rule_id: rule.id,
          rule_name: rule.name,
          note: rule.actions.note ?? null,
          confidence_level: rule.actions.confidence ?? null,
          linked_by: user.id,
          linked_at: nowIso,
          source: "rule",
          matches: evaluation.matches,
          lane_id: rule.actions.assignToLaneId ?? null,
        });

        insertPayloads.push({
          project_id: rule.projectId,
          email_id: emailId,
          confidence: confidenceScore,
          source: "rule",
          metadata,
          created_at: nowIso,
        });
      }
    }

    if (insertPayloads.length > 0) {
      const { error: insertError } = await supabase.from("project_email_links").insert(insertPayloads);

      if (insertError) {
        return formatError(insertError.message, 500);
      }

      created += insertPayloads.length;
    }

    offset += chunkSize;
    if (emailRows.length < chunkSize) {
      break;
    }
  }

  return NextResponse.json({
    processed,
    linksCreated: created,
    skipped,
  });
}
