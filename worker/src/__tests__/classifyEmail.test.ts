import { describe, expect, it, vi } from "vitest";
import { EMAIL_FALLBACK_LABEL, ensureDefaultLabelCoverage, normaliseLabels, selectPrimaryCategory } from "@kazador/shared";
import { classifyEmail } from "../classifyEmail";

describe("classifyEmail", () => {
  const deps = {
    normaliseLabels,
    ensureDefaultLabelCoverage,
    selectPrimaryCategory,
  } as const;

  it("reuses cached summary and labels when present", async () => {
    const analyze = vi.fn();
    const heuristics = vi.fn();

    const result = await classifyEmail(
      {
        subject: "Offer",
        body: "Details",
        fromName: "Sender",
        fromEmail: "sender@example.com",
        cachedSummary: "Cached summary",
        cachedLabels: ["FINANCE/Invoice"],
      },
      {
        analyzeEmail: analyze,
        heuristicLabels: heuristics,
        normaliseLabels: deps.normaliseLabels,
        ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
        selectPrimaryCategory: deps.selectPrimaryCategory,
      }
    );

    expect(analyze).not.toHaveBeenCalled();
    expect(heuristics).not.toHaveBeenCalled();
    expect(result.summary).toBe("Cached summary");
    expect(result.labels).toEqual(["FINANCE/Invoice"]);
    expect(result.usedCachedSummary).toBe(true);
    expect(result.usedCachedLabels).toBe(true);
    expect(result.usedAi).toBe(false);
    expect(result.usedHeuristics).toBe(false);
  });

  it("falls back to heuristics when AI throws", async () => {
    const heuristics = vi.fn().mockReturnValue(["BOOKING/Offer"]);

    const result = await classifyEmail(
      {
        subject: "Offer",
        body: "Great offer details",
        fromName: "Sender",
        fromEmail: "sender@example.com",
      },
      {
        analyzeEmail: vi.fn().mockRejectedValue(new Error("boom")),
        heuristicLabels: heuristics,
        normaliseLabels: deps.normaliseLabels,
        ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
        selectPrimaryCategory: deps.selectPrimaryCategory,
        onError: vi.fn(),
      }
    );

    expect(heuristics).toHaveBeenCalledOnce();
    expect(result.labels).toEqual(["BOOKING/Offer"]);
    expect(result.usedHeuristics).toBe(true);
    expect(result.category).toBe("BOOKING/Offer");
  });

  it("ensures fallback label when heuristics provide nothing", async () => {
    const result = await classifyEmail(
      {
        subject: "FYI",
        body: "General update",
        fromName: null,
        fromEmail: "sender@example.com",
        cachedSummary: "",
        cachedLabels: [],
      },
      {
        analyzeEmail: vi.fn().mockResolvedValue({ summary: "", labels: [] }),
        heuristicLabels: vi.fn().mockReturnValue([]),
        normaliseLabels: deps.normaliseLabels,
        ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
        selectPrimaryCategory: deps.selectPrimaryCategory,
      }
    );

    expect(result.labels).toEqual([EMAIL_FALLBACK_LABEL]);
    expect(result.category).toBe(EMAIL_FALLBACK_LABEL);
    expect(result.usedHeuristics).toBe(true);
  });
});
