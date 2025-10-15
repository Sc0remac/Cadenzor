import { describe, expect, it } from "vitest";
import type { TimelineLaneDefinition } from "../types";
import { resolveAutoAssignedLane, evaluateLaneAssignment } from "../laneAutoAssignment";

describe("lane auto assignment", () => {
  const baseLane = (overrides: Partial<TimelineLaneDefinition>): TimelineLaneDefinition => ({
    id: overrides.id ?? "lane-1",
    slug: overrides.slug ?? "PROMO",
    userId: overrides.userId ?? null,
    name: overrides.name ?? "Promo",
    description: overrides.description ?? null,
    color: overrides.color ?? null,
    icon: overrides.icon ?? null,
    sortOrder: overrides.sortOrder ?? 100,
    autoAssignRules: overrides.autoAssignRules ?? null,
    isDefault: overrides.isDefault ?? true,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  });

  it("returns null when no lanes have rules", () => {
    const lanes = [baseLane({ id: "lane-1", autoAssignRules: null })];
    const result = resolveAutoAssignedLane(lanes, { title: "Follow up" });
    expect(result).toBeNull();
  });

  it("matches simple key/value rules", () => {
    const lanes = [
      baseLane({
        id: "lane-1",
        slug: "FINANCE",
        name: "Finance",
        sortOrder: 200,
        autoAssignRules: {
          category: ["finance", "budget"],
        },
      }),
      baseLane({
        id: "lane-2",
        slug: "PROMO",
        name: "Promo",
        sortOrder: 300,
        autoAssignRules: {
          type: "task",
        },
      }),
    ];

    const result = resolveAutoAssignedLane(lanes, {
      type: "task",
      category: "Finance",
    });

    expect(result?.id).toBe("lane-1");
  });

  it("evaluates structured any/all conditions", () => {
    const lanes = [
      baseLane({
        id: "lane-1",
        slug: "TRAVEL",
        name: "Travel",
        sortOrder: 50,
        autoAssignRules: {
          all: [
            { field: "type", operator: "eq", value: "task" },
            {
              any: [
                { field: "title", operator: "contains", value: "flight" },
                { field: "description", operator: "contains", value: "hotel" },
              ],
            },
          ],
        },
      }),
    ];

    const result = resolveAutoAssignedLane(lanes, {
      type: "task",
      title: "Book flights to NY",
      description: "Confirm travel and hotel",
    });

    expect(result?.slug).toBe("TRAVEL");
  });

  it("honours sort order precedence when multiple lanes match", () => {
    const lanes = [
      baseLane({
        id: "lane-1",
        slug: "GENERAL",
        sortOrder: 500,
        autoAssignRules: { type: "task" },
      }),
      baseLane({
        id: "lane-2",
        slug: "PRIORITY",
        sortOrder: 100,
        autoAssignRules: {
          all: [
            { field: "status", operator: "ne", value: "done" },
            { field: "priority", operator: "gte", value: 80 },
          ],
        },
      }),
    ];

    const result = resolveAutoAssignedLane(lanes, {
      type: "task",
      status: "todo",
      priority: 90,
    });

    expect(result?.slug).toBe("PRIORITY");
  });

  it("supports evaluateLaneAssignment helper", () => {
    const lane = baseLane({
      id: "lane-1",
      slug: "LEGAL",
      sortOrder: 10,
      autoAssignRules: {
        labels: {
          territory: { operator: "eq", value: "US" },
        },
      },
    });

    const match = evaluateLaneAssignment(lane, {
      labels: { territory: "US" },
    });

    const mismatch = evaluateLaneAssignment(lane, {
      labels: { territory: "UK" },
    });

    expect(match).toBe(true);
    expect(mismatch).toBe(false);
  });
});
