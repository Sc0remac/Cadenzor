import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import { mapLaneDefinitionRow } from "../../../lib/projectMappers";
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

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  const { data, error } = await supabase
    .from("lane_definitions")
    .select("*")
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) {
    return formatError(error.message, 500);
  }

  const lanes: TimelineLaneDefinition[] = (data ?? []).map(mapLaneDefinitionRow);
  return NextResponse.json({ lanes });
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase, user } = authResult;

  let payload: Partial<TimelineLaneDefinition> & {
    autoAssignRules?: Record<string, unknown> | null;
    sortOrder?: number | null;
    scope?: "global" | "user";
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch (err) {
    return formatError("Invalid JSON payload", 400);
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    return formatError("Lane name is required", 400);
  }

  const slug = payload.slug ? payload.slug.trim().toUpperCase() : slugifyLane(name);

  const { data: existingSlug, error: slugError } = await supabase
    .from("lane_definitions")
    .select("id")
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .eq("slug", slug)
    .maybeSingle();

  if (slugError) {
    return formatError(slugError.message, 500);
  }

  if (existingSlug) {
    return formatError("A lane with this name already exists", 409);
  }

  let sortOrder = typeof payload.sortOrder === "number" && Number.isFinite(payload.sortOrder)
    ? Math.trunc(payload.sortOrder)
    : null;

  if (sortOrder == null) {
    const { data: orderRows, error: orderError } = await supabase
      .from("lane_definitions")
      .select("sort_order")
      .or(`user_id.eq.${user.id},user_id.is.null`)
      .order("sort_order", { ascending: false, nullsLast: false })
      .limit(1);

    if (orderError) {
      return formatError(orderError.message, 500);
    }

    const maxOrder = orderRows?.[0]?.sort_order != null ? Number(orderRows[0].sort_order) : 0;
    sortOrder = maxOrder + 100;
  }

  const insertPayload = {
    name,
    slug,
    description: typeof payload.description === "string" ? payload.description : null,
    color: normaliseColor(payload.color),
    icon: typeof payload.icon === "string" ? payload.icon.trim() || null : null,
    sort_order: sortOrder,
    is_default: payload.isDefault ?? true,
    auto_assign_rules: payload.autoAssignRules ?? null,
    user_id: payload.scope === "global" ? null : user.id,
  };

  const { data: insertRow, error: insertError } = await supabase
    .from("lane_definitions")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) {
    return formatError(insertError.message, 500);
  }

  return NextResponse.json({ lane: mapLaneDefinitionRow(insertRow) }, { status: 201 });
}
