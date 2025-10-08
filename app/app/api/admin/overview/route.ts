import { NextResponse } from "next/server";
import { requireAdminUser } from "../../../../lib/adminAuth";

async function count(query: any): Promise<number> {
  const { count, error } = await query.select("id", { head: true, count: "exact" });

  if (error) {
    throw error;
  }

  return typeof count === "number" ? count : 0;
}

export async function GET(request: Request) {
  const adminResult = await requireAdminUser(request);

  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const { supabase } = adminResult;

  try {
    const [
      totalUsers,
      adminUsers,
      totalProjects,
      activeProjects,
      totalEmails,
      unreadEmails,
      seededEmails,
    ] = await Promise.all([
      count(supabase.from("profiles")),
      count(supabase.from("profiles").eq("is_admin", true)),
      count(supabase.from("projects")),
      count(supabase.from("projects").eq("status", "active")),
      count(supabase.from("emails")),
      count(supabase.from("emails").eq("is_read", false)),
      count(supabase.from("emails").like("id", "seed-%")),
    ]);

    const { data: recentProjects, error: recentProjectsError } = await supabase
      .from("projects")
      .select("id, name, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(5);

    if (recentProjectsError) {
      throw recentProjectsError;
    }

    return NextResponse.json({
      overview: {
        totalUsers,
        adminUsers,
        totalProjects,
        activeProjects,
        totalEmails,
        unreadEmails,
        seededEmails,
        recentProjects: (recentProjects ?? []).map((project) => ({
          id: project.id as string,
          name: project.name as string,
          status: project.status as string,
          updatedAt: project.updated_at as string | null,
        })),
      },
    });
  } catch (err: any) {
    console.error("Failed to load admin overview", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load admin overview" },
      { status: 500 }
    );
  }
}
