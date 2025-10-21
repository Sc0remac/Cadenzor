import type {
  ProjectTaskRecord,
  TimelineItemRecord,
  TimelineDependencyRecord,
  ProjectTopAction,
  EmailRecord,
  ProjectRecord,
  ApprovalRecord,
  ProjectDigestMetrics,
  DigestTopAction,
  DigestProjectSnapshot,
  DigestPayload,
} from "./types";
import { buildConflictIndex, detectTimelineConflicts, type TimelineConflict } from "./timelineConflicts";
import { getPriorityConfig, type PriorityConfig } from "./priorityConfig";
import { calculateEmailPriorityComponents } from "./emailPriority";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ScoreComponent {
  label: string;
  value: number;
}

export interface ComputeTopActionsInput {
  projectId: string;
  tasks: ProjectTaskRecord[];
  timelineItems: TimelineItemRecord[];
  dependencies?: TimelineDependencyRecord[];
  conflicts?: TimelineConflict[];
  minimumCount?: number;
  now?: Date;
  emails?: EmailRecord[];
  emailLimit?: number;
  priorityConfig?: PriorityConfig;
}

export interface DigestProjectInput {
  project: ProjectRecord;
  tasks: ProjectTaskRecord[];
  timelineItems: TimelineItemRecord[];
  dependencies?: TimelineDependencyRecord[];
  conflicts?: TimelineConflict[];
  emails?: EmailRecord[];
  approvals?: ApprovalRecord[];
  metrics?: Partial<ProjectDigestMetrics>;
}

export interface BuildDigestInput {
  projects: DigestProjectInput[];
  now?: Date;
  perProjectLimit?: number;
  topActionLimit?: number;
  priorityConfig?: PriorityConfig;
}

function formatDays(diffDays: number): string {
  const absolute = Math.abs(diffDays);
  if (absolute < 1) {
    return "<1d";
  }
  return `${Math.round(absolute)}d`;
}

function computeDateComponent(
  date: Date,
  now: Date,
  labelPrefix: string,
  timeConfig: PriorityConfig["time"]
): ScoreComponent[] {
  const diffMs = date.getTime() - now.getTime();
  const diffDays = diffMs / DAY_MS;

  if (diffMs >= 0) {
    const clamped = Math.max(0, timeConfig.upcomingBaseScore - Math.round(diffDays * timeConfig.upcomingDecayPerDay));
    if (clamped === 0) {
      return [];
    }
    return [{ label: `${labelPrefix} in ${formatDays(diffDays)}`, value: clamped }];
  }

  const overdueDays = Math.abs(diffDays);
  const penalty = Math.min(
    timeConfig.overdueMaxPenalty,
    timeConfig.overdueBasePenalty + Math.round(overdueDays * timeConfig.overduePenaltyPerDay)
  );
  return [{ label: `${labelPrefix} overdue by ${formatDays(diffDays)}`, value: -penalty }];
}

function computeManualPriorityComponent(priority: number | null | undefined, weight: number): ScoreComponent[] {
  if (priority == null || Number.isNaN(priority) || priority <= 0) {
    return [];
  }
  const value = Math.round(Math.min(priority, 100) * weight);
  if (value === 0) {
    return [];
  }
  return [{ label: `Manual priority ${priority}`, value }];
}

function computeConflictComponents(
  itemId: string,
  conflictIndex: Map<string, TimelineConflict[]>,
  config: PriorityConfig["timeline"]
): ScoreComponent[] {
  const conflicts = conflictIndex.get(itemId);
  if (!conflicts || conflicts.length === 0) {
    return [];
  }
  return conflicts.map((conflict) => {
    const penalty =
      config.conflictPenalties[conflict.severity] ?? config.conflictPenalties.default;
    return {
      label: `Conflict: ${conflict.message}`,
      value: -penalty,
    } satisfies ScoreComponent;
  });
}

function computeEmailComponents(
  email: EmailRecord,
  now: Date,
  config: PriorityConfig["email"]
): ScoreComponent[] {
  const components = calculateEmailPriorityComponents(
    {
      category: email.category,
      labels: email.labels ?? [],
      receivedAt: email.receivedAt,
      isRead: email.isRead,
      triageState: email.triageState,
      snoozedUntil: (email as unknown as { snoozedUntil?: string | null }).snoozedUntil ?? null,
      modelScore: email.priorityScore ?? null,
    },
    { now, config }
  );

  return components.map((component) => ({
    label: component.label,
    value: component.value,
  }));
}

