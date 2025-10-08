import { NextResponse } from "next/server";
import { requireAdminUser } from "../../../../lib/adminAuth";

function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,%]/g, " ").replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  const adminResult = await requireAdminUser(request);

  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const { supabase } = adminResult;
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q");
  const statusFilter = searchParams.get("status");

  let query = supabase
    .from("projects")
    .select(
      "id, slug, name, status, description, start_date, end_date, color, created_by, created_at, updated_at, priority_profile, project_members(user_id, role)"
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  if (rawQuery) {
    const sanitized = sanitizeSearchTerm(rawQuery);

    if (sanitized.length > 0) {
      const pattern = `%${sanitized.replace(/[%_]/g, "\\$&")}%`;
      query = query.or(
        [
          `name.ilike.${pattern}`,
          `description.ilike.${pattern}`,
          `slug.ilike.${pattern}`,
        ].join(",")
      );
    }
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const projects = (data ?? []).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    status: row.status as string,
    description: row.description as string | null,
    startDate: row.start_date as string | null,
    endDate: row.end_date as string | null,
    color: row.color as string | null,
    createdBy: row.created_by as string | null,
    createdAt: row.created_at as string | null,
    updatedAt: row.updated_at as string | null,
    priorityProfile: row.priority_profile ?? null,
    members: Array.isArray(row.project_members)
      ? (row.project_members as Array<{ user_id: string; role: string }>).map((member) => ({
          userId: member.user_id,
          role: member.role,
        }))
      : [],
  }));

  return NextResponse.json({ projects });
}

interface AdminCreateProjectPayload {
  name: string;
  description?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  color?: string | null;
  priorityProfile?: Record<string, unknown> | null;
  labels?: Record<string, unknown> | null;
  ownerId?: string | null;
  artistId?: string | null;
}

export async function POST(request: Request) {
  const adminResult = await requireAdminUser(request);

  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const { supabase, user } = adminResult;

  let payload: AdminCreateProjectPayload;
  try {
    payload = (await request.json()) as AdminCreateProjectPayload;
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!payload?.name || payload.name.trim().length === 0) {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }

  const ownerId =
    typeof payload.ownerId === "string" && payload.ownerId.trim().length > 0
      ? payload.ownerId.trim()
      : user.id;

  const insertPayload: Record<string, unknown> = {
    name: payload.name.trim(),
    description: payload.description ?? null,
    status: payload.status ?? "active",
    start_date: payload.startDate ?? null,
    end_date: payload.endDate ?? null,
    color: payload.color ?? null,
    labels: payload.labels ?? {},
    priority_profile: payload.priorityProfile ?? null,
    created_by: ownerId,
    artist_id: payload.artistId ?? null,
  };

  const { data: projectRow, error: insertError } = await supabase
    .from("projects")
    .insert(insertPayload)
    .select(
      "id, slug, name, status, description, start_date, end_date, color, created_by, created_at, updated_at, priority_profile"
    )
    .maybeSingle();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  if (!projectRow) {
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }

  const { error: membershipError } = await supabase
    .from("project_members")
    .upsert(
      {
        project_id: projectRow.id,
        user_id: ownerId,
        role: "owner",
      },
      { onConflict: "project_id,user_id" }
    );

  if (membershipError) {
    console.error("Failed to assign owner to project", membershipError);
  }

  return NextResponse.json({
    project: {
      id: projectRow.id as string,
      slug: projectRow.slug as string,
      name: projectRow.name as string,
      status: projectRow.status as string,
      description: projectRow.description as string | null,
      startDate: projectRow.start_date as string | null,
      endDate: projectRow.end_date as string | null,
      color: projectRow.color as string | null,
      createdBy: projectRow.created_by as string | null,
      createdAt: projectRow.created_at as string | null,
      updatedAt: projectRow.updated_at as string | null,
      priorityProfile: projectRow.priority_profile ?? null,
    },
  });
}
