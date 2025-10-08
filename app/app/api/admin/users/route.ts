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

  let query = supabase
    .from("profiles")
    .select("id, email, full_name, role, company, phone, location, bio, is_admin, updated_at, created_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (rawQuery) {
    const sanitized = sanitizeSearchTerm(rawQuery);

    if (sanitized.length > 0) {
      const pattern = `%${sanitized.replace(/[%_]/g, "\\$&")}%`;
      query = query.or(
        [
          `email.ilike.${pattern}`,
          `full_name.ilike.${pattern}`,
          `role.ilike.${pattern}`,
          `company.ilike.${pattern}`,
        ].join(",")
      );
    }
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users = (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string | null,
    fullName: row.full_name as string | null,
    role: row.role as string | null,
    company: row.company as string | null,
    phone: row.phone as string | null,
    location: row.location as string | null,
    bio: row.bio as string | null,
    isAdmin: Boolean(row.is_admin),
    updatedAt: row.updated_at as string | null,
    createdAt: row.created_at as string | null,
  }));

  return NextResponse.json({ users });
}
