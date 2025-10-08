import { describe, it, expect } from "vitest";
import { computeTopActions, buildDigestPayload } from "../projectPriority";
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
    ...overrides,
  } satisfies ProjectTaskRecord;
}

function buildTimelineItem(overrides: Partial<TimelineItemRecord> = {}): TimelineItemRecord {
  return {
    id: "timeline-1",
    projectId: "project-1",
    type: "event",
    title: "Travel to NYC",
    startsAt: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: null,
    lane: "Live",
    territory: "US",
    status: null,
    priority: 55,
    refTable: null,
    refId: null,
    metadata: {},
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
    });

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].entityType).toBe("email");
    expect(actions[0].score).toBeGreaterThan(80);
    expect(actions[0].rationale.join(" ")).toContain("Visas_Immigration");
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
    });

    expect(payload.meta.totalProjects).toBe(1);
    expect(payload.projects[0].metrics.healthScore).toBe(82);
    expect(payload.topActions.length).toBeGreaterThan(0);
    expect(payload.topActions[0].projectName).toBe(project.name);
  });
});
