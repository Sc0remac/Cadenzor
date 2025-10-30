import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeThread } from "../analyzeThread";
import type { EmailThreadRollingSummary, ThreadAnalysisInput } from "../types";

const ORIGINAL_FETCH = global.fetch;

describe("analyzeThread", () => {
  beforeAll(() => {
    Object.defineProperty(global, "fetch", {
      writable: true,
      value: ORIGINAL_FETCH,
    });
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterAll(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it("performs a full analysis and normalises the response", async () => {
    const mockResponse = {
      summary: "High-level summary.",
      keyPoints: ["Contract signed", "Payment pending"],
      outstandingQuestions: ["Can we confirm the venue?"],
      deadlines: [
        { description: "Confirm venue", dueAt: "2025-02-01T10:00:00Z" },
        { description: "Send invoice", due_at: "2025-02-02T12:00:00Z" },
      ],
      sentiment: { label: "Positive", confidence: 0.76 },
      nextAction: "Reply with updated terms",
      attachmentsOfInterest: ["contract.pdf", "invoice.docx"],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
        usage: { prompt_tokens: 800, completion_tokens: 320, total_tokens: 1120 },
        model: "gpt-4o-mini",
      }),
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const input: ThreadAnalysisInput = {
      threadId: "thread-123",
      messages: [
        {
          id: "m-1",
          subject: "Re: Contract",
          from: { name: "Alice", email: "alice@example.com" },
          to: ["team@example.com"],
          receivedAt: "2025-01-28T09:00:00Z",
          body: "Here is the signed contract.",
          messageIndex: 0,
        },
        {
          id: "m-2",
          subject: "Re: Contract",
          from: { name: "Bob", email: "bob@example.com" },
          to: ["alice@example.com"],
          receivedAt: "2025-01-28T09:30:00Z",
          body: "Please confirm the venue.",
          messageIndex: 1,
        },
      ],
    };

    const result = await analyzeThread(input, "fake-key");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit).toBeDefined();

    const payload = JSON.parse((requestInit as RequestInit).body as string);
    expect(payload.model).toBe("gpt-4o-mini");
    expect(payload.messages).toHaveLength(2);

    expect(result.summary).toBe(mockResponse.summary);
    expect(result.keyPoints).toEqual(mockResponse.keyPoints);
    expect(result.outstandingQuestions).toEqual(["Can we confirm the venue?"]);
    expect(result.deadlines).toHaveLength(2);
    expect(result.deadlines?.[0]?.dueAt).toBe("2025-02-01T10:00:00.000Z");
    expect(result.sentiment.label).toBe("positive");
    expect(result.sentiment.confidence).toBeCloseTo(0.76);
    expect(result.nextAction).toBe("Reply with updated terms");
    expect(result.attachmentsOfInterest).toEqual(["contract.pdf", "invoice.docx"]);
    expect(result.lastMessageIndex).toBe(1);
    expect(result.tokenUsage).toEqual({
      promptTokens: 800,
      completionTokens: 320,
      totalTokens: 1120,
      model: "gpt-4o-mini",
      costUsd: null,
    });
  });

  it("merges incremental summaries and resolves answered questions", async () => {
    const mockResponse = {
      summary: "Updated summary including the latest confirmation.",
      newKeyPoints: ["Venue confirmed for Friday"],
      resolvedQuestions: ["Can we confirm the venue?"],
      newQuestions: ["Who will handle on-site logistics?"],
      deadlines: [{ description: "Send final schedule", dueAt: "2025-02-03T15:00:00Z" }],
      sentiment: { label: "neutral", confidence: 0.45 },
      nextAction: "Prepare final itinerary",
      attachmentsOfInterest: ["schedule.xlsx"],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(mockResponse) } }],
        usage: { prompt_tokens: 420, completion_tokens: 180, total_tokens: 600 },
        model: "gpt-4o-mini",
      }),
    });

    global.fetch = fetchMock as unknown as typeof fetch;

    const priorSummary: EmailThreadRollingSummary = {
      summary: "Initial summary.",
      keyPoints: ["Contract signed", "Awaiting venue confirmation"],
      outstandingQuestions: ["Can we confirm the venue?", "Do we need extra staff?"],
      deadlines: [
        { description: "Confirm venue", dueAt: "2025-02-01T10:00:00Z" },
      ],
      nextAction: "Confirm venue",
      lastMessageIndex: 3,
    };

    const input: ThreadAnalysisInput = {
      threadId: "thread-321",
      messages: [
        {
          id: "m-3",
          subject: "Re: Logistics",
          from: { name: "Alice", email: "alice@example.com" },
          to: ["team@example.com"],
          receivedAt: "2025-01-30T12:00:00Z",
          body: "Venue confirmed for Friday.",
          messageIndex: 4,
        },
        {
          id: "m-4",
          subject: "Re: Logistics",
          from: { name: "Bob", email: "bob@example.com" },
          to: ["alice@example.com"],
          receivedAt: "2025-01-30T12:30:00Z",
          body: "Who will handle on-site logistics?",
          messageIndex: 5,
        },
      ],
      priorSummary,
    };

    const result = await analyzeThread(input, "fake-key");

    expect(result.summary).toBe(mockResponse.summary);
    expect(result.keyPoints).toEqual(["Contract signed", "Awaiting venue confirmation", "Venue confirmed for Friday"]);
    expect(result.outstandingQuestions).toEqual(["Do we need extra staff?", "Who will handle on-site logistics?"]);
    expect(result.newKeyPoints).toEqual(["Venue confirmed for Friday"]);
    expect(result.resolvedQuestions).toEqual(["Can we confirm the venue?"]);
    expect(result.newQuestions).toEqual(["Who will handle on-site logistics?"]);
    expect(result.lastMessageIndex).toBe(5);
    expect(result.deadlines).toEqual([
      { description: "Send final schedule", dueAt: "2025-02-03T15:00:00.000Z", source: undefined },
    ]);
  });
});
