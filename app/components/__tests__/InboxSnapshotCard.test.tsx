import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EmailRecord } from "@kazador/shared";
import type { ThreadRecord } from "../../lib/supabaseClient";
import { InboxSnapshotCard } from "../home/dashboard-cards/InboxSnapshotCard";

describe("InboxSnapshotCard", () => {
  it("renders email rows when in email mode", () => {
    const emails: EmailRecord[] = [
      {
        id: "email-1",
        fromName: "Jane Smith",
        fromEmail: "jane@example.com",
        subject: "Contract updates",
        receivedAt: new Date().toISOString(),
        category: "LEGAL/Contract_Draft",
        isRead: false,
        labels: ["LEGAL/Contract_Draft"],
        priorityScore: 82,
        summary: "Here are the updates you requested.",
      },
    ];

    render(
      <InboxSnapshotCard
        emails={emails}
        threads={[]}
        loading={false}
        error={null}
        mode="emails"
      />
    );

    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("Contract updates")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("renders thread summaries when in thread mode", () => {
    const now = new Date().toISOString();
    const threads: ThreadRecord[] = [
      {
        id: "thread-1",
        userId: "user-1",
        gmailThreadId: "abc123",
        subjectCanonical: "Tour logistics",
        participants: [
          { name: "Alex Booker", email: "alex@example.com" },
          { name: "Kazador Ops", email: "ops@kazador.com", isUser: true },
        ],
        messageCount: 4,
        firstMessageAt: now,
        lastMessageAt: now,
        unreadCount: 2,
        primaryLabel: "OPERATIONS/Logistics",
        labels: ["OPERATIONS/Logistics"],
        rollingSummary: {
          summary: "Promoter confirmed load-in times and requested staging diagram.",
          keyPoints: [],
          outstandingQuestions: [],
          deadlines: [],
          nextAction: null,
          lastMessageIndex: 3,
          sentiment: null,
          updatedAt: now,
          attachmentsOfInterest: [],
        },
        lastSummarizedAt: now,
        priorityScore: 91,
        priorityComponents: null,
        primaryProjectId: null,
        projectIds: [],
        createdAt: now,
        updatedAt: now,
      },
    ];

    render(
      <InboxSnapshotCard
        emails={[]}
        threads={threads}
        loading={false}
        error={null}
        mode="threads"
      />
    );

    expect(screen.getByText("Tour logistics")).toBeInTheDocument();
    expect(
      screen.getByText("Promoter confirmed load-in times and requested staging diagram.")
    ).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText("2 unread")).toBeInTheDocument();
  });
});
