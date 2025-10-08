import { describe, it, expect, vi } from "vitest";
import { getProjectMembership, assertProjectRole } from "../projectAccess";

function createSupabase(result: { data?: any; error?: any }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const query: any = {
    maybeSingle,
    eq: vi.fn(() => query),
  };
  const select = vi.fn(() => query);
  return {
    from: vi.fn(() => ({ select })),
    __query: query,
  };
}

describe("projectAccess", () => {
  it("returns membership when found", async () => {
    const supabase = createSupabase({
      data: { project_id: "proj", user_id: "user", role: "editor" },
    });

    const membership = await getProjectMembership(supabase as any, "proj", "user");
    expect(membership).toEqual({ projectId: "proj", userId: "user", role: "editor" });
  });

  it("returns null when membership missing", async () => {
    const supabase = createSupabase({ data: null });
    const membership = await getProjectMembership(supabase as any, "proj", "user");
    expect(membership).toBeNull();
  });

  it("throws when select fails", async () => {
    const supabase = createSupabase({ error: new Error("boom") });
    await expect(getProjectMembership(supabase as any, "proj", "user")).rejects.toThrow("boom");
  });

  it("assertProjectRole requires membership", async () => {
    const supabase = createSupabase({ data: null });
    await expect(assertProjectRole(supabase as any, "proj", "user", "viewer")).rejects.toMatchObject({
      message: "Not a member of this project",
      status: 403,
    });
  });

  it("assertProjectRole enforces role weight", async () => {
    const supabase = createSupabase({
      data: { project_id: "proj", user_id: "user", role: "viewer" },
    });

    await expect(assertProjectRole(supabase as any, "proj", "user", "editor")).rejects.toMatchObject({
      message: "Insufficient permissions for this project",
      status: 403,
    });
  });

  it("assertProjectRole returns membership when authorized", async () => {
    const supabase = createSupabase({
      data: { project_id: "proj", user_id: "user", role: "owner" },
    });

    const result = await assertProjectRole(supabase as any, "proj", "user", "editor");
    expect(result).toEqual({
      membership: { projectId: "proj", userId: "user", role: "owner" },
    });
  });
});
