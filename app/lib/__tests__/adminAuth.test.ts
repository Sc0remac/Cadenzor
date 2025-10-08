import { describe, it, expect, beforeEach, vi } from "vitest";
import { requireAdminUser } from "../adminAuth";
import { requireAuthenticatedUser } from "../serverAuth";

vi.mock("../serverAuth", () => ({
  requireAuthenticatedUser: vi.fn(),
}));

function createSupabaseStub(result: { data?: any; error?: any }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return {
    from: vi.fn(() => ({ select })),
    __select: select,
    __eq: eq,
    __maybeSingle: maybeSingle,
  };
}

describe("requireAdminUser", () => {
  beforeEach(() => {
    vi.mocked(requireAuthenticatedUser).mockReset();
  });

  it("propagates auth failures", async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      ok: false,
      status: 401,
      error: "missing",
    });

    const result = await requireAdminUser(new Request("https://example.com"));
    expect(result).toEqual({ ok: false, status: 401, error: "missing" });
  });

  it("returns 500 when profile lookup fails", async () => {
    const supabase = createSupabaseStub({ error: { message: "boom" } });
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      ok: true,
      supabase: supabase as any,
      user: { id: "user-1", email: "user@example.com" } as any,
    });

    const result = await requireAdminUser(new Request("https://example.com"));

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: "boom",
    });
  });

  it("returns 403 when user is not admin", async () => {
    const supabase = createSupabaseStub({ data: { is_admin: false } });
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      ok: true,
      supabase: supabase as any,
      user: { id: "user-1", email: "user@example.com" } as any,
    });

    const result = await requireAdminUser(new Request("https://example.com"));

    expect(result).toEqual({
      ok: false,
      status: 403,
      error: "Administrator access required",
    });
  });

  it("returns admin profile when permitted", async () => {
    const supabase = createSupabaseStub({ data: { is_admin: true, email: null, full_name: "Admin" } });
    const user = {
      id: "user-1",
      email: "user@example.com",
      user_metadata: { full_name: "Meta Name" },
    } as any;

    vi.mocked(requireAuthenticatedUser).mockResolvedValue({
      ok: true,
      supabase: supabase as any,
      user,
    });

    const result = await requireAdminUser(new Request("https://example.com"));

    expect(result).toEqual({
      ok: true,
      supabase: supabase as any,
      user,
      profile: {
        id: "user-1",
        email: "user@example.com",
        fullName: "Admin",
        isAdmin: true,
      },
    });
  });
});
