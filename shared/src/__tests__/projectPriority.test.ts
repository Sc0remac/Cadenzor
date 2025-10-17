import { describe, it, expect } from "vitest";
import { computeTopActions, buildDigestPayload } from "../projectPriority";
import { getPriorityConfig, clonePriorityConfig } from "../priorityConfig";
import type { PriorityConfig } from "../priorityConfig";
import type {
  EmailRecord,
  ProjectRecord,
  ProjectTaskRecord,
  TimelineItemRecord,
  TimelineDependencyRecord,
  ApprovalRecord,
} from "../types";

const NOW = new Date("2025-11-01T12:00:00.000Z");

function buildTask(overrides: Partial<ProjectTaskRecord> = {}): ProjectTaskRecord {
  return {
    id: "task-1",
    projectId: "project-1",
    title: "Send contract",
    description: null,
    status: "todo",
    dueAt: new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    priority: 70,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    assigneeId: null,
    createdBy: null,
    laneId: null,
    laneSlug: null,
    laneName: null,
    laneColor: null,
    laneIcon: null,
    ...overrides,
  } satisfies ProjectTaskRecord;
}

function buildTimelineItem(overrides: Partial<TimelineItemRecord> = {}): TimelineItemRecord {
  return {
    id: "timeline-1",
    projectId: "project-1",
    type: "PROMO_SLOT",
    title: "Travel to NYC",
    startsAt: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: null,
    lane: "PROMO",
    territory: "US",
    status: "planned",
    priorityScore: 55,
    priorityComponents: null,
    labels: {},
    links: {},
    kind: null,
    description: null,
    dueAt: null,
    timezone: "UTC",
    createdBy: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  } satisfies TimelineItemRecord;
}

function buildEmail(overrides: Partial<EmailRecord> = {}): EmailRecord {
  return {
    id: "email-1",
    fromName: "Agent",
    fromEmail: "agent@example.com",
    subject: "Visa documents required",
    receivedAt: new Date(NOW.getTime() - 6 * 60 * 60 * 1000).toISOString(),
    category: "LOGISTICS/Visas_Immigration",
    isRead: false,
    summary: null,
    labels: ["risk/high"],
    priorityScore: 92,
    triageState: "unassigned",
    triagedAt: null,
    ...overrides,
  } satisfies EmailRecord;
}

function buildProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "project-1",
    artistId: null,
    name: "North America Tour",
    slug: "north-america-tour",
    description: null,
    status: "active",
    startDate: null,
    endDate: null,
    color: "#1F2937",
    labels: {},
    priorityProfile: null,
    createdBy: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  } satisfies ProjectRecord;
}

describe("projectPriority", () => {
  it("elevates critical emails into top actions", () => {
    const emails = [buildEmail()];

    const actions = computeTopActions({
      projectId: "project-1",
      tasks: [],
      timelineItems: [],
      dependencies: [],
      emails,
      now: NOW,
      minimumCount: 3,
      priorityConfig: getPriorityConfig(),
    });

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].entityType).toBe("email");
    expect(actions[0].score).toBeGreaterThan(80);
    expect(actions[0].rationale.join(" ")).toContain("Visas_Immigration");
  });

  it("respects configurable email category weights", () => {
    const priorityConfig = getPriorityConfig();
    const urgentCategory = "LOGISTICS/Visas_Immigration";
    const calmCategory = "FAN/Support_or_Thanks";
    const urgentEmail = buildEmail({ id: "email-urgent", category: urgentCategory, labels: [], priorityScore: 0 });
    const calmEmail = buildEmail({ id: "email-calm", category: calmCategory, labels: [], priorityScore: 0 });

    const baseline = computeTopActions({
      projectId: "project-1",
      tasks: [],
      timelineItems: [],
      dependencies: [],
      emails: [urgentEmail, calmEmail],
      now: NOW,
      minimumCount: 2,
      priorityConfig,
    });

    expect(baseline[0]?.refId).toBe("email-urgent");

    const customConfig: PriorityConfig = clonePriorityConfig();
    customConfig.email.categoryWeights[urgentCategory] = 10;
    customConfig.email.categoryWeights[calmCategory] = 160;

    const tweaked = computeTopActions({
      projectId: "project-1",
      tasks: [],
      timelineItems: [],
      dependencies: [],
      emails: [urgentEmail, calmEmail],
      now: NOW,
      minimumCount: 2,
      priorityConfig: customConfig,
    });

    expect(tweaked[0]?.refId).toBe("email-calm");
  });

  it("applies configurable manual priority weight for tasks", () => {
    const baseActions = computeTopActions({
      projectId: "project-1",
      tasks: [buildTask({ id: "task-manual", priority: 80, dueAt: null })],
      timelineItems: [],
      dependencies: [],
      emails: [],
      now: NOW,
      minimumCount: 1,
      priorityConfig: getPriorityConfig(),
    });

    const baseScore = baseActions[0]?.score ?? 0;

    const customConfig = clonePriorityConfig();
    customConfig.tasks.manualPriorityWeight = customConfig.tasks.manualPriorityWeight * 2;

    const customActions = computeTopActions({
      projectId: "project-1",
      tasks: [buildTask({ id: "task-manual", priority: 80, dueAt: null })],
      timelineItems: [],
      dependencies: [],
      emails: [],
      now: NOW,
      minimumCount: 1,
      priorityConfig: customConfig,
    });

    expect(customActions[0]?.score ?? 0).toBeGreaterThan(baseScore);
  });

  it("builds digest payload with meta counts", () => {
    const project = buildProject();
    const payload = buildDigestPayload({
      projects: [
        {
          project,
          tasks: [buildTask()],
          timelineItems: [buildTimelineItem()],
          dependencies: [] as TimelineDependencyRecord[],
          approvals: [] as ApprovalRecord[],
          emails: [buildEmail()],
          metrics: {
            openTasks: 1,
            upcomingTimeline: 1,
            linkedEmails: 1,
            conflicts: 0,
            healthScore: 82,
            trend: "steady",
          },
        },
      ],
      now: NOW,
      perProjectLimit: 3,
      topActionLimit: 5,
      priorityConfig: getPriorityConfig(),
    });

    expect(payload.meta.totalProjects).toBe(1);
    expect(payload.projects[0].metrics.healthScore).toBe(82);
    expect(payload.topActions.length).toBeGreaterThan(0);
    expect(payload.topActions[0].projectName).toBe(project.name);
  });
});
