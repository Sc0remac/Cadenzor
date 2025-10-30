import { describe, expect, it, vi } from "vitest";
import type { EmailThreadRollingSummary } from "@kazador/shared";
import { summarizeThread } from "../threadSummarizationJob";

const stubSupabase = {} as any;

describe("threadSummarizationJob", () => {
  it("skips when the thread does not have enough messages", async () => {
    const fetchThread = vi.fn().mockResolvedValue({
      id: "thread-1",
      user_id: "user-1",
      message_count: 1,
      rolling_summary: null,
      last_summarized_at: null,
      last_message_at: null,
    });

    const fetchThreadEmails = vi.fn().mockResolvedValue([
      {
        id: "email-1",
        subject: "Subject",
        from_name: "Sender",
        from_email: "sender@example.com",
        received_at: "2025-02-01T10:00:00Z",
        summary: "Email summary",
        message_index: 0,
      },
    ]);

    const overrides = {
      fetchThread,
      fetchThreadEmails,
      fetchAttachments: vi.fn().mockResolvedValue([]),
      updateThreadSummary: vi.fn(),
      analyzeThread: vi.fn(),
      now: () => new Date("2025-02-02T12:00:00Z"),
      logger: vi.fn(),
    };

    const result = await summarizeThread(stubSupabase, "thread-1", {}, overrides);

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("not_enough_messages");
    expect(overrides.analyzeThread).not.toHaveBeenCalled();
    expect(overrides.updateThreadSummary).not.toHaveBeenCalled();
  });

  it("skips when there are no new messages since the prior summary", async () => {
    const priorSummary: EmailThreadRollingSummary = {
      summary: "Existing summary",
      keyPoints: ["Initial key point"],
      outstandingQuestions: ["Pending question"],
      deadlines: [],
      nextAction: "Follow up",
      lastMessageIndex: 2,
      sentiment: { label: "neutral", confidence: 0.5 },
      updatedAt: "2025-02-01T10:00:00Z",
      attachmentsOfInterest: [],
    };

    const fetchThread = vi.fn().mockResolvedValue({
      id: "thread-2",
      user_id: "user-2",
      message_count: 3,
      rolling_summary: priorSummary,
      last_summarized_at: "2025-02-01T10:00:00Z",
      last_message_at: "2025-02-01T10:00:00Z",
    });

    const fetchThreadEmails = vi.fn().mockResolvedValue([
      {
        id: "email-1",
        subject: "Subject",
        from_name: "Sender",
        from_email: "sender@example.com",
        received_at: "2025-02-01T09:00:00Z",
        summary: "First message",
        message_index: 0,
      },
      {
        id: "email-2",
        subject: "Subject",
        from_name: "Sender",
        from_email: "sender@example.com",
        received_at: "2025-02-01T09:30:00Z",
        summary: "Second message",
        message_index: 1,
      },
      {
        id: "email-3",
        subject: "Subject",
        from_name: "Sender",
        from_email: "sender@example.com",
        received_at: "2025-02-01T09:45:00Z",
        summary: "Third message",
        message_index: 2,
      },
    ]);

    const overrides = {
      fetchThread,
      fetchThreadEmails,
      fetchAttachments: vi.fn().mockResolvedValue([]),
      updateThreadSummary: vi.fn(),
      analyzeThread: vi.fn(),
      now: () => new Date("2025-02-02T12:00:00Z"),
      logger: vi.fn(),
    };

    const result = await summarizeThread(stubSupabase, "thread-2", {}, overrides);

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no_new_messages");
    expect(overrides.analyzeThread).not.toHaveBeenCalled();
    expect(overrides.updateThreadSummary).not.toHaveBeenCalled();
  });

  it("summarizes threads with new messages and updates Supabase", async () => {
    const fetchThread = vi.fn().mockResolvedValue({
      id: "thread-3",
      user_id: "user-3",
      message_count: 3,
      rolling_summary: {
        summary: "Initial summary",
        keyPoints: ["Existing point"],
        outstandingQuestions: ["Pending question"],
        deadlines: [],
        nextAction: "Respond",
        lastMessageIndex: 1,
      },
      last_summarized_at: "2025-02-01T09:30:00Z",
      last_message_at: "2025-02-01T10:30:00Z",
    });

    const fetchThreadEmails = vi.fn().mockResolvedValue([
      {
        id: "email-1",
        subject: "Project Update",
        from_name: "Alice",
        from_email: "alice@example.com",
        received_at: "2025-02-01T09:00:00Z",
        summary: "Initial details",
        message_index: 0,
      },
      {
        id: "email-2",
        subject: "Project Update",
        from_name: "Bob",
        from_email: "bob@example.com",
        received_at: "2025-02-01T09:25:00Z",
        summary: "Follow-up information",
        message_index: 1,
      },
      {
        id: "email-3",
        subject: "Project Update",
        from_name: "Alice",
        from_email: "alice@example.com",
        received_at: "2025-02-01T10:15:00Z",
        summary: "Final confirmation",
        message_index: 2,
      },
    ]);

    const fetchAttachments = vi.fn().mockResolvedValue([
      {
        id: "att-1",
        email_id: "email-3",
        filename: "contract.pdf",
        mime_type: "application/pdf",
        size: 204800,
      },
    ]);

    const analyzeThread = vi.fn().mockResolvedValue({
      summary: "Updated summary",
      keyPoints: ["Existing point", "Contract finalized"],
      outstandingQuestions: ["Pending question"],
      deadlines: [
        {
          description: "Send countersigned contract",
          dueAt: "2025-02-05T12:00:00Z",
        },
      ],
      sentiment: { label: "positive", confidence: 0.72 },
      nextAction: "Share contract internally",
      attachmentsOfInterest: ["contract.pdf"],
      lastMessageIndex: 2,
      tokenUsage: {
        promptTokens: 820,
        completionTokens: 240,
        totalTokens: 1060,
        model: "gpt-4o-mini",
        costUsd: 0.0126,
      },
    });

    const updateThreadSummary = vi.fn().mockResolvedValue(undefined);
    const logger = vi.fn();

    const result = await summarizeThread(
      stubSupabase,
      "thread-3",
      {
        openaiApiKey: "test-key",
        minMessageCount: 2,
        tokenWarnThreshold: 2000,
      },
      {
        fetchThread,
        fetchThreadEmails,
        fetchAttachments,
        updateThreadSummary,
        analyzeThread,
        now: () => new Date("2025-02-02T12:00:00Z"),
        logger,
      }
    );

    expect(analyzeThread).toHaveBeenCalledTimes(1);
    const [analysisInput] = analyzeThread.mock.calls[0];
    expect(analysisInput.messages).toHaveLength(3);
    expect(analysisInput.messages[2]?.attachments?.[0]?.filename).toBe("contract.pdf");
    expect(updateThreadSummary).toHaveBeenCalledTimes(1);

    const updatePayload = updateThreadSummary.mock.calls[0][1];
    expect(updatePayload.rolling_summary.summary).toBe("Updated summary");
    expect(updatePayload.rolling_summary.attachmentsOfInterest).toEqual(["contract.pdf"]);
    expect(updatePayload.rolling_summary.lastMessageIndex).toBe(2);
    expect(updatePayload.last_summarized_at).toBe("2025-02-02T12:00:00.000Z");

    expect(result.status).toBe("summarized");
    expect(result.summary?.summary).toBe("Updated summary");
    expect(result.tokenUsage).toEqual({
      promptTokens: 820,
      completionTokens: 240,
      totalTokens: 1060,
      model: "gpt-4o-mini",
      costUsd: 0.0126,
    });

    expect(logger).toHaveBeenCalledWith("info", "Thread summary updated", expect.any(Object));
  });
});
