import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  evaluateProjectAssignmentRule,
  type ProjectAssignmentRuleEvaluationResult,
  type EmailTriageState,
} from "@kazador/shared";
import type { RuleRow } from "../../helpers";
import { mapRow, formatError } from "../../helpers";

interface Params {
  params: {
    id: string;
  };
}

export async function POST(request: Request, { params }: Params) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { data: ruleRow, error: ruleError } = await supabase
    .from("project_assignment_rules")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (ruleError) {
    return formatError(ruleError.message, 500);
  }
  if (!ruleRow) {
    return formatError("Project assignment rule not found", 404);
  }

  const rule = mapRow(ruleRow as RuleRow);

  const { data: emailRows, error: emailsError } = await supabase
    .from("emails")
    .select("id, subject, from_name, from_email, category, labels, priority_score, triage_state, received_at, summary, has_attachments")
    .eq("user_id", user.id)
    .order("received_at", { ascending: false })
    .limit(50);

  if (emailsError) {
    return formatError(emailsError.message, 500);
  }

  const now = new Date();
  const results = (emailRows ?? []).map((row) => {
    const evaluation: ProjectAssignmentRuleEvaluationResult = evaluateProjectAssignmentRule(rule, {
      email: {
        id: row.id as string,
        subject: (row.subject as string) ?? "",
        fromName: (row.from_name as string) ?? null,
        fromEmail: (row.from_email as string) ?? "",
        category: (row.category as string) ?? "",
        labels: Array.isArray(row.labels) ? (row.labels as string[]) : [],
        priorityScore: row.priority_score != null ? Number(row.priority_score) : null,
        triageState: (row.triage_state as EmailTriageState | null | undefined) ?? undefined,
        receivedAt: String(row.received_at),
        attachments: [],
        summary: (row.summary as string) ?? null,
      },
      now,
    });

    return {
      emailId: row.id as string,
      subject: (row.subject as string) ?? "",
      fromEmail: (row.from_email as string) ?? "",
      matched: evaluation.matched,
      matches: evaluation.matches,
    };
  });

  const matchedCount = results.filter((result) => result.matched).length;

  return NextResponse.json({
    matchedCount,
    total: results.length,
    results,
  });
}
