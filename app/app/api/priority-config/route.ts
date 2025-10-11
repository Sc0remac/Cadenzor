import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/serverAuth";
import {
  DEFAULT_PRIORITY_CONFIG,
  isPriorityConfigEqual,
  normalizePriorityConfigInput,
  type PriorityConfig,
  type PriorityConfigInput,
  type PriorityConfigSource,
} from "@kazador/shared";

interface PreferenceRow {
  id: string;
  user_id: string;
  priority_config: unknown;
  created_at: string;
  updated_at: string | null;
  priority_config_updated_at?: string | null;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parseStoredConfig(value: unknown): { config: PriorityConfig; source: PriorityConfigSource } {
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

async function ensurePreferenceRow(supabase: any, userId: string): Promise<PreferenceRow> {
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

function buildResponse(row: PreferenceRow) {
  const { config, source } = parseStoredConfig(row.priority_config);
  const updatedAt = row.priority_config_updated_at ?? row.updated_at ?? row.created_at ?? null;
  return {
    config,
    source,
    updatedAt: updatedAt ? String(updatedAt) : null,
  };
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  try {
    const row = await ensurePreferenceRow(supabase, user.id);
    const payload = buildResponse(row);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load priority configuration";
    return formatError(message, 500);
  }
}

export async function PUT(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  if (!body || typeof body !== "object") {
    return formatError("Request body must be an object", 400);
  }

  const input = (body.config ?? body.overrides ?? null) as PriorityConfigInput | null;
  const normalized = normalizePriorityConfigInput(input);
  const storeValue = isPriorityConfigEqual(normalized, DEFAULT_PRIORITY_CONFIG) ? null : normalized;

  try {
    await ensurePreferenceRow(supabase, user.id);
    const timestamp = new Date().toISOString();
    const { data, error } = await supabase
      .from("user_preferences")
      .update({
        priority_config: storeValue,
        updated_at: timestamp,
        priority_config_updated_at: timestamp,
      })
      .eq("user_id", user.id)
      .select("id, user_id, priority_config, created_at, updated_at, priority_config_updated_at")
      .maybeSingle();

    if (error || !data) {
      throw error ?? new Error("Failed to update priority configuration");
    }

    const payload = buildResponse(data as PreferenceRow);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update priority configuration";
    return formatError(message, 500);
  }
}
