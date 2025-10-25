import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/serverAuth";
import { findAvailableSlots, type FindSlotsOptions, type TimeSlot } from "@kazador/shared";

interface SuggestSlotsRequest {
  projectId?: string;
  dateRange: [string, string]; // [start, end] ISO 8601
  durationHours: number;
  city?: string;
  territory?: string;
  constraints?: ("not_overlapping_travel" | "avoid_timezone_jumps" | "prefer_business_hours")[];
  maxResults?: number;
}

function formatError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return formatError(authResult.error, authResult.status);
  }

  const { supabase } = authResult;

  let payload: SuggestSlotsRequest;
  try {
    payload = (await request.json()) as SuggestSlotsRequest;
  } catch {
    return formatError("Invalid JSON payload", 400);
  }

  const {
    projectId,
    dateRange,
    durationHours,
    city,
    territory,
    constraints = [],
    maxResults = 5,
  } = payload;

  // Validate inputs
  if (!dateRange || dateRange.length !== 2) {
    return formatError("dateRange must be an array of [start, end] ISO 8601 strings", 400);
  }

  if (!durationHours || durationHours <= 0) {
    return formatError("durationHours must be a positive number", 400);
  }

  const rangeStart = Date.parse(dateRange[0]);
  const rangeEnd = Date.parse(dateRange[1]);

  if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd)) {
    return formatError("Invalid dateRange: must be valid ISO 8601 dates", 400);
  }

  if (rangeStart >= rangeEnd) {
    return formatError("Invalid dateRange: start must be before end", 400);
  }

  // Fetch timeline items for the specified date range
  let query = supabase
    .from("timeline_entries")
    .select("*")
    .gte("start_at", dateRange[0])
    .lte("start_at", dateRange[1]);

  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data: rows, error: fetchError } = await query;

  if (fetchError) {
    return formatError(fetchError.message, 500);
  }

  // Map database rows to TimelineItemRecord
  const items = (rows ?? []).map((row: any) => ({
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    lane: row.lane || "PROMO",
    kind: row.kind,
    title: row.title,
    description: row.description,
    startsAt: row.start_at,
    endsAt: row.end_at,
    dueAt: row.due_at,
    timezone: row.tz,
    status: row.status || "planned",
    priorityScore: row.priority_score,
    priorityComponents: row.priority_components,
    labels: row.labels ?? {},
    links: row.links ?? {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    territory: row.territory,
  }));

  // Find available slots
  const options: FindSlotsOptions = {
    dateRange,
    durationHours,
    city,
    territory,
    constraints,
    maxResults,
  };

  const slots = findAvailableSlots(items, options);

  return NextResponse.json({
    slots,
    meta: {
      scannedItems: items.length,
      requestedDuration: durationHours,
      city,
      territory,
      constraints,
    },
  });
}
