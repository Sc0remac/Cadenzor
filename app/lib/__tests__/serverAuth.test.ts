import { describe, it, expect, beforeEach, vi } from "vitest";
import { requireAuthenticatedUser } from "../serverAuth";
import { createServerSupabaseClient } from "../serverSupabase";

const getUserMock = vi.fn();

vi.mock("../serverSupabase", () => ({
  createServerSupabaseClient: vi.fn(),
}));

function buildRequest(headers: Record<string, string> = {}) {
  const store = new Map<string, string>();
  Object.entries(headers).forEach(([key, value]) => {
    store.set(key, value);
    store.set(key.toLowerCase(), value);
  });
  return {
    headers: {
      get: (key: string) => store.get(key) ?? null,
    },
  } as unknown as Request;
}

describe("requireAuthenticatedUser", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    vi.mocked(createServerSupabaseClient).mockReset();
  });

  it("rejects when authorization header missing", async () => {
    const result = await requireAuthenticatedUser(buildRequest());

    expect(result).toEqual({ ok: false, status: 401, error: "Missing bearer token" });
  });

  it("rejects when token is empty", async () => {
    const result = await requireAuthenticatedUser(
      buildRequest({ Authorization: "Bearer   " })
    );

    expect(result).toEqual({ ok: false, status: 401, error: "Missing access token" });
  });

  it("returns server error when client creation fails", async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue({ ok: false, error: "boom" });

    const result = await requireAuthenticatedUser(
      buildRequest({ Authorization: "Bearer token" })
    );

    expect(result).toEqual({ ok: false, status: 500, error: "boom" });
    expect(createServerSupabaseClient).toHaveBeenCalledWith("token");
  });

  it("rejects when Supabase reports auth error", async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      ok: true,
      supabase: { auth: { getUser: getUserMock } } as any,
    } as any);
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: "expired" } } as any);

    const result = await requireAuthenticatedUser(
      buildRequest({ Authorization: "Bearer token" })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe("expired");
    }
    expect(createServerSupabaseClient).toHaveBeenCalledWith("token");
  });

  it("returns the user when validation succeeds", async () => {
    const supabase = { auth: { getUser: getUserMock } } as any;
    vi.mocked(createServerSupabaseClient).mockReturnValue({ ok: true, supabase } as any);
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null } as any);

    const result = await requireAuthenticatedUser(
      buildRequest({ Authorization: "Bearer token" })
    );

    expect(result).toEqual({ ok: true, supabase, user: { id: "user-1" } });
    expect(getUserMock).toHaveBeenCalledWith("token");
    expect(createServerSupabaseClient).toHaveBeenCalledWith("token");
  });

  it("decodes fallback user when auth request fails", async () => {
    const supabase = { auth: { getUser: getUserMock } } as any;
    vi.mocked(createServerSupabaseClient).mockReturnValue({ ok: true, supabase } as any);
    getUserMock.mockRejectedValue(new Error("fetch failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "user-42", email: "user@example.com", aud: "authenticated", iat: 0, exp: 1 })
    ).toString("base64url");
    const token = `${header}.${payload}.signature`;

    const result = await requireAuthenticatedUser(
      buildRequest({ Authorization: `Bearer ${token}` })
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe("user-42");
      expect(result.user.email).toBe("user@example.com");
    }
    expect(createServerSupabaseClient).toHaveBeenCalledWith(token);
    warnSpy.mockRestore();
  });
});
