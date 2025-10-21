import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIORITY_CONFIG,
  applyPriorityConfigPreset,
  clonePriorityConfig,
  getPriorityConfig,
  getPriorityConfigPreset,
  isPriorityConfigEqual,
  listPriorityConfigPresets,
  normalizePriorityConfigInput,
  type PriorityConfigInput,
} from "../priorityConfig";

describe("priorityConfig", () => {
  it("returns defaults when no input provided", () => {
    const config = getPriorityConfig();
    expect(config).toEqual(DEFAULT_PRIORITY_CONFIG);
  });

  it("applies overrides while preserving other fields", () => {
    const overrides: PriorityConfigInput = {
      email: {
        categoryWeights: {
          "LEGAL/Contract_Executed": 40,
        },
        unreadBonus: 25,
        advancedBoosts: [
          {
            id: "vip",
            label: "VIP",
            weight: 10,
            criteria: { senders: ["vip@agency.com"] },
          },
        ],
      },
      time: {
        overdueBasePenalty: 10,
      },
      scheduling: {
        timezone: "Europe/London",
        entries: [
          {
            id: "monday",
            label: "Monday focus",
            presetSlug: "release-week",
            daysOfWeek: [1],
            startTime: "08:00",
            autoApply: true,
          },
        ],
      },
    };

    const config = normalizePriorityConfigInput(overrides);
    expect(config.email.categoryWeights["LEGAL/Contract_Executed"]).toBe(40);
    expect(config.email.unreadBonus).toBe(25);
    expect(config.email.advancedBoosts[0]?.label).toBe("VIP");
    expect(config.time.overdueBasePenalty).toBe(10);
    expect(config.time.upcomingBaseScore).toBe(DEFAULT_PRIORITY_CONFIG.time.upcomingBaseScore);
    expect(config.scheduling.timezone).toBe("Europe/London");
  });

  it("clamps numeric overrides to safe ranges", () => {
    const overrides: PriorityConfigInput = {
      email: {
        categoryWeights: {
          "LEGAL/Contract_Executed": 1000,
          "MISC/Uncategorized": -50,
        },
        modelPriorityWeight: 3,
        snoozeAgeReduction: -5,
        idleAge: {
          mediumWindowEndHours: -10,
        },
        advancedBoosts: [
          {
            id: "attachments",
            label: "Attachment boost",
            weight: 500,
            criteria: { hasAttachment: true, minPriority: -20 },
          },
        ],
      },
      health: {
        baseScore: 500,
        openTaskPenaltyPerItem: -10,
      },
    };

    const config = normalizePriorityConfigInput(overrides);
    expect(config.email.categoryWeights["LEGAL/Contract_Executed"]).toBe(100);
    expect(config.email.categoryWeights["MISC/Uncategorized"]).toBe(0);
    expect(config.email.modelPriorityWeight).toBeCloseTo(1);
    expect(config.email.snoozeAgeReduction).toBeCloseTo(0);
    expect(config.email.idleAge.mediumWindowEndHours).toBe(1);
    expect(config.email.advancedBoosts[0]?.weight).toBe(200);
    expect(config.email.advancedBoosts[0]?.criteria.minPriority).toBe(0);
    expect(config.health.baseScore).toBe(200);
    expect(config.health.openTaskPenaltyPerItem).toBe(0);
  });

  it("provides deterministic equality checks", () => {
    const baseline = clonePriorityConfig();
    const withOverrides = normalizePriorityConfigInput({
      tasks: { manualPriorityWeight: 0.35 },
    });

    expect(isPriorityConfigEqual(DEFAULT_PRIORITY_CONFIG, baseline)).toBe(true);
    expect(isPriorityConfigEqual(DEFAULT_PRIORITY_CONFIG, withOverrides)).toBe(false);
    const mergedBack = normalizePriorityConfigInput({ tasks: { manualPriorityWeight: baseline.tasks.manualPriorityWeight } });
    expect(isPriorityConfigEqual(baseline, mergedBack)).toBe(true);
  });

  it("exposes curated presets with metadata", () => {
    const presets = listPriorityConfigPresets();
    expect(presets.length).toBeGreaterThanOrEqual(4);
    const releaseWeek = presets.find((preset) => preset.slug === "release-week");
    expect(releaseWeek).toBeTruthy();
    expect(releaseWeek?.adjustments).toContain("+16 PROMO/Deliverables");
  });

  it("retrieves presets case-insensitively", () => {
    const preset = getPriorityConfigPreset("Legal-Focus");
    expect(preset).not.toBeNull();
    expect(preset?.slug).toBe("legal-focus");
  });

  it("applies preset overrides on top of defaults", () => {
    const config = applyPriorityConfigPreset("release-week");
    expect(config.email.categoryWeights["PROMO/Deliverables"]).toBe(90);
    expect(config.email.unreadBonus).toBe(24);
  });

  it("can apply presets against an existing base configuration", () => {
    const base = clonePriorityConfig();
    base.email.unreadBonus = 10;
    const config = applyPriorityConfigPreset("touring-season", base);
    expect(config.email.unreadBonus).toBe(10);
    expect(config.email.categoryWeights["LOGISTICS/Travel"]).toBe(96);
  });
});
