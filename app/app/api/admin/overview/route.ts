import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAdminUser } from "../../../../lib/adminAuth";

type FilterFn = (query: any) => any;

async function countRows(
  supabase: SupabaseClient,
  table: string,
  applyFilter?: FilterFn
): Promise<number> {
  let query = supabase.from(table).select("id", { head: true, count: "exact" });

  if (applyFilter) {
    query = applyFilter(query);
  }

  const { count, error } = await query;

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
      countRows(supabase, "profiles"),
      countRows(supabase, "profiles", (query) => query.eq("is_admin", true)),
      countRows(supabase, "projects"),
      countRows(supabase, "projects", (query) => query.eq("status", "active")),
      countRows(supabase, "emails"),
      countRows(supabase, "emails", (query) => query.eq("is_read", false)),
      countRows(supabase, "emails", (query) => query.like("id", "seed-%")),
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