function buildEmailTopAction(
  projectId: string,
  email: EmailRecord,
  now: Date,
  config: PriorityConfig["email"]
): ProjectTopAction | null {
  if (email.triageState === "resolved") {
    return null;
  }

  const components = computeEmailComponents(email, now, config);
  if (components.length === 0) {
    return null;
  }

  const score = components.reduce((total, component) => total + component.value, 0);
  if (score <= 0) {
    return null;
  }

  const rationale = components
    .filter((component) => component.value !== 0)
    .map((component) => {
      const sign = component.value > 0 ? "+" : "";
      return `${component.label} (${sign}${component.value})`;
    });

  const title = email.subject || email.fromName || email.fromEmail;
  const status = email.triageState ?? (email.isRead ? "acknowledged" : "unassigned");

  return {
    id: `email:${email.id}`,
    projectId,
    entityType: "email",
    title,
    score,
    rationale,
    dueAt: null,
    startsAt: email.receivedAt ?? null,
    endsAt: null,
    status,
    refTable: "emails",
    refId: email.id,
    priority: email.priorityScore ?? null,
  } satisfies ProjectTopAction;
}

function calculateHealthScore(
  openTasks: number,
  conflicts: number,
  linkedEmails: number,
  config: PriorityConfig["health"]
): number {
  const taskPenalty = Math.min(config.openTaskPenaltyCap, openTasks * config.openTaskPenaltyPerItem);
  const conflictPenalty = Math.min(config.conflictPenaltyCap, conflicts * config.conflictPenaltyPerItem);
  const emailPenalty = Math.min(config.linkedEmailPenaltyCap, linkedEmails * config.linkedEmailPenaltyPerItem);
  const health = config.baseScore - taskPenalty - conflictPenalty - emailPenalty;
  return Math.max(config.minScore, Math.min(config.maxScore, Math.round(health)));
}

export function computeTopActions(input: ComputeTopActionsInput): ProjectTopAction[] {
  const {
    projectId,
    tasks,
    timelineItems,
    dependencies = [],
    conflicts,
    minimumCount = 5,
    now = new Date(),
    emails = [],
    emailLimit,
    priorityConfig: providedConfig,
  } = input;

  const priorityConfig = providedConfig ?? getPriorityConfig();
  const timelineConflicts = conflicts ?? detectTimelineConflicts(timelineItems);
  const conflictIndex = buildConflictIndex(timelineConflicts);
  const dependencyLookup = new Map<string, TimelineDependencyRecord[]>();
  for (const dependency of dependencies) {
    const existing = dependencyLookup.get(dependency.toItemId) ?? [];
    existing.push(dependency);
    dependencyLookup.set(dependency.toItemId, existing);
  }

  const actions: ProjectTopAction[] = [];

  for (const task of tasks) {
    if (["done", "completed"].includes(task.status)) {
      continue;
    }

    const components: ScoreComponent[] = [];
    if (task.dueAt) {
      const dueDate = new Date(task.dueAt);
      components.push(...computeDateComponent(dueDate, now, "Due", priorityConfig.time));
    } else {
      components.push({ label: "No due date set", value: priorityConfig.tasks.noDueDateValue });
    }

    components.push(...computeManualPriorityComponent(task.priority, priorityConfig.tasks.manualPriorityWeight));

    const statusBoost = priorityConfig.tasks.statusBoosts[task.status] ?? 0;
    if (statusBoost !== 0) {
      components.push({ label: `Status ${task.status}`, value: statusBoost });
    }

    const score = components.reduce((total, component) => total + component.value, 0);
    const rationale = components
      .filter((component) => component.value !== 0)
      .map((component) => {
        const sign = component.value > 0 ? "+" : "";
        return `${component.label} (${sign}${component.value})`;
      });

    actions.push({
      id: `task:${task.id}`,
      projectId: task.projectId,
      entityType: "task",
      title: task.title,
      score,
      rationale,
      dueAt: task.dueAt,
      startsAt: null,
      endsAt: null,
      status: task.status,
      refTable: "project_tasks",
      refId: task.id,
      priority: task.priority,
    });
  }

  for (const item of timelineItems) {
    if (item.status === "done" || item.status === "canceled") {
      continue;
    }

    const components: ScoreComponent[] = [];
    if (item.startsAt) {
      components.push(...computeDateComponent(new Date(item.startsAt), now, "Starts", priorityConfig.time));
    } else if (item.endsAt) {
      components.push(...computeDateComponent(new Date(item.endsAt), now, "Ends", priorityConfig.time));
    } else if (item.dueAt) {
      components.push(...computeDateComponent(new Date(item.dueAt), now, "Due", priorityConfig.time));
    } else {
      components.push({ label: "Undated timeline entry", value: priorityConfig.timeline.undatedValue });
    }

    components.push(...computeManualPriorityComponent(item.priorityScore, priorityConfig.timeline.manualPriorityWeight));

    const itemConflicts = computeConflictComponents(item.id, conflictIndex, priorityConfig.timeline);
    components.push(...itemConflicts);

    const blockers = dependencyLookup.get(item.id) ?? [];
    if (blockers.length > 0) {
      const unresolvedPenalty = blockers.some((dependency) => dependency.kind === "FS")
        ? priorityConfig.timeline.dependencyPenalties.finishToStart
        : priorityConfig.timeline.dependencyPenalties.other;
      components.push({
        label: `Blocked by ${blockers.length} item${blockers.length === 1 ? "" : "s"}`,
        value: -unresolvedPenalty,
      });
    }

    const score = components.reduce((total, component) => total + component.value, 0);
    const rationale = components
      .filter((component) => component.value !== 0)
      .map((component) => {
        const sign = component.value > 0 ? "+" : "";
        return `${component.label} (${sign}${component.value})`;
      });

    actions.push({
      id: `timeline:${item.id}`,
      projectId: item.projectId,
      entityType: "timeline",
      title: item.title,
      score,
      rationale,
      dueAt: item.dueAt ?? item.endsAt,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      status: item.status,
      refTable: "project_items",
      refId: item.id,
      priority: item.priorityScore,
    });
  }

  const emailActions: ProjectTopAction[] = [];
  for (const email of emails) {
    const action = buildEmailTopAction(projectId, email, now, priorityConfig.email);
    if (action) {
      emailActions.push(action);
    }
  }

  emailActions.sort((a, b) => b.score - a.score);
  const limitedEmailActions = typeof emailLimit === "number" && emailLimit >= 0
    ? emailActions.slice(0, emailLimit)
    : emailActions;
  actions.push(...limitedEmailActions);

  actions.sort((a, b) => b.score - a.score);

  if (actions.length <= minimumCount) {
    return actions;
  }

  return actions.slice(0, minimumCount);
}

