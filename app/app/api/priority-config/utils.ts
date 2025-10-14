import { NextResponse } from "next/server";
import {
  DEFAULT_PRIORITY_CONFIG,
  clonePriorityConfig,
  isPriorityConfigEqual,
  normalizePriorityConfigInput,
  type PriorityConfig,
  type PriorityConfigInput,
  type PriorityConfigSource,
} from "@kazador/shared";

export interface PreferenceRow {
  id: string;
  user_id: string;
  priority_config: unknown;
  created_at: string;
  updated_at: string | null;
  priority_config_updated_at?: string | null;
}

export interface PriorityConfigResponsePayload {
  config: PriorityConfig;
  source: PriorityConfigSource;
  updatedAt: string | null;
}

export function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function parseStoredConfig(value: unknown): {
  config: PriorityConfig;
  source: PriorityConfigSource;
} {
  if (!value) {
    return { config: DEFAULT_PRIORITY_CONFIG, source: "default" };
  }

  try {
    const parsed = typeof value === "object" ? value : JSON.parse(String(value));
    const config = normalizePriorityConfigInput(parsed as PriorityConfigInput);
    if (isPriorityConfigEqual(config, DEFAULT_PRIORITY_CONFIG)) {
      return { config: DEFAULT_PRIORITY_CONFIG, source: "default" };
    }
    return { config, source: "custom" };
  } catch (err) {
    return { config: DEFAULT_PRIORITY_CONFIG, source: "default" };
  }
}

export async function ensurePreferenceRow(supabase: any, userId: string): Promise<PreferenceRow> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("id, user_id, priority_config, created_at, updated_at, priority_config_updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data as PreferenceRow;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("user_preferences")
    .insert({ user_id: userId })
    .select("id, user_id, priority_config, created_at, updated_at, priority_config_updated_at")
    .maybeSingle();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to provision user preferences");
  }

  return inserted as PreferenceRow;
}

export function buildResponse(row: PreferenceRow): PriorityConfigResponsePayload {
  const { config, source } = parseStoredConfig(row.priority_config);
  const updatedAt = row.priority_config_updated_at ?? row.updated_at ?? row.created_at ?? null;
  return {
    config,
    source,
    updatedAt: updatedAt ? String(updatedAt) : null,
  };
}

export function cloneStoredConfig(row: PreferenceRow): PriorityConfig {
  const { config } = parseStoredConfig(row.priority_config);
  return clonePriorityConfig(config);
}

export async function persistPriorityConfig(
  supabase: any,
  userId: string,
  config: PriorityConfig
): Promise<PreferenceRow> {
  await ensurePreferenceRow(supabase, userId);

  const timestamp = new Date().toISOString();
  const storeValue = isPriorityConfigEqual(config, DEFAULT_PRIORITY_CONFIG) ? null : config;

  const { data, error } = await supabase
    .from("user_preferences")
    .update({
      priority_config: storeValue,
      updated_at: timestamp,
      priority_config_updated_at: timestamp,
    })
    .eq("user_id", userId)
    .select("id, user_id, priority_config, created_at, updated_at, priority_config_updated_at")
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error("Failed to update priority configuration");
  }

  return data as PreferenceRow;
}

export function mergeOverrides(
  base: PriorityConfig,
  overrides: PriorityConfigInput | null | undefined
): PriorityConfig {
  return normalizePriorityConfigInput(overrides ?? null, base);
}
