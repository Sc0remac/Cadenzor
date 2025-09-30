import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import { mapProjectRow } from "../../../lib/projectMappers";
import type { ProjectRecord } from "@cadenzor/shared";

interface CreateProjectPayload {
  name: string;
  description?: string | null;
  status?: ProjectRecord["status"];
  startDate?: string | null;
  endDate?: string | null;
  color?: string | null;
  labels?: Record<string, unknown>;
  artistId?: string | null;
  templateSlug?: string | null;
  priorityProfile?: Record<string, unknown> | null;
}

type SupabaseClientType = Awaited<ReturnType<typeof requireAuthenticatedUser>> extends {
  supabase: infer C;
}
  ? C
  : never;

async function seedProjectFromTemplate(
  supabase: SupabaseClientType,
  project: ProjectRecord,
  templateSlug: string
) {
  const { data: templateRow, error: templateError } = await supabase
    .from("project_templates")
    .select("id, name, slug, payload")
    .eq("slug", templateSlug)
    .maybeSingle();

  if (templateError) {
    throw templateError;
  }

  if (!templateRow) {
    throw new Error(`Unknown project template: ${templateSlug}`);
  }

  const { data: items, error: itemsError } = await supabase
    .from("project_template_items")
    .select("id, item_type, title, lane, offset_days, duration_days, metadata")
    .eq("template_id", templateRow.id);

  if (itemsError) {
    throw itemsError;
  }

  if (!items || items.length === 0) {
    return;
  }

  if (!project.startDate) {
    return;
  }

  const projectStart = new Date(project.startDate);

  const timelinePayload = items.map((item) => {
    const offsetDays = Number(item.offset_days ?? 0);
    const durationDays = Number(item.duration_days ?? 0);
    const startsAt = new Date(projectStart);
    startsAt.setUTCDate(projectStart.getUTCDate() + offsetDays);

    const endsAt = new Date(startsAt);
    if (durationDays > 0) {
      endsAt.setUTCDate(startsAt.getUTCDate() + durationDays);
    }

    return {
      project_id: project.id,
      type: item.item_type,
      title: item.title,
      lane: item.lane,
      starts_at: startsAt.toISOString(),
      ends_at: durationDays > 0 ? endsAt.toISOString() : null,
      metadata: item.metadata ?? {},
      priority: 0,
    };
  });

  await supabase.from("timeline_items").insert(timelinePayload);
}

export async function GET(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");
  const queryFilter = searchParams.get("q");

  const { data: membershipRows, error: membershipError } = await supabase
    .from("project_members")
    .select("project_id, role")
    .eq("user_id", user.id);

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (!membershipRows || membershipRows.length === 0) {
    return NextResponse.json({ projects: [] });
  }

  const projectIds = membershipRows.map((row) => row.project_id as string);
  const roleByProject = new Map<string, string>(
    membershipRows.map((row) => [row.project_id as string, row.role as string])
  );

  let query = supabase.from("projects").select("*").in("id", projectIds);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  if (queryFilter) {
    query = query.ilike("name", `%${queryFilter}%`);
  }

  const { data: projectRows, error: projectError } = await query;

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }

  const projects = (projectRows ?? []).map((row) => ({
    project: mapProjectRow(row),
    role: roleByProject.get(row.id as string),
  }));

  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;

  let payload: CreateProjectPayload;
  try {
    payload = (await request.json()) as CreateProjectPayload;
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!payload?.name || payload.name.trim().length === 0) {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }

  const insertPayload: Record<string, unknown> = {
    name: payload.name.trim(),
    description: payload.description ?? null,
    status: payload.status ?? "active",
    start_date: payload.startDate ?? null,
    end_date: payload.endDate ?? null,
    color: payload.color ?? null,
    labels: payload.labels ?? {},
    priority_profile: payload.priorityProfile ?? null,
    created_by: user.id,
    artist_id: payload.artistId ?? null,
  };

  const { data: projectRow, error: insertError } = await supabase
    .from("projects")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  if (!projectRow) {
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }

  const project = mapProjectRow(projectRow);

  if (payload.templateSlug) {
    try {
      await seedProjectFromTemplate(supabase, project, payload.templateSlug);
    } catch (err: any) {
      console.error("Failed to apply template", err);
    }
  }

  return NextResponse.json({ project });
}
