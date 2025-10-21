import type {
  ProjectAssignmentRule,
  ProjectAssignmentRuleInput,
  ProjectAssignmentRuleEvaluationMatch,
} from "@kazador/shared";

function buildHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

export interface ProjectAssignmentRuleListResponse {
  rules: ProjectAssignmentRule[];
}

export async function fetchProjectAssignmentRules(accessToken?: string): Promise<ProjectAssignmentRule[]> {
  const response = await fetch("/api/project-assignment-rules", {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load project assignment rules");
  }

  return Array.isArray(payload?.rules) ? (payload.rules as ProjectAssignmentRule[]) : [];
}

export async function createProjectAssignmentRule(
  input: ProjectAssignmentRuleInput,
  accessToken?: string
): Promise<ProjectAssignmentRule> {
  const response = await fetch("/api/project-assignment-rules", {
    method: "POST",
    headers: { ...buildHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ rule: input }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to create project assignment rule");
  }

  return payload.rule as ProjectAssignmentRule;
}

export async function updateProjectAssignmentRule(
  id: string,
  input: ProjectAssignmentRuleInput,
  accessToken?: string
): Promise<ProjectAssignmentRule> {
  const response = await fetch(`/api/project-assignment-rules/${id}`, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ rule: input }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to update project assignment rule");
  }

  return payload.rule as ProjectAssignmentRule;
}

export async function deleteProjectAssignmentRule(id: string, accessToken?: string): Promise<void> {
  const response = await fetch(`/api/project-assignment-rules/${id}`, {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  if (!response.ok && response.status !== 204) {
    let message = "Failed to delete project assignment rule";
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch (err) {
      // ignore json parse errors
    }
    throw new Error(message);
  }
}

export interface ProjectAssignmentRuleTestResult {
  emailId: string;
  subject: string;
  fromEmail: string;
  matched: boolean;
  matches: ProjectAssignmentRuleEvaluationMatch[];
}

export interface ProjectAssignmentRuleTestResponse {
  matchedCount: number;
  total: number;
  results: ProjectAssignmentRuleTestResult[];
}

export async function testProjectAssignmentRule(
  id: string,
  accessToken?: string
): Promise<ProjectAssignmentRuleTestResponse> {
  const response = await fetch(`/api/project-assignment-rules/${id}/test`, {
    method: "POST",
    headers: buildHeaders(accessToken),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to test project assignment rule");
  }

  return payload as ProjectAssignmentRuleTestResponse;
}

export interface ReplayProjectAssignmentRulesResponse {
  processed: number;
  linksCreated: number;
  skipped: number;
}

export async function replayProjectAssignmentRules(accessToken?: string): Promise<ReplayProjectAssignmentRulesResponse> {
  const response = await fetch("/api/project-assignment-rules/replay", {
    method: "POST",
    headers: buildHeaders(accessToken),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to re-run project assignment rules");
  }

  return payload as ReplayProjectAssignmentRulesResponse;
}
