import type { TimelineLaneDefinition } from "@kazador/shared";

function buildHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

export interface LaneDefinitionInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  isDefault?: boolean;
  sortOrder?: number | null;
  autoAssignRules?: Record<string, unknown> | null;
  slug?: string;
  scope?: "global" | "user";
}

export async function fetchLaneDefinitions(accessToken?: string): Promise<TimelineLaneDefinition[]> {
  const response = await fetch("/api/timeline-lanes", {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load lane definitions");
  }

  return (payload.lanes ?? []) as TimelineLaneDefinition[];
}

export async function createLaneDefinition(
  input: Required<Pick<LaneDefinitionInput, "name">> & LaneDefinitionInput,
  accessToken?: string
): Promise<TimelineLaneDefinition> {
  const response = await fetch("/api/timeline-lanes", {
    method: "POST",
    headers: { ...buildHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ ...input }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to create lane");
  }

  return payload.lane as TimelineLaneDefinition;
}

export async function updateLaneDefinition(
  id: string,
  input: LaneDefinitionInput,
  accessToken?: string
): Promise<TimelineLaneDefinition> {
  const response = await fetch(`/api/timeline-lanes/${id}`, {
    method: "PATCH",
    headers: { ...buildHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ ...input }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to update lane");
  }

  return payload.lane as TimelineLaneDefinition;
}

export async function deleteLaneDefinition(id: string, accessToken?: string): Promise<void> {
  const response = await fetch(`/api/timeline-lanes/${id}`, {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  if (!response.ok) {
    let message = "Failed to delete lane";
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch (err) {
      // ignore JSON parsing error
    }
    throw new Error(message);
  }
}
