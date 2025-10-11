import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRIORITY_CONFIG,
  clonePriorityConfig,
  getPriorityConfig,
  isPriorityConfigEqual,
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
      },
      time: {
        overdueBasePenalty: 10,
      },
    };

    const config = normalizePriorityConfigInput(overrides);
    expect(config.email.categoryWeights["LEGAL/Contract_Executed"]).toBe(40);
    expect(config.email.unreadBonus).toBe(25);
    expect(config.time.overdueBasePenalty).toBe(10);
    expect(config.time.upcomingBaseScore).toBe(DEFAULT_PRIORITY_CONFIG.time.upcomingBaseScore);
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
});
