import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectMemberRole } from "@kazador/shared";

export type ProjectRoleRequirement = "viewer" | "editor" | "owner";

const ROLE_WEIGHT: Record<ProjectMemberRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

const REQUIRED_WEIGHT: Record<ProjectRoleRequirement, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export interface ProjectMembership {
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
}

export async function getProjectMembership(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<ProjectMembership | null> {
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id, user_id, role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    projectId: data.project_id as string,
    userId: data.user_id as string,
    role: data.role as ProjectMemberRole,
  };
}

export async function assertProjectRole(
  supabase: SupabaseClient,
  projectId: string,
  userId: string,
  required: ProjectRoleRequirement = "viewer"
): Promise<{ membership: ProjectMembership }> {
  const membership = await getProjectMembership(supabase, projectId, userId);

  if (!membership) {
    const error = new Error("Not a member of this project");
    (error as any).status = 403;
    throw error;
  }

  const actualWeight = ROLE_WEIGHT[membership.role];
  const requiredWeight = REQUIRED_WEIGHT[required];

  if (actualWeight < requiredWeight) {
    const error = new Error("Insufficient permissions for this project");
    (error as any).status = 403;
    throw error;
  }

  return { membership };
}
