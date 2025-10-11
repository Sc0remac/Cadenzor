import type { PriorityConfig, PriorityConfigSource } from "@kazador/shared";

function buildHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

export interface PriorityConfigPayload {
  config: PriorityConfig;
  source: PriorityConfigSource;
  updatedAt: string | null;
}

export async function fetchPriorityConfig(accessToken?: string): Promise<PriorityConfigPayload> {
  const response = await fetch("/api/priority-config", {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load priority configuration");
  }

  return {
    config: payload.config as PriorityConfig,
    source: (payload.source as PriorityConfigSource) ?? "default",
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
  } satisfies PriorityConfigPayload;
}

export async function updatePriorityConfig(
  config: PriorityConfig,
  accessToken?: string
): Promise<PriorityConfigPayload> {
  const response = await fetch("/api/priority-config", {
    method: "PUT",
    headers: {
      ...buildHeaders(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ config }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to save priority configuration");
  }

  return {
    config: payload.config as PriorityConfig,
    source: (payload.source as PriorityConfigSource) ?? "default",
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
  } satisfies PriorityConfigPayload;
}
