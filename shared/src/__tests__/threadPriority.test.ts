import { describe, expect, it } from "vitest";

import {
  DEFAULT_THREAD_PRIORITY_CONFIG,
  calculateThreadPriority,
} from "../threadPriority";

describe("calculateThreadPriority", () => {
  const now = new Date("2024-01-01T12:00:00Z");

  it("heavily favours recent conversations", () => {
    const result = calculateThreadPriority(
      {
        lastMessageAt: "2024-01-01T11:30:00Z",
        messageCount: 3,
        recentMessageCount: 3,
      },
      { now }
    );

    const recency = result.components.find((c) => c.id === "recency");
    expect(recency?.value ?? 0).toBeGreaterThan(70);
    expect(result.score).toBeGreaterThan(30);
  });

  it("decays recency for stale threads", () => {
    const result = calculateThreadPriority(
      {
        lastMessageAt: "2023-12-20T09:00:00Z",
        messageCount: 1,
      },
      { now }
    );

    const recency = result.components.find((c) => c.id === "recency");
    expect(recency?.value ?? 0).toBeLessThan(15);
    expect(result.score).toBeLessThan(25);
  });

  it("boosts heat for active back-and-forth", () => {
    const result = calculateThreadPriority(
      {
        lastMessageAt: "2023-12-30T09:00:00Z",
        messageCount: 12,
        recentMessageCount: 12,
        unreadCount: 2,
      },
      { now }
    );

    const heat = result.components.find((c) => c.id === "heat");
    expect(heat?.value ?? 0).toBeGreaterThan(80);
    expect(result.score).toBeGreaterThan(20);
  });

  it("flags urgent deadlines and explicit urgency", () => {
    const result = calculateThreadPriority(
      {
        lastMessageAt: "2023-12-31T23:55:00Z",
        upcomingDeadlineAt: "2024-01-01T15:00:00Z",
        hasUrgentKeyword: true,
      },
      { now }
    );

    const urgency = result.components.find((c) => c.id === "urgency");
    expect(urgency?.value ?? 0).toBeGreaterThan(80);
    expect(result.score).toBeGreaterThan(40);
  });

  it("elevates impact for high-priority projects with key attachments", () => {
    const result = calculateThreadPriority(
      {
        attachmentsOfInterestCount: 2,
        linkedProjectPriority: 90,
        unreadCount: 1,
      },
      { now }
    );

    const impact = result.components.find((c) => c.id === "impact");
    expect(impact?.value ?? 0).toBeGreaterThan(60);
  });

  it("captures outstanding and overdue questions", () => {
    const result = calculateThreadPriority(
      {
        outstandingQuestions: 2,
        overdueQuestions: 1,
        expectedReplyBy: "2023-12-31T10:00:00Z",
      },
      { now }
    );

    const outstanding = result.components.find((c) => c.id === "outstanding");
    expect(outstanding?.value ?? 0).toBeGreaterThan(60);
  });

  it("normalises weights when configuration totals differ from 1", () => {
    const config = {
      ...DEFAULT_THREAD_PRIORITY_CONFIG,
      weights: {
        recency: 2,
        heat: 2,
        urgency: 2,
        impact: 2,
        outstanding: 2,
      },
    };

    const result = calculateThreadPriority(
      {
        lastMessageAt: "2024-01-01T11:30:00Z",
        messageCount: 2,
      },
      { now, config }
    );

    const totalWeight = result.components.reduce((sum, component) => {
      return sum + component.weight;
    }, 0);

    expect(Math.round(totalWeight * 1000)).toBe(1000);
  });
});
