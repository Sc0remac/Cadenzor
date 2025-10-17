import { describe, expect, it, vi } from "vitest";
import {
  createEmptyAutomationRule,
  normalizeAutomationRuleInput,
  type AutomationActionType,
} from "../automationRules";

vi.useFakeTimers().setSystemTime(new Date("2024-01-01T00:00:00Z"));

describe("automationRules", () => {
  it("creates an empty rule with sane defaults", () => {
    const rule = createEmptyAutomationRule();
    expect(rule.name).toBe("Untitled rule");
    expect(rule.isEnabled).toBe(true);
    expect(rule.trigger.type).toBe("email_received");
    expect(rule.actions).toHaveLength(1);
  });

  it("normalizes partial input", () => {
    const rule = normalizeAutomationRuleInput({
      id: "rule-123",
      name: "Booking offers to tasks",
      isEnabled: "false",
      trigger: {
        type: "email_received",
        options: {
          categories: ["BOOKING/Offer"],
          labels: ["risk/high"],
          triageStates: ["unassigned"],
        },
      },
      actions: [
        {
          type: "assign_timeline_lane" satisfies AutomationActionType,
          params: { lane: "Promo" },
        },
      ],
    });

    expect(rule.id).toBe("rule-123");
    expect(rule.name).toBe("Booking offers to tasks");
    expect(rule.isEnabled).toBe(false);
    expect(rule.trigger.type).toBe("email_received");
    expect(rule.trigger.type).toBe("email_received");
    const emailOptions = rule.trigger.options;
    expect("categories" in emailOptions ? emailOptions.categories : []).toEqual(["BOOKING/Offer"]);
    expect(rule.actions[0].type).toBe("assign_timeline_lane");
    expect(rule.actions[0].params).toEqual({ lane: "Promo" });
  });

  it("applies defaults when data is missing", () => {
    const baseline = createEmptyAutomationRule();
    const rule = normalizeAutomationRuleInput({}, baseline);
    expect(rule.name).toBe(baseline.name);
    expect(rule.trigger.type).toBe("email_received");
    expect(rule.actions).toHaveLength(1);
  });
});
