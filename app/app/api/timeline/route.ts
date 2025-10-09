import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import {
  mapProjectRow,
  mapTimelineDependencyRow,
  mapTimelineItemRow,
} from "../../../lib/projectMappers";
import type { ProjectRecord, TimelineItemRecord } from "@cadenzor/shared";

function parseEntryTypes(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function normaliseIsoTimestamp(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return null;
  }
  return new Date(ms).toISOString();
}

function toMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function itemMatchesRange(
  item: { startsAt: string | null; endsAt: string | null },
  rangeStartMs: number | null,
  rangeEndMs: number | null
): boolean {
  if (rangeStartMs == null && rangeEndMs == null) {
    return true;
  }

  const startMs = item.startsAt ? toMs(item.startsAt) : null;
  const endMs = item.endsAt ? toMs(item.endsAt) : null;

  if (startMs == null && endMs == null) {
    return false;
  }

  const effectiveStart = startMs ?? endMs ?? null;
  const effectiveEnd = endMs ?? startMs ?? null;

  if (effectiveStart == null || effectiveEnd == null) {
    return false;
  }

  if (rangeStartMs != null && effectiveEnd < rangeStartMs) {
    return false;
  }

  if (rangeEndMs != null && effectiveStart > rangeEndMs) {
    return false;
  }

  return true;
}

function coerceEntryType(item: TimelineItemRecord): string {
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const candidate = [
    metadata.entryType,
    metadata.entry_type,
    metadata.category,
    metadata.kind,
    item.type,
    item.lane,
  ]
    .map((value) =>
      typeof value === "string"
        ? value.toLowerCase()
        : Array.isArray(value) && value.length > 0
        ? String(value[0]).toLowerCase()
        : null
    )
    .find((value) => value && value.length > 0);

  switch (candidate) {
    case "milestone":
    case "milestones":
    case "gate":
      return "milestone";
    case "email":
    case "emails":
    case "urgent email":
      return "email";
    case "meeting":
    case "meetings":
    case "calendar":
    case "call":
      return "meeting";
    case "interview":
    case "interviews":
      return "interview";
    case "promo":
    case "promos":
    case "promotion":
    case "press":
    case "event":
    case "lead":
      return "promo";
    case "note":
    case "notes":
      return "note";
    case "comment":
    case "comments":
    case "feedback":
      return "comment";
    case "travel":
    case "travel buffer":
      return "travel";
    case "hold":
    case "holdback":
      return "hold";
    case "task":
    case "tasks":
    case "writing":
    case "band":
    case "live":
    case "release":
    default:
      return "task";
  }
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const entryTypes = parseEntryTypes(searchParams.get("entryTypes"));
  const rangeStart = normaliseIsoTimestamp(searchParams.get("rangeStart"));
  const rangeEnd = normaliseIsoTimestamp(searchParams.get("rangeEnd"));

  const { data: membershipRow, error: membershipError } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id)
    .eq("project_id", projectId)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (!membershipRow) {
    return NextResponse.json({ error: "You do not have access to this project" }, { status: 403 });
  }

  const { data: projectRow, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }

  if (!projectRow) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project: ProjectRecord = mapProjectRow(projectRow);

  const { data: timelineRows, error: timelineError } = await supabase
    .from("timeline_items")
    .select("*")
    .eq("project_id", projectId)
    .order("starts_at", { ascending: true });

  if (timelineError) {
    return NextResponse.json({ error: timelineError.message }, { status: 500 });
  }

  const { data: dependencyRows, error: dependencyError } = await supabase
    .from("timeline_dependencies")
    .select("*")
    .eq("project_id", projectId);

  if (dependencyError) {
    return NextResponse.json({ error: dependencyError.message }, { status: 500 });
  }

  const items = (timelineRows ?? []).map(mapTimelineItemRow);
  const dependencies = (dependencyRows ?? []).map(mapTimelineDependencyRow);

  const startMs = rangeStart ? Date.parse(rangeStart) : null;
  const endMs = rangeEnd ? Date.parse(rangeEnd) : null;

  const filteredItems = items.filter((item) => itemMatchesRange(item, startMs, endMs));
  const typeFilter = entryTypes.length > 0 ? new Set(entryTypes) : null;
  const typedItems = typeFilter
    ? filteredItems.filter((item) => typeFilter.has(coerceEntryType(item)))
    : filteredItems;
  const filteredItemIds = new Set(typedItems.map((item) => item.id));
  const filteredDependencies = dependencies.filter(
    (dependency) => filteredItemIds.has(dependency.fromItemId) && filteredItemIds.has(dependency.toItemId)
  );

  return NextResponse.json({ project, items: typedItems, dependencies: filteredDependencies });
}