export function buildDigestPayload(input: BuildDigestInput): DigestPayload {
  const priorityConfig = input.priorityConfig ?? getPriorityConfig();
  const now = input.now ?? new Date();
  const perProjectLimit = input.perProjectLimit ?? 5;
  const topActionLimit = input.topActionLimit ?? 10;

  const projectSnapshots: DigestProjectSnapshot[] = input.projects.map((entry) => {
    const conflicts = entry.conflicts ?? detectTimelineConflicts(entry.timelineItems);
    const topActions = computeTopActions({
      projectId: entry.project.id,
      tasks: entry.tasks,
      timelineItems: entry.timelineItems,
      dependencies: entry.dependencies,
      conflicts,
      emails: entry.emails,
      minimumCount: perProjectLimit,
      now,
      priorityConfig,
    });

    const openTasks = entry.metrics?.openTasks ?? entry.tasks.filter((task) => !["done", "completed"].includes(task.status)).length;
    const upcomingTimeline = entry.metrics?.upcomingTimeline ?? entry.timelineItems.filter((item) => {
      if (!item.startsAt) return false;
      const startsAt = new Date(item.startsAt);
      if (Number.isNaN(startsAt.getTime())) return false;
      return startsAt.getTime() >= now.getTime();
    }).length;
    const linkedEmails = entry.metrics?.linkedEmails ?? (entry.emails ?? []).length;
    const conflictCount = entry.metrics?.conflicts ?? conflicts.length;
    const healthScore =
      entry.metrics?.healthScore ?? calculateHealthScore(openTasks, conflictCount, linkedEmails, priorityConfig.health);
    const trend = entry.metrics?.trend ?? null;

    const metrics: ProjectDigestMetrics = {
      openTasks,
      upcomingTimeline,
      linkedEmails,
      conflicts: conflictCount,
      healthScore,
      trend,
    } satisfies ProjectDigestMetrics;

    return {
      project: entry.project,
      metrics,
      topActions,
      approvals: entry.approvals ?? [],
    } satisfies DigestProjectSnapshot;
  });

  const digestActions: DigestTopAction[] = projectSnapshots
    .flatMap((snapshot) =>
      snapshot.topActions.map((action) => ({
        ...action,
        projectName: snapshot.project.name,
        projectColor: snapshot.project.color,
        projectStatus: snapshot.project.status,
      }))
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, topActionLimit);

  return {
    generatedAt: now.toISOString(),
    topActions: digestActions,
    projects: projectSnapshots,
    meta: {
      totalProjects: projectSnapshots.length,
      totalPendingApprovals: projectSnapshots.reduce((total, snapshot) => total + snapshot.approvals.length, 0),
      highlightedProjects: projectSnapshots.filter((snapshot) => snapshot.topActions.length > 0).length,
    },
  } satisfies DigestPayload;
}
