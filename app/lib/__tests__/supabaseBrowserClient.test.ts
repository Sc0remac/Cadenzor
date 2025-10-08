import { describe, it, expect, beforeEach, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ id: "browser" })),
}));

describe("getBrowserSupabaseClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.mocked(createClient).mockClear();
    vi.resetModules();
  });

  it("throws when url is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

    const module = await import("../supabaseBrowserClient");
    expect(() => module.getBrowserSupabaseClient()).toThrow(
      "NEXT_PUBLIC_SUPABASE_URL is not defined"
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("throws when anon key missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example";

    const module = await import("../supabaseBrowserClient");
    expect(() => module.getBrowserSupabaseClient()).toThrow(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined"
    );
  });

  it("creates and caches client", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

    const module = await import("../supabaseBrowserClient");
    const first = module.getBrowserSupabaseClient();
    const second = module.getBrowserSupabaseClient();

    expect(first).toBe(second);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
