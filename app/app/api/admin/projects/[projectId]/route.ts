import { NextResponse } from "next/server";
import { requireAdminUser } from "../../../../../lib/adminAuth";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface AdminUpdateProjectPayload {
  name?: string | null;
  description?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  color?: string | null;
  priorityProfile?: Record<string, unknown> | null;
  labels?: Record<string, unknown> | null;
  ownerId?: string | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: { projectId: string } }
) {
  const adminResult = await requireAdminUser(request);

  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const { supabase } = adminResult;
  const projectId = params.projectId;

  if (!projectId) {
    return NextResponse.json({ error: "Missing project id" }, { status: 400 });
  }

  let payload: AdminUpdateProjectPayload;
  try {
    payload = (await request.json()) as AdminUpdateProjectPayload;
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const name = normalizeString(payload.name);
  const description = normalizeString(payload.description);
  const status = normalizeString(payload.status);
  const startDate = normalizeString(payload.startDate);
  const endDate = normalizeString(payload.endDate);
  const color = normalizeString(payload.color);

  if (name !== null) updatePayload.name = name;
  if (description !== null) updatePayload.description = description;
  if (status !== null) updatePayload.status = status;
  if (startDate !== null) updatePayload.start_date = startDate;
  if (endDate !== null) updatePayload.end_date = endDate;
  if (color !== null) updatePayload.color = color;

  if (payload.name === "" || payload.name === null) updatePayload.name = null;
  if (payload.description === "" || payload.description === null) updatePayload.description = null;
  if (payload.status === "" || payload.status === null) updatePayload.status = null;
  if (payload.startDate === "" || payload.startDate === null) updatePayload.start_date = null;
  if (payload.endDate === "" || payload.endDate === null) updatePayload.end_date = null;
  if (payload.color === "" || payload.color === null) updatePayload.color = null;

  if (payload.priorityProfile !== undefined) {
    updatePayload.priority_profile = payload.priorityProfile;
  }

  if (payload.labels !== undefined) {
    updatePayload.labels = payload.labels ?? {};
  }

  if (Object.keys(updatePayload).length === 1) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("projects")
    .update(updatePayload)
    .eq("id", projectId)
    .select(
      "id, slug, name, status, description, start_date, end_date, color, created_by, created_at, updated_at, priority_profile"
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (payload.ownerId !== undefined) {
    const ownerId = normalizeString(payload.ownerId);
    if (ownerId) {
      const { error: membershipError } = await supabase
        .from("project_members")
        .upsert(
          {
            project_id: projectId,
            user_id: ownerId,
            role: "owner",
          },
          { onConflict: "project_id,user_id" }
        );

      if (membershipError) {
        console.error("Failed to update project owner", membershipError);
      }
    }
  }

  return NextResponse.json({
    project: {
      id: data.id as string,
      slug: data.slug as string,
      name: data.name as string,
      status: data.status as string,
      description: data.description as string | null,
      startDate: data.start_date as string | null,
      endDate: data.end_date as string | null,
      color: data.color as string | null,
      createdBy: data.created_by as string | null,
      createdAt: data.created_at as string | null,
      updatedAt: data.updated_at as string | null,
      priorityProfile: data.priority_profile ?? null,
    },
  });
}
