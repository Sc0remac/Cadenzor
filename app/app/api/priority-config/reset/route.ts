import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  DEFAULT_PRIORITY_CONFIG,
  clonePriorityConfig,
  type PriorityConfig,
} from "@kazador/shared";
import {
  buildResponse,
  cloneStoredConfig,
  ensurePreferenceRow,
  formatError,
  persistPriorityConfig,
} from "../utils";

interface ResetPayload {
  categories?: unknown;
}

function normalizeCategories(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    seen.add(trimmed);
  }
  return Array.from(seen.values());
}

function applyCategoryResets(config: PriorityConfig, categories: string[]): PriorityConfig {
  if (categories.length === 0) {
    return clonePriorityConfig(DEFAULT_PRIORITY_CONFIG);
  }

  const next = clonePriorityConfig(config);
  for (const category of categories) {
    const defaultWeight =
      DEFAULT_PRIORITY_CONFIG.email.categoryWeights[category] ??
      DEFAULT_PRIORITY_CONFIG.email.defaultCategoryWeight;
    next.email.categoryWeights[category] = defaultWeight;
  }
  return next;
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let payload: ResetPayload = {};
  try {
    if (request.headers.get("content-length")) {
      payload = (await request.json()) as ResetPayload;
    }
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  try {
    const categories = normalizeCategories(payload.categories);
    const preferenceRow = await ensurePreferenceRow(supabase, user.id);
    const currentConfig = cloneStoredConfig(preferenceRow);
    const nextConfig = applyCategoryResets(currentConfig, categories);
    const updatedRow = await persistPriorityConfig(supabase, user.id, nextConfig);
    const response = buildResponse(updatedRow);
    return NextResponse.json({ ...response, resetCategories: categories });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reset priority configuration";
    return formatError(message, 500);
  }
}
