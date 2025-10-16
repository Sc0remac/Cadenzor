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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (entry == null) return "";
      return String(entry).trim();
    })
    .filter((entry) => entry.length > 0);
}

function parsePayload(payload: any): PriorityConfigPayload {
  const presetRaw = payload?.preset;
  const preset =
    presetRaw && typeof presetRaw === "object"
      ? {
          slug: typeof presetRaw.slug === "string" ? presetRaw.slug : String(presetRaw.slug ?? ""),
          name: typeof presetRaw.name === "string" ? presetRaw.name : String(presetRaw.name ?? ""),
        }
      : null;
  const resolvedPreset = preset && preset.slug && preset.name ? preset : null;
  const resetCategories = normalizeStringArray(payload?.resetCategories);

  return {
    config: payload.config as PriorityConfig,
    source: (payload.source as PriorityConfigSource) ?? "default",
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
    preset: resolvedPreset,
    resetCategories: resetCategories.length > 0 ? resetCategories : null,
  } satisfies PriorityConfigPayload;
}

export interface PriorityConfigPayload {
  config: PriorityConfig;
  source: PriorityConfigSource;
  updatedAt: string | null;
  preset?: { slug: string; name: string } | null;
  resetCategories?: string[] | null;
}

export interface PriorityConfigPresetSummary {
  slug: string;
  name: string;
  description: string;
  recommendedScenarios: string[];
  adjustments: string[];
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

  return parsePayload(payload);
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

  return parsePayload(payload);
}

export async function fetchPriorityConfigPresets(
  accessToken?: string
): Promise<PriorityConfigPresetSummary[]> {
  const response = await fetch("/api/priority-config/presets", {
    method: "GET",
    headers: buildHeaders(accessToken),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to load priority presets");
  }

  const presetsRaw = Array.isArray(payload?.presets) ? payload.presets : [];
  return presetsRaw
    .map((preset: any) => ({
      slug: typeof preset.slug === "string" ? preset.slug : String(preset.slug ?? ""),
      name: typeof preset.name === "string" ? preset.name : String(preset.name ?? ""),
      description:
        typeof preset.description === "string"
          ? preset.description
          : String(preset.description ?? ""),
      recommendedScenarios: normalizeStringArray(preset?.recommendedScenarios),
      adjustments: normalizeStringArray(preset?.adjustments),
    }))
    .filter((preset: PriorityConfigPresetSummary) => preset.slug.length > 0 && preset.name.length > 0);
}

export async function applyPriorityPreset(
  slug: string,
  accessToken?: string
): Promise<PriorityConfigPayload> {
  const response = await fetch(`/api/priority-config/presets/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: buildHeaders(accessToken),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to apply priority preset");
  }

  return parsePayload(payload);
}

export async function resetPriorityConfig(
  options: { categories?: string[] } = {},
  accessToken?: string
): Promise<PriorityConfigPayload> {
  const categories = normalizeStringArray(options.categories);
  const hasCategories = categories.length > 0;
  const headers: HeadersInit = hasCategories
    ? { ...buildHeaders(accessToken), "Content-Type": "application/json" }
    : buildHeaders(accessToken);

  const response = await fetch("/api/priority-config/reset", {
    method: "POST",
    headers,
    body: hasCategories ? JSON.stringify({ categories }) : undefined,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to reset priority configuration");
  }

  return parsePayload(payload);
}
