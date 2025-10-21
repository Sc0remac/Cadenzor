import { describe, expect, it } from "vitest";
import type { EmailRecord } from "../types";
import {
  confidenceLevelToScore,
  createEmptyProjectAssignmentRule,
  evaluateProjectAssignmentRule,
  getTimelineTypeForEmailCategory,
  normalizeProjectAssignmentRuleInput,
  ProjectAssignmentRuleCondition,
  ProjectAssignmentRuleConditionGroup,
} from "../projectAssignmentRules";

function buildEmail(overrides: Partial<EmailRecord & { body?: string }> = {}): EmailRecord & { body?: string } {
  return {
    id: "email-1",
    fromName: "Venue Booker",
    fromEmail: "booking@fabric.london",
    subject: "Offer: Barry Cant Swim - May 10",
    receivedAt: new Date().toISOString(),
    category: "BOOKING/Offer",
    isRead: false,
    summary: "Offer for May 10 at Fabric London.",
    labels: ["territory/UK", "artist/Barry_Cant_Swim"],
    priorityScore: 82,
    triageState: "unassigned",
    snoozedUntil: null,
    source: "gmail",
    attachments: [],
    linkedProjects: null,
    hasAttachments: null,
    attachmentCount: null,
    userId: "user-1",
    ...overrides,
  };
}

describe("normalizeProjectAssignmentRuleInput", () => {
  it("normalises minimal payload and injects defaults", () => {
    const rule = normalizeProjectAssignmentRuleInput(
      {
        id: "rule-1",
        userId: "user-1",
        projectId: "project-1",
        name: "Fabric offers",
        conditions: {
          logic: "or",
          conditions: [
            { field: "subject", operator: "contains", value: ["Fabric"] },
            { field: "from_email", operator: "contains", value: "@fabric.london" },
          ],
        },
        actions: {
          projectId: "project-1",
          confidence: "high",
        },
      },
      {
        createdAt: "2025-12-01T00:00:00.000Z",
      }
    );

    expect(rule.conditions.conditions).toHaveLength(2);
    expect(rule.conditions.logic).toBe("or");
    expect(rule.actions.projectId).toBe("project-1");
    expect(rule.enabled).toBe(true);
    expect(rule.projectId).toBe("project-1");
  });
});

describe("evaluateProjectAssignmentRule", () => {
  const baseRule = createEmptyProjectAssignmentRule("project-1", "user-1");

  it("matches when subject contains expected phrase", () => {
    const conditions: ProjectAssignmentRuleConditionGroup = {
      logic: "and",
      conditions: [
        {
          id: "cond-1",
          field: "subject",
          operator: "contains",
          value: ["Barry"],
        } satisfies ProjectAssignmentRuleCondition,
      ],
    };

    const rule = {
      ...baseRule,
      conditions,
      actions: { ...baseRule.actions, projectId: "project-1" },
    };

    const email = buildEmail();
    const result = evaluateProjectAssignmentRule(rule, { email });
    expect(result.matched).toBe(true);
  });

  it("fails when labels do not include expected value", () => {
    const conditions: ProjectAssignmentRuleConditionGroup = {
      logic: "and",
      conditions: [
        {
          id: "cond-1",
          field: "labels",
          operator: "is_one_of",
          value: ["territory/JP"],
        },
      ],
    };

    const rule = {
      ...baseRule,
      conditions,
    };

    const email = buildEmail();
    const result = evaluateProjectAssignmentRule(rule, { email });
    expect(result.matched).toBe(false);
  });

  it("supports within_last_days operator", () => {
    const conditions: ProjectAssignmentRuleConditionGroup = {
      logic: "and",
      conditions: [
        {
          id: "cond-1",
          field: "received_at",
          operator: "within_last_days",
          value: { days: 7 },
        },
      ],
    };

    const rule = {
      ...baseRule,
      conditions,
    };

    const email = buildEmail({
      receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = evaluateProjectAssignmentRule(rule, { email, now: new Date() });
    expect(result.matched).toBe(true);
  });
});

describe("confidence helpers", () => {
  it("maps confidence to score", () => {
    expect(confidenceLevelToScore("high")).toBe(1);
    expect(confidenceLevelToScore("medium")).toBeCloseTo(0.7);
    expect(confidenceLevelToScore("low")).toBeCloseTo(0.4);
    expect(confidenceLevelToScore(undefined)).toBeNull();
  });
});

describe("getTimelineTypeForEmailCategory", () => {
  it("returns matching type for booking emails", () => {
    expect(getTimelineTypeForEmailCategory("BOOKING/Offer")).toBe("LIVE_HOLD");
  });

  it("defaults to TASK when no mapping matches", () => {
    expect(getTimelineTypeForEmailCategory("MISC")).toBe("TASK");
  });
});
