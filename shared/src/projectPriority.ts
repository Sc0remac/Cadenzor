import type {
  ProjectTaskRecord,
  TimelineItemRecord,
  TimelineDependencyRecord,
  ProjectTopAction,
} from "./types";
import { buildConflictIndex, detectTimelineConflicts, type TimelineConflict } from "./timelineConflicts";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ScoreComponent {
  label: string;
  value: number;
}

export interface ComputeTopActionsInput {
  tasks: ProjectTaskRecord[];
  timelineItems: TimelineItemRecord[];
  dependencies?: TimelineDependencyRecord[];
  conflicts?: TimelineConflict[];
  minimumCount?: number;
  now?: Date;
}

function formatDays(diffDays: number): string {
  const absolute = Math.abs(diffDays);
  if (absolute < 1) {
    return "<1d";
  }
  return `${Math.round(absolute)}d`;
}

function computeDateComponent(date: Date, now: Date, labelPrefix: string): ScoreComponent[] {
  const diffMs = date.getTime() - now.getTime();
  const diffDays = diffMs / DAY_MS;

  if (diffMs >= 0) {
    const clamped = Math.max(0, 45 - Math.round(diffDays * 4));
    if (clamped === 0) {
      return [];
    }
    return [{ label: `${labelPrefix} in ${formatDays(diffDays)}`, value: clamped }];
  }

  const overdueDays = Math.abs(diffDays);
  const penalty = Math.min(60, 25 + Math.round(overdueDays * 6));
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
  conflictIndex: Map<string, TimelineConflict[]>
): ScoreComponent[] {
  const conflicts = conflictIndex.get(itemId);
  if (!conflicts || conflicts.length === 0) {
    return [];
  }
  return conflicts.map((conflict) => {
    const basePenalty = conflict.severity === "error" ? 25 : 15;
    return {
      label: `Conflict: ${conflict.message}`,
      value: -basePenalty,
    } satisfies ScoreComponent;
  });
}

export function computeTopActions(input: ComputeTopActionsInput): ProjectTopAction[] {
  const {
    tasks,
    timelineItems,
    dependencies = [],
    conflicts,
    minimumCount = 5,
    now = new Date(),
  } = input;

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
      components.push(...computeDateComponent(dueDate, now, "Due"));
    } else {
      components.push({ label: "No due date set", value: 10 });
    }

    components.push(...computeManualPriorityComponent(task.priority, 0.3));

    const statusBoost = task.status === "in_progress" ? 8 : task.status === "waiting" ? 4 : 0;
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
    if (item.status && ["done", "completed"].includes(item.status)) {
      continue;
    }

    const components: ScoreComponent[] = [];
    if (item.startsAt) {
      components.push(...computeDateComponent(new Date(item.startsAt), now, "Starts"));
    } else if (item.endsAt) {
      components.push(...computeDateComponent(new Date(item.endsAt), now, "Ends"));
    } else {
      components.push({ label: "Undated timeline entry", value: 6 });
    }

    components.push(...computeManualPriorityComponent(item.priority, 0.25));

    const itemConflicts = computeConflictComponents(item.id, conflictIndex);
    components.push(...itemConflicts);

    const blockers = dependencyLookup.get(item.id) ?? [];
    if (blockers.length > 0) {
      const unresolvedPenalty = blockers.some((dependency) => dependency.kind === "FS") ? 10 : 6;
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
      dueAt: item.endsAt,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      status: item.status,
      refTable: "timeline_items",
      refId: item.id,
      priority: item.priority,
    });
  }

  actions.sort((a, b) => b.score - a.score);

  if (actions.length <= minimumCount) {
    return actions;
  }

  return actions.slice(0, minimumCount);
}
