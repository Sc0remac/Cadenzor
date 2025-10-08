import { NextResponse } from "next/server";
import { requireAdminUser } from "../../../../../lib/adminAuth";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: { userId: string } }
) {
  const adminResult = await requireAdminUser(request);

  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const { supabase } = adminResult;
  const userId = params.userId;

  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  let payload: Record<string, unknown>;

  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch (err) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const emailInput = payload.email;
  const fullNameInput = payload.fullName;
  const roleInput = payload.role;
  const companyInput = payload.company;
  const phoneInput = payload.phone;
  const locationInput = payload.location;
  const bioInput = payload.bio;

  const email = normalizeString(emailInput);
  const fullName = normalizeString(fullNameInput);
  const role = normalizeString(roleInput);
  const company = normalizeString(companyInput);
  const phone = normalizeString(phoneInput);
  const location = normalizeString(locationInput);
  const bio = normalizeString(bioInput);

  if (email !== null) updatePayload.email = email;
  if (fullName !== null) updatePayload.full_name = fullName;
  if (role !== null) updatePayload.role = role;
  if (company !== null) updatePayload.company = company;
  if (phone !== null) updatePayload.phone = phone;
  if (location !== null) updatePayload.location = location;
  if (bio !== null) updatePayload.bio = bio;

  if (emailInput === "" || emailInput === null) {
    updatePayload.email = null;
  }

  if (fullNameInput === "" || fullNameInput === null) {
    updatePayload.full_name = null;
  }

  if (roleInput === "" || roleInput === null) updatePayload.role = null;
  if (companyInput === "" || companyInput === null) updatePayload.company = null;
  if (phoneInput === "" || phoneInput === null) updatePayload.phone = null;
  if (locationInput === "" || locationInput === null) updatePayload.location = null;
  if (bioInput === "" || bioInput === null) updatePayload.bio = null;

  if (typeof payload.isAdmin === "boolean") {
    updatePayload.is_admin = payload.isAdmin;
  }

  if (Object.keys(updatePayload).length === 1) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", userId)
    .select("id, email, full_name, role, company, phone, location, bio, is_admin, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: data.id as string,
      email: data.email as string | null,
      fullName: data.full_name as string | null,
      role: data.role as string | null,
      company: data.company as string | null,
      phone: data.phone as string | null,
      location: data.location as string | null,
      bio: data.bio as string | null,
      isAdmin: Boolean(data.is_admin),
      updatedAt: data.updated_at as string | null,
    },
  });
}
