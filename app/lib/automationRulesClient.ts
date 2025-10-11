import type { AutomationRule, AutomationRuleInput } from "@kazador/shared";

function buildHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

export interface AutomationRuleListResponse {
  rules: AutomationRule[];
}

export async function fetchAutomationRules(accessToken?: string): Promise<AutomationRule[]> {
  const response = await fetch("/api/automation-rules", {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load automation rules");
  }

  return (payload.rules ?? []) as AutomationRule[];
}

export async function createAutomationRule(
  input: AutomationRuleInput,
  accessToken?: string
): Promise<AutomationRule> {
  const response = await fetch("/api/automation-rules", {
    method: "POST",
    headers: { ...buildHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ rule: input }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to create automation rule");
  }

  return payload.rule as AutomationRule;
}

export async function updateAutomationRule(
  id: string,
  input: AutomationRuleInput,
  accessToken?: string
): Promise<AutomationRule> {
  const response = await fetch(`/api/automation-rules/${id}`, {
    method: "PUT",
    headers: { ...buildHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ rule: input }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to update automation rule");
  }

  return payload.rule as AutomationRule;
}

export async function deleteAutomationRule(id: string, accessToken?: string): Promise<void> {
  const response = await fetch(`/api/automation-rules/${id}`, {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  if (!response.ok && response.status !== 204) {
    let message = "Failed to delete automation rule";
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch (err) {
      // ignore json parse errors
    }
    throw new Error(message);
  }
}

