import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import {
  mapProjectRow,
  mapTimelineDependencyRow,
  mapTimelineItemRow,
} from "../../../lib/projectMappers";
import type { ProjectRecord } from "@cadenzor/shared";

function parseProjectFilter(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
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

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");
  const projectFilter = parseProjectFilter(searchParams.get("projects"));
  const rangeStart = normaliseIsoTimestamp(searchParams.get("rangeStart"));
  const rangeEnd = normaliseIsoTimestamp(searchParams.get("rangeEnd"));

  const { data: membershipRows, error: membershipError } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("user_id", user.id);

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (!membershipRows || membershipRows.length === 0) {
    return NextResponse.json({ projects: [], items: [], dependencies: [] });
  }

  let allowedProjectIds = membershipRows.map((row) => row.project_id as string);

  if (projectFilter.length > 0) {
    const requested = new Set(projectFilter);
    allowedProjectIds = allowedProjectIds.filter((id) => requested.has(id));
  }

  if (allowedProjectIds.length === 0) {
    return NextResponse.json({ projects: [], items: [], dependencies: [] });
  }

  let projectQuery = supabase.from("projects").select("*").in("id", allowedProjectIds);

  if (statusFilter && statusFilter !== "all") {
    projectQuery = projectQuery.eq("status", statusFilter);
  }

  const { data: projectRows, error: projectError } = await projectQuery;

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }

  if (!projectRows || projectRows.length === 0) {
    return NextResponse.json({ projects: [], items: [], dependencies: [] });
  }

  const projects: ProjectRecord[] = projectRows.map(mapProjectRow);
  const projectIds = projects.map((project) => project.id);

  const { data: timelineRows, error: timelineError } = await supabase
    .from("timeline_items")
    .select("*")
    .in("project_id", projectIds)
    .order("starts_at", { ascending: true });

  if (timelineError) {
    return NextResponse.json({ error: timelineError.message }, { status: 500 });
  }

  const { data: dependencyRows, error: dependencyError } = await supabase
    .from("timeline_dependencies")
    .select("*")
    .in("project_id", projectIds);

  if (dependencyError) {
    return NextResponse.json({ error: dependencyError.message }, { status: 500 });
  }

  const items = (timelineRows ?? []).map(mapTimelineItemRow);
  const dependencies = (dependencyRows ?? []).map(mapTimelineDependencyRow);

  const startMs = rangeStart ? Date.parse(rangeStart) : null;
  const endMs = rangeEnd ? Date.parse(rangeEnd) : null;

  const filteredItems = items.filter((item) => itemMatchesRange(item, startMs, endMs));
  const filteredItemIds = new Set(filteredItems.map((item) => item.id));
  const filteredDependencies = dependencies.filter(
    (dependency) => filteredItemIds.has(dependency.fromItemId) && filteredItemIds.has(dependency.toItemId)
  );

  return NextResponse.json({ projects, items: filteredItems, dependencies: filteredDependencies });
}
