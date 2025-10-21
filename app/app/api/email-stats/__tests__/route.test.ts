import { describe, expect, it, vi, beforeEach, beforeAll, afterEach } from "vitest";
import {
  normaliseLabels,
  normaliseLabel,
  ensureDefaultLabelCoverage,
} from "@kazador/shared";

let GET: typeof import("../route").GET;
let serverAuthModule: typeof import("../../../../lib/serverAuth");
let requireAuthenticatedUserSpy: ReturnType<typeof vi.spyOn>;

type QueryResult = {
  data: Array<{ category: unknown; labels: unknown }> | null;
  error: { message: string } | null;
};

function createSupabaseStub(result: QueryResult) {
  const selectMock = vi.fn();
  const eqMock = vi.fn();
  const likeMock = vi.fn();

  const builder: any = {
    eq: eqMock,
    like: likeMock,
    then: (onFulfilled: any, onRejected?: any) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };

  eqMock.mockImplementation(() => builder);
  likeMock.mockImplementation(() => builder);

  selectMock.mockReturnValue(builder);

  const fromMock = vi.fn(() => ({ select: selectMock }));

  return { supabase: { from: fromMock }, selectMock, eqMock, likeMock };
}

function buildExpectedCounts(rows: Array<{ category: unknown; labels: unknown }>) {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    const parsedLabels = normaliseLabels(row.labels);
    const fallbackCategory = normaliseLabel(row.category);
    const baseLabels = parsedLabels.length > 0
      ? parsedLabels
      : fallbackCategory
      ? [fallbackCategory]
      : [];
    const enriched = ensureDefaultLabelCoverage(baseLabels);
    const unique = new Set(enriched.filter(Boolean));
    unique.forEach((label) => {
      counts[label] = (counts[label] ?? 0) + 1;
    });
  }

  return counts;
}

describe("GET /api/email-stats", () => {
  beforeAll(async () => {
    ({ GET } = await import("../route"));
    serverAuthModule = await import("../../../../lib/serverAuth");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedUserSpy = vi.spyOn(serverAuthModule, "requireAuthenticatedUser") as any;
  });

  afterEach(() => {
    requireAuthenticatedUserSpy.mockRestore();
  });

  it("returns auth error responses", async () => {
    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: false,
      status: 401,
      error: "No session",
    } as any);

    const response = await GET(new Request("https://kazador.test/api/email-stats"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "No session" });
    expect(requireAuthenticatedUserSpy).toHaveBeenCalled();
  });

  it("aggregates label counts for unread emails", async () => {
    const rows = [
      { category: "Campaigns/Launch", labels: ["PRIORITY/Urgent", "city/Tokyo"] },
      { category: "status/pending_info", labels: [] },
      { category: null, labels: "[\"risk/payment_delay\", \"city/London\"]" },
    ];

    const stub = createSupabaseStub({ data: rows, error: null });

    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: true,
      supabase: stub.supabase,
      user: { id: "user-123" },
    } as any);

    const response = await GET(new Request("https://kazador.test/api/email-stats"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual(buildExpectedCounts(rows));

    expect(stub.supabase.from).toHaveBeenCalledWith("emails");
    expect(stub.selectMock).toHaveBeenCalledWith("category, labels, source");
    expect(stub.eqMock).toHaveBeenNthCalledWith(1, "user_id", "user-123");
    expect(stub.eqMock).toHaveBeenNthCalledWith(2, "is_read", false);
    expect(stub.likeMock).not.toHaveBeenCalled();
  });

  it("applies source filters and surfaces supabase errors", async () => {
    const stub = createSupabaseStub({ data: null, error: { message: "fail" } });

    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: true,
      supabase: stub.supabase,
      user: { id: "user-123" },
    } as any);

    const response = await GET(
      new Request("https://kazador.test/api/email-stats?scope=all&source=seeded")
    );

    expect(stub.eqMock).toHaveBeenNthCalledWith(1, "user_id", "user-123");
    expect(stub.eqMock).toHaveBeenNthCalledWith(2, "source", "seeded");
    expect(stub.likeMock).not.toHaveBeenCalled();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "fail" });
  });
});
