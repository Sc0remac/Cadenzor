import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/serverAuth";
import { createServerSupabaseClient } from "../../../../lib/serverSupabase";
import { mapLaneDefinitionRow } from "../../../../lib/projectMappers";
import type { TimelineLaneDefinition } from "@kazador/shared";

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function slugifyLane(name: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
  return base.length > 0 ? base : `LANE_${Date.now()}`;
}

function normaliseColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

async function loadLane(
  supabase: any,
  laneId: string,
  userId: string
): Promise<{ row: any | null; error: string | null }> {
  const { data, error } = await supabase.from("lane_definitions").select("*").eq("id", laneId).maybeSingle();
  if (error) {
    return { row: null, error: error.message };
  }
  if (!data) {
    return { row: null, error: "NOT_FOUND" };
  }
  if (data.user_id && data.user_id !== userId) {
    return { row: null, error: "FORBIDDEN" };
  }
  return { row: data, error: null };
}

interface Params {
  params: {
    laneId: string;
  };
}

export async function PATCH(request: Request, { params }: Params) {
  const { laneId } = params;
  if (!laneId) {
    return formatError("Lane id is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const laneLookup = await loadLane(supabase, laneId, user.id);
  if (laneLookup.error) {
    if (laneLookup.error === "NOT_FOUND") {
      return formatError("Lane not found", 404);
    }
    if (laneLookup.error === "FORBIDDEN") {
      return formatError("You cannot modify this lane", 403);
    }
    return formatError(laneLookup.error, 500);
  }

  const laneRow = laneLookup.row;
  const requiresAdminClient = laneRow.user_id == null;

  let targetClient = supabase;
  if (requiresAdminClient) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return formatError(
        "Workspace lanes can only be updated when SUPABASE_SERVICE_ROLE_KEY is configured on the server.",
        500
      );
    }
    const adminClientResult = createServerSupabaseClient();
    if (!adminClientResult.ok) {
      return formatError(adminClientResult.error, 500);
    }
    targetClient = adminClientResult.supabase;
  }

  let payload: Partial<TimelineLaneDefinition> & {
    autoAssignRules?: Record<string, unknown> | null;
    sortOrder?: number | null;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const updates: Record<string, unknown> = {};
  let nextSlug: string | null = null;

  if (typeof payload.name === "string") {
    const trimmed = payload.name.trim();
    if (!trimmed) {
      return formatError("Lane name cannot be empty", 400);
    }
    updates.name = trimmed;
    nextSlug = slugifyLane(trimmed);
  }

  if (typeof payload.slug === "string" && payload.slug.trim()) {
    nextSlug = payload.slug.trim().toUpperCase();
  }

  if (nextSlug && nextSlug !== laneLookup.row.slug) {
    const { data: slugRow, error: slugError } = await supabase
      .from("lane_definitions")
      .select("id")
      .eq("slug", nextSlug)
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .maybeSingle();

    if (slugError) {
      return formatError(slugError.message, 500);
    }

    if (slugRow && slugRow.id !== laneId) {
      return formatError("Another lane already uses this name", 409);
    }

    updates.slug = nextSlug;
  }

  if (payload.description !== undefined) {
    updates.description = typeof payload.description === "string" ? payload.description : null;
  }

  if (payload.color !== undefined) {
    updates.color = normaliseColor(payload.color);
  }

  if (payload.icon !== undefined) {
    updates.icon = typeof payload.icon === "string" ? payload.icon.trim() || null : null;
  }

  if (payload.isDefault !== undefined) {
    updates.is_default = Boolean(payload.isDefault);
  }

  if (payload.sortOrder !== undefined && payload.sortOrder !== null) {
    updates.sort_order = Math.trunc(Number(payload.sortOrder));
  }

  if (payload.autoAssignRules !== undefined) {
    updates.auto_assign_rules = payload.autoAssignRules ?? null;
  }

  if (Object.keys(updates).length === 0) {
    return formatError("No changes provided", 400);
  }

  const { data: updateRow, error: updateError } = await targetClient
    .from("lane_definitions")
    .update(updates)
    .eq("id", laneId)
    .select("*")
    .single();

  if (updateError) {
    return formatError(updateError.message, 500);
  }

  return NextResponse.json({ lane: mapLaneDefinitionRow(updateRow) });
}

export async function DELETE(request: Request, { params }: Params) {
  const { laneId } = params;
  if (!laneId) {
    return formatError("Lane id is required", 400);
  }

  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const laneLookup = await loadLane(supabase, laneId, user.id);
  if (laneLookup.error) {
    if (laneLookup.error === "NOT_FOUND") {
      return formatError("Lane not found", 404);
    }
    if (laneLookup.error === "FORBIDDEN") {
      return formatError("You cannot delete this lane", 403);
    }
    return formatError(laneLookup.error, 500);
  }

  const slug = laneLookup.row.slug as string;

  const { count: usageCount, error: usageError } = await supabase
    .from("project_items")
    .select("id", { count: "exact", head: true })
    .contains("labels", { lane: slug });

  if (usageError) {
    return formatError(usageError.message, 500);
  }

  if (usageCount && usageCount > 0) {
    return formatError("Lane is still used by timeline items", 409);
  }

  const { error: deleteError } = await supabase.from("lane_definitions").delete().eq("id", laneId);
  if (deleteError) {
    return formatError(deleteError.message, 500);
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
