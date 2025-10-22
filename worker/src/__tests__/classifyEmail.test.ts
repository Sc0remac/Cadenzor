import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EMAIL_SENTIMENT,
  EMAIL_FALLBACK_LABEL,
  ensureDefaultLabelCoverage,
  normaliseLabels,
  selectPrimaryCategory,
} from "@kazador/shared";
import { classifyEmail } from "../classifyEmail";

describe("classifyEmail", () => {
  const deps = {
    normaliseLabels,
    ensureDefaultLabelCoverage,
    selectPrimaryCategory,
  } as const;

  describe("cache behavior", () => {
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
          cachedSentiment: { label: "negative", confidence: 0.6 },
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
      expect(result.sentiment).toEqual({ label: "negative", confidence: 0.6 });
      expect(result.usedCachedSummary).toBe(true);
      expect(result.usedCachedLabels).toBe(true);
      expect(result.usedAi).toBe(false);
      expect(result.usedHeuristics).toBe(false);
    });

    it("trims whitespace from cached summary", async () => {
      const result = await classifyEmail(
        {
          subject: "Test",
          body: "Body",
          fromName: "Sender",
          fromEmail: "sender@example.com",
          cachedSummary: "  Cached summary with spaces  ",
          cachedLabels: ["FINANCE/Invoice"],
          cachedSentiment: { label: "neutral", confidence: 0.9 },
        },
        {
          analyzeEmail: vi.fn(),
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.summary).toBe("Cached summary with spaces");
      expect(result.usedCachedSummary).toBe(true);
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0.9 });
    });

    it("calls AI when cached summary is empty string", async () => {
      const analyze = vi.fn().mockResolvedValue({
        summary: "AI summary",
        labels: ["LEGAL/Contract_Draft"],
        sentiment: { label: "Positive", confidence: 82 },
      });

      const result = await classifyEmail(
        {
          subject: "Contract",
          body: "Draft agreement",
          fromName: "Lawyer",
          fromEmail: "lawyer@example.com",
          cachedSummary: "",
          cachedLabels: ["LEGAL/Contract_Draft"],
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(analyze).toHaveBeenCalledOnce();
      expect(result.summary).toBe("AI summary");
      expect(result.usedCachedSummary).toBe(false);
      expect(result.usedAi).toBe(true);
      expect(result.sentiment).toEqual({ label: "positive", confidence: 0.82 });
    });

    it("calls AI when cached labels are empty", async () => {
      const analyze = vi.fn().mockResolvedValue({
        summary: "AI summary",
        labels: ["BOOKING/Offer"],
        sentiment: { label: "NEGATIVE", confidence: 0.4 },
      });

      const result = await classifyEmail(
        {
          subject: "Show offer",
          body: "Venue details",
          fromName: "Promoter",
          fromEmail: "promoter@example.com",
          cachedSummary: "Cached summary",
          cachedLabels: [],
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(analyze).toHaveBeenCalledOnce();
      expect(result.usedCachedLabels).toBe(false);
      expect(result.usedAi).toBe(true);
      expect(result.sentiment).toEqual({ label: "negative", confidence: 0.4 });
    });

    it("handles null as cached summary", async () => {
      const analyze = vi.fn().mockResolvedValue({
        summary: "AI summary",
        labels: ["PROMO/Press_Feature"],
        sentiment: { label: "neutral", confidence: 0.51 },
      });

      const result = await classifyEmail(
        {
          subject: "Interview request",
          body: "Press interview",
          fromName: "Journalist",
          fromEmail: "press@example.com",
          cachedSummary: null,
          cachedLabels: null,
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.usedCachedSummary).toBe(false);
      expect(result.usedAi).toBe(true);
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0.51 });
    });
  });

  describe("AI classification path", () => {
    it("uses AI when no cache is present", async () => {
      const analyze = vi.fn().mockResolvedValue({
        summary: "Contract for venue booking",
        labels: ["LEGAL/Contract_Draft", "venue/Fabric", "city/London"],
        sentiment: { label: "positive", confidence: 0.73 },
      });

      const result = await classifyEmail(
        {
          subject: "Contract - Fabric London",
          body: "Please review attached contract",
          fromName: "Legal Team",
          fromEmail: "legal@venue.com",
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(analyze).toHaveBeenCalledWith({
        subject: "Contract - Fabric London",
        body: "Please review attached contract",
        fromName: "Legal Team",
        fromEmail: "legal@venue.com",
      });

      expect(result.summary).toBe("Contract for venue booking");
      expect(result.labels).toContain("LEGAL/Contract_Draft");
      expect(result.category).toBe("LEGAL/Contract_Draft");
      expect(result.usedAi).toBe(true);
      expect(result.usedHeuristics).toBe(false);
      expect(result.sentiment).toEqual({ label: "positive", confidence: 0.73 });
    });

    it("trims whitespace from AI summary", async () => {
      const analyze = vi.fn().mockResolvedValue({
        summary: "  AI summary with extra spaces  ",
        labels: ["FINANCE/Invoice"],
        sentiment: { label: "neutral", confidence: 0.2 },
      });

      const result = await classifyEmail(
        {
          subject: "Invoice",
          body: "Payment due",
          fromName: "Accounting",
          fromEmail: "accounting@example.com",
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.summary).toBe("AI summary with extra spaces");
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0.2 });
    });

    it("handles AI returning empty summary", async () => {
      const analyze = vi.fn().mockResolvedValue({
        summary: "",
        labels: ["BOOKING/Offer"],
        sentiment: { label: "Positive", confidence: 0.3 },
      });

      const result = await classifyEmail(
        {
          subject: "Offer",
          body: "Show details",
          fromName: "Promoter",
          fromEmail: "promoter@example.com",
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.summary).toBe("");
      expect(result.labels).toContain("BOOKING/Offer");
      expect(result.sentiment).toEqual({ label: "positive", confidence: 0.3 });
    });

    it("handles AI returning non-string summary", async () => {
      const analyze = vi.fn().mockResolvedValue({
        summary: null,
        labels: ["ASSETS/Artwork"],
        sentiment: { label: "neutral", confidence: 50 },
      });

      const result = await classifyEmail(
        {
          subject: "Artwork files",
          body: "Attached",
          fromName: "Designer",
          fromEmail: "design@example.com",
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.summary).toBe("");
      expect(result.labels).toContain("ASSETS/Artwork");
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0.5 });
    });

    it("defaults sentiment to neutral when AI omits the field", async () => {
      const analyze = vi.fn().mockResolvedValue({
        summary: "AI summary",
        labels: ["BOOKING/Offer"],
      });

      const result = await classifyEmail(
        {
          subject: "Offer",
          body: "Show details",
          fromName: "Promoter",
          fromEmail: "promoter@example.com",
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.sentiment).toEqual(DEFAULT_EMAIL_SENTIMENT);
    });
  });

  describe("heuristic fallback", () => {
    it("falls back to heuristics when AI throws", async () => {
      const heuristics = vi.fn().mockReturnValue(["BOOKING/Offer"]);
      const onError = vi.fn();

      const result = await classifyEmail(
        {
          subject: "Offer",
          body: "Great offer details",
          fromName: "Sender",
          fromEmail: "sender@example.com",
        },
        {
          analyzeEmail: vi.fn().mockRejectedValue(new Error("OpenAI rate limit")),
          heuristicLabels: heuristics,
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
          onError,
        }
      );

      expect(heuristics).toHaveBeenCalledWith("Offer", "Great offer details");
      expect(result.labels).toEqual(["BOOKING/Offer"]);
      expect(result.usedHeuristics).toBe(true);
      expect(result.usedAi).toBe(false); // AI call failed before setting flag
      expect(result.category).toBe("BOOKING/Offer");
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(result.sentiment).toEqual(DEFAULT_EMAIL_SENTIMENT);
    });

    it("calls onError callback with Error instance", async () => {
      const onError = vi.fn();

      await classifyEmail(
        {
          subject: "Test",
          body: "Body",
          fromName: "Sender",
          fromEmail: "sender@example.com",
        },
        {
          analyzeEmail: vi.fn().mockRejectedValue(new Error("Network failure")),
          heuristicLabels: vi.fn().mockReturnValue(["MISC/Uncategorized"]),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
          onError,
        }
      );

      expect(onError).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        message: "Network failure",
      }));
    });

    it("converts non-Error rejections to Error instances", async () => {
      const onError = vi.fn();

      await classifyEmail(
        {
          subject: "Test",
          body: "Body",
          fromName: "Sender",
          fromEmail: "sender@example.com",
        },
        {
          analyzeEmail: vi.fn().mockRejectedValue("String error"),
          heuristicLabels: vi.fn().mockReturnValue(["MISC/Uncategorized"]),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
          onError,
        }
      );

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      const errorArg = onError.mock.calls[0][0];
      expect(errorArg.message).toBe("String error");
    });

    it("does not throw when onError is undefined", async () => {
      await expect(
        classifyEmail(
          {
            subject: "Test",
            body: "Body",
            fromName: "Sender",
            fromEmail: "sender@example.com",
          },
          {
            analyzeEmail: vi.fn().mockRejectedValue(new Error("Boom")),
            heuristicLabels: vi.fn().mockReturnValue(["MISC/Uncategorized"]),
            normaliseLabels: deps.normaliseLabels,
            ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
            selectPrimaryCategory: deps.selectPrimaryCategory,
            // onError is undefined
          }
        )
      ).resolves.toBeDefined();
    });

    it("uses heuristics after AI returns empty labels", async () => {
      const heuristics = vi.fn().mockReturnValue(["LOGISTICS/Travel"]);

      const result = await classifyEmail(
        {
          subject: "Flight booking",
          body: "Confirmed",
          fromName: "Airline",
          fromEmail: "airline@example.com",
        },
        {
          analyzeEmail: vi.fn().mockResolvedValue({
            summary: "Flight confirmed",
            labels: [],
            sentiment: { label: "neutral", confidence: 0.25 },
          }),
          heuristicLabels: heuristics,
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(heuristics).toHaveBeenCalledWith("Flight booking", "Confirmed");
      expect(result.labels).toContain("LOGISTICS/Travel");
      expect(result.usedHeuristics).toBe(true);
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0.25 });
    });
  });

  describe("fallback label handling", () => {
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
          analyzeEmail: vi.fn().mockResolvedValue({
            summary: "",
            labels: [],
            sentiment: { label: "neutral", confidence: 0 },
          }),
          heuristicLabels: vi.fn().mockReturnValue([]),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.labels).toEqual([EMAIL_FALLBACK_LABEL]);
      expect(result.category).toBe(EMAIL_FALLBACK_LABEL);
      expect(result.usedHeuristics).toBe(true);
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0 });
    });

    it("uses fallback label when all sources return empty arrays", async () => {
      const result = await classifyEmail(
        {
          subject: "",
          body: "",
          fromName: null,
          fromEmail: "unknown@example.com",
        },
        {
          analyzeEmail: vi.fn().mockResolvedValue({
            summary: "",
            labels: [],
            sentiment: { label: "neutral", confidence: 0 },
          }),
          heuristicLabels: vi.fn().mockReturnValue([]),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: (labels) => labels, // Return empty
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.labels).toEqual([EMAIL_FALLBACK_LABEL]);
      expect(result.category).toBe(EMAIL_FALLBACK_LABEL);
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0 });
    });
  });

  describe("label normalization and coverage", () => {
    it("normalizes labels from AI response", async () => {
      const normalise = vi.fn().mockReturnValue(["LEGAL/Contract_Draft"]);
      const analyze = vi.fn().mockResolvedValue({
        summary: "Contract",
        labels: ["legal/contract_draft"], // Malformed
        sentiment: { label: "positive", confidence: 0.5 },
      });

      const result = await classifyEmail(
        {
          subject: "Contract",
          body: "Review",
          fromName: "Lawyer",
          fromEmail: "lawyer@example.com",
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: normalise,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(normalise).toHaveBeenCalledWith(["legal/contract_draft"]);
      expect(result.labels).toEqual(["LEGAL/Contract_Draft"]);
    });

    it("ensures default label coverage is applied", async () => {
      const ensureCoverage = vi.fn().mockReturnValue(["BOOKING/Offer", "territory/GB"]);

      const result = await classifyEmail(
        {
          subject: "Show offer",
          body: "London gig",
          fromName: "Promoter",
          fromEmail: "promoter@example.com",
          cachedSummary: "Cached",
          cachedLabels: ["BOOKING/Offer"],
        },
        {
          analyzeEmail: vi.fn(),
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: ensureCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(ensureCoverage).toHaveBeenCalled();
      expect(result.labels).toEqual(["BOOKING/Offer", "territory/GB"]);
      expect(result.sentiment).toEqual(DEFAULT_EMAIL_SENTIMENT);
    });
  });

  describe("category selection", () => {
    it("selects primary category from multiple labels", async () => {
      const selectCategory = vi.fn().mockReturnValue("LEGAL/Contract_Draft");

      const result = await classifyEmail(
        {
          subject: "Contract",
          body: "Review",
          fromName: "Lawyer",
          fromEmail: "lawyer@example.com",
          cachedSummary: "Legal contract",
          cachedLabels: ["LEGAL/Contract_Draft", "artist/Barry_Cant_Swim", "territory/GB"],
        },
        {
          analyzeEmail: vi.fn(),
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: selectCategory,
        }
      );

      expect(selectCategory).toHaveBeenCalledWith(["LEGAL/Contract_Draft", "artist/Barry_Cant_Swim", "territory/GB"]);
      expect(result.category).toBe("LEGAL/Contract_Draft");
    });

    it("uses fallback label when selectPrimaryCategory returns null", async () => {
      const result = await classifyEmail(
        {
          subject: "Random",
          body: "Content",
          fromName: "Sender",
          fromEmail: "sender@example.com",
          cachedSummary: "Summary",
          cachedLabels: ["artist/Barry_Cant_Swim"], // No primary category
        },
        {
          analyzeEmail: vi.fn(),
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: vi.fn().mockReturnValue(null),
        }
      );

      expect(result.category).toBe(EMAIL_FALLBACK_LABEL);
    });
  });

  describe("tracking flags", () => {
    it("sets correct tracking flags for cache-only path", async () => {
      const result = await classifyEmail(
        {
          subject: "Test",
          body: "Body",
          fromName: "Sender",
          fromEmail: "sender@example.com",
          cachedSummary: "Cached",
          cachedLabels: ["FINANCE/Invoice"],
          cachedSentiment: { label: "neutral", confidence: 0.3 },
        },
        {
          analyzeEmail: vi.fn(),
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.usedCachedSummary).toBe(true);
      expect(result.usedCachedLabels).toBe(true);
      expect(result.usedAi).toBe(false);
      expect(result.usedHeuristics).toBe(false);
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0.3 });
    });

    it("sets correct tracking flags for AI path", async () => {
      const result = await classifyEmail(
        {
          subject: "Test",
          body: "Body",
          fromName: "Sender",
          fromEmail: "sender@example.com",
        },
        {
          analyzeEmail: vi.fn().mockResolvedValue({
            summary: "AI summary",
            labels: ["BOOKING/Offer"],
            sentiment: { label: "neutral", confidence: 0 },
          }),
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.usedCachedSummary).toBe(false);
      expect(result.usedCachedLabels).toBe(false);
      expect(result.usedAi).toBe(true);
      expect(result.usedHeuristics).toBe(false);
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0 });
    });

    it("sets correct tracking flags for AI + heuristic path", async () => {
      const result = await classifyEmail(
        {
          subject: "Test",
          body: "Body",
          fromName: "Sender",
          fromEmail: "sender@example.com",
        },
        {
          analyzeEmail: vi.fn().mockResolvedValue({
            summary: "AI summary",
            labels: [],
            sentiment: { label: "neutral", confidence: 0.1 },
          }),
          heuristicLabels: vi.fn().mockReturnValue(["MISC/Uncategorized"]),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.usedAi).toBe(true);
      expect(result.usedHeuristics).toBe(true);
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0.1 });
    });

    it("sets correct tracking flags for error + heuristic path", async () => {
      const result = await classifyEmail(
        {
          subject: "Test",
          body: "Body",
          fromName: "Sender",
          fromEmail: "sender@example.com",
        },
        {
          analyzeEmail: vi.fn().mockRejectedValue(new Error("Boom")),
          heuristicLabels: vi.fn().mockReturnValue(["BOOKING/Offer"]),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
          onError: vi.fn(),
        }
      );

      expect(result.usedAi).toBe(false); // AI call failed before setting flag
      expect(result.usedHeuristics).toBe(true);
      expect(result.sentiment).toEqual(DEFAULT_EMAIL_SENTIMENT);
    });
  });

  describe("integration scenarios", () => {
    it("handles complete booking offer email flow", async () => {
      const analyze = vi.fn().mockResolvedValue({
        summary: "Show offer for Barry Cant Swim at Fabric London, £5,000, 2026-05-10",
        labels: [
          "BOOKING/Offer",
          "artist/Barry_Cant_Swim",
          "venue/Fabric",
          "city/London",
          "territory/GB",
          "date/2026-05-10",
        ],
        sentiment: { label: "positive", confidence: 0.95 },
      });

      const result = await classifyEmail(
        {
          subject: "Show Offer - Fabric London",
          body: "We'd like to book Barry Cant Swim for May 10, 2026 at Fabric for £5,000 guarantee...",
          fromName: "Fabric Bookings",
          fromEmail: "bookings@fabriclondon.com",
        },
        {
          analyzeEmail: analyze,
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.summary).toContain("Barry Cant Swim");
      expect(result.summary).toContain("Fabric London");
      expect(result.labels).toContain("BOOKING/Offer");
      expect(result.labels).toContain("venue/Fabric");
      expect(result.category).toBe("BOOKING/Offer");
      expect(result.usedAi).toBe(true);
      expect(result.sentiment).toEqual({ label: "positive", confidence: 0.95 });
    });

    it("handles legal contract email with cached data", async () => {
      const result = await classifyEmail(
        {
          subject: "Re: Contract - Fabric London",
          body: "See attached executed contract",
          fromName: "Legal Team",
          fromEmail: "legal@venue.com",
          cachedSummary: "Executed contract for Fabric London show on 2026-05-10",
          cachedLabels: ["LEGAL/Contract_Executed", "venue/Fabric", "date/2026-05-10"],
          cachedSentiment: { label: "neutral", confidence: 0.4 },
        },
        {
          analyzeEmail: vi.fn(),
          heuristicLabels: vi.fn(),
          normaliseLabels: deps.normaliseLabels,
          ensureDefaultLabelCoverage: deps.ensureDefaultLabelCoverage,
          selectPrimaryCategory: deps.selectPrimaryCategory,
        }
      );

      expect(result.category).toBe("LEGAL/Contract_Executed");
      expect(result.usedCachedSummary).toBe(true);
      expect(result.usedCachedLabels).toBe(true);
      expect(result.sentiment).toEqual({ label: "neutral", confidence: 0.4 });
    });
  });
});
