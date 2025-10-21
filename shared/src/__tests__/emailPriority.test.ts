import { describe, expect, it } from "vitest";
import {
  calculateEmailInboxPriority,
  calculateEmailPriorityComponents,
} from "../emailPriority";
import { DEFAULT_PRIORITY_CONFIG, clonePriorityConfig } from "../priorityConfig";

const NOW = new Date("2024-01-01T12:00:00Z");

function isoHoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

describe("calculateEmailInboxPriority", () => {
  it("returns weighted score with category, unread, and triage contributions", () => {
    const score = calculateEmailInboxPriority(
      {
        category: "LOGISTICS/Travel",
        isRead: false,
        labels: [],
        receivedAt: NOW.toISOString(),
      },
      { now: NOW }
    );

    // Expected: category 90 + unread 18 + triage (unassigned) 12 = 120
    expect(score).toBe(120);
  });

  it("applies idle age windows based on elapsed hours", () => {
    const score = calculateEmailInboxPriority(
      {
        category: "FINANCE/Invoice",
        isRead: true,
        labels: [],
        triageState: "unassigned",
        receivedAt: isoHoursAgo(10),
      },
      { now: NOW }
    );

    // Category 86 + idle age 29 + triage 12 => 127
    expect(score).toBe(127);
  });

  it("includes cross-label boosts case-insensitively", () => {
    const score = calculateEmailInboxPriority(
      {
        category: "BOOKING/Offer",
        isRead: true,
        labels: ["Approval/Contract"],
        receivedAt: NOW.toISOString(),
      },
      { now: NOW }
    );

    // Category 86 + triage 12 + approval rule 22
    expect(score).toBe(120);
  });

  it("applies advanced boosts for VIP senders and attachments", () => {
    const config = clonePriorityConfig(DEFAULT_PRIORITY_CONFIG);
    config.email.advancedBoosts = [
      {
        id: "vip",
        label: "VIP sender",
        description: null,
        weight: 15,
        criteria: { senders: ["vip@agency.com"] },
        explanation: null,
      },
      {
        id: "attachment",
        label: "Has attachment",
        description: null,
        weight: 5,
        criteria: { hasAttachment: true },
        explanation: null,
      },
    ];

    const score = calculateEmailInboxPriority(
      {
        category: "LEGAL/Contract_Draft",
        isRead: false,
        labels: ["legal/contract_draft"],
        receivedAt: NOW.toISOString(),
        fromEmail: "vip@agency.com",
        subject: "Contract attached",
        hasAttachments: true,
      },
      { now: NOW, config }
    );

    // Base category 90 + unread 18 + triage 12 + vip 15 + attachment 5 = 140
    expect(score).toBe(140);
  });

  it("clamps negative totals to zero", () => {
    const score = calculateEmailInboxPriority(
      {
        category: "MISC/Uncategorized",
        isRead: true,
        labels: [],
        triageState: "resolved",
        receivedAt: NOW.toISOString(),
      },
      { now: NOW }
    );

    expect(score).toBe(0);
  });
});

describe("calculateEmailPriorityComponents", () => {
  it("reduces idle age score when snoozed into the future", () => {
    const components = calculateEmailPriorityComponents(
      {
        category: "BOOKING/Offer",
        isRead: true,
        triageState: "snoozed",
        snoozedUntil: new Date(NOW.getTime() + 4 * 60 * 60 * 1000).toISOString(),
        labels: [],
        receivedAt: isoHoursAgo(30),
      },
      { now: NOW, config: DEFAULT_PRIORITY_CONFIG }
    );

    const idleComponent = components.find((component) => component.label.startsWith("Idle"));
    expect(idleComponent).toBeDefined();
    expect(idleComponent?.value).toBe(32);
  });
});
