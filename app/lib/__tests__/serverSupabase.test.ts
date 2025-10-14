import { describe, it, expect, beforeEach, vi } from "vitest";
import { createServerSupabaseClient } from "../serverSupabase";
import { createClient } from "@supabase/supabase-js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ id: "supabase-client" })),
}));

describe("createServerSupabaseClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.mocked(createClient).mockClear();
  });

  it("returns error when required env vars are missing", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;

    const result = createServerSupabaseClient();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("SUPABASE_URL");
      expect(result.error).toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it("creates a client when env vars are provided", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

    const result = createServerSupabaseClient();

    expect(result).toEqual({ ok: true, supabase: { id: "supabase-client" } });
    expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "service-key", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it("falls back to anon key when service key missing", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_ANON_KEY = "anon-key";

    const result = createServerSupabaseClient();

    expect(result.ok).toBe(true);
    expect(createClient).toHaveBeenCalledWith("https://example.supabase.co", "anon-key", expect.any(Object));
  });

  it("falls back to NEXT_PUBLIC variables when server env missing", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://public.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon";

    const result = createServerSupabaseClient();

    expect(result.ok).toBe(true);
    expect(createClient).toHaveBeenCalledWith(
      "https://public.supabase.co",
      "public-anon",
      expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false } })
    );
  });

  it("injects authorization header when access token provided", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

    const result = createServerSupabaseClient("token-123");

    expect(result.ok).toBe(true);
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-key",
      expect.objectContaining({
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: "Bearer token-123" } },
      })
    );
  });
});
