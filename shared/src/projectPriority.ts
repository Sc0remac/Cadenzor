import type {
  ProjectTaskRecord,
  ProjectTopAction,
  TimelineItemRecord,
} from "./types";

export interface ScoreOptions {
  now?: Date;
  conflictItemIds?: Set<string>;
}

export interface ScoreResult {
  score: number;
  rationale: string[];
}

interface ScoreContribution {
  label: string;
  delta: number;
}

const MS_PER_HOUR = 60 * 60 * 1000;

function toMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function formatRationale(contributions: ScoreContribution[]): string[] {
  if (contributions.length === 0) {
    return ["No urgency signals"];
  }

  return contributions
    .filter((entry) => Math.round(entry.delta) !== 0)
    .map((entry) => {
      const rounded = Math.round(entry.delta);
      const sign = rounded > 0 ? "+" : "";
      return `${entry.label} (${sign}${rounded})`;
    });
}

function applyManualPriority(
  priority: number,
  contributions: ScoreContribution[]
) {
  if (!Number.isFinite(priority) || priority <= 0) {
    return;
  }

  const weight = Math.min(25, Math.max(6, priority * 0.35));
  contributions.push({
    label: `Manual priority ${Math.round(priority)}`,
    delta: weight,
  });
}

function applyConflictPenalty(
  itemId: string,
  conflictIds: Set<string>,
  contributions: ScoreContribution[]
) {
  if (!conflictIds.has(itemId)) {
    return;
  }

  contributions.push({ label: "Conflict penalty", delta: -18 });
}

export function scoreTimelineItem(
  item: TimelineItemRecord,
  options: ScoreOptions = {}
): ScoreResult {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const conflicts = options.conflictItemIds ?? new Set<string>();

  if (item.status && ["done", "completed", "cancelled", "archived"].includes(item.status)) {
    return { score: 0, rationale: ["Completed"] };
  }

  const contributions: ScoreContribution[] = [];

  const startMs = toMs(item.startsAt);
  const endMs = toMs(item.endsAt);
  const manualPriority = Number.isFinite(item.priority) ? Number(item.priority) : 0;

  applyManualPriority(manualPriority, contributions);
  applyConflictPenalty(item.id, conflicts, contributions);

  if (startMs != null) {
    const deltaHours = (startMs - nowMs) / MS_PER_HOUR;

    if (deltaHours <= -1) {
      const overdueHours = Math.abs(deltaHours);
      contributions.push({
        label: `Started ${overdueHours.toFixed(1)}h ago`,
        delta: 62,
      });
      const penalty = Math.min(38, overdueHours * 1.35);
      contributions.push({ label: "Overdue penalty", delta: -penalty });
    } else if (deltaHours < 1) {
      contributions.push({ label: "Starts now", delta: 48 - Math.abs(deltaHours) * 6 });
    } else if (deltaHours <= 24) {
      const base = 42 - deltaHours * 0.9;
      contributions.push({ label: `Starts in ${deltaHours.toFixed(1)}h`, delta: base });
    } else if (deltaHours <= 72) {
      const base = 28 - (deltaHours - 24) * 0.4;
      contributions.push({ label: `Starts in ${(deltaHours / 24).toFixed(1)}d`, delta: base });
    } else if (deltaHours <= 7 * 24) {
      const base = 16 - (deltaHours - 72) * 0.15;
      contributions.push({ label: `Starts in ${(deltaHours / 24).toFixed(1)}d`, delta: base });
    } else {
      contributions.push({ label: "Future scheduled", delta: 6 });
    }
  } else if (endMs != null) {
    const deltaHours = (endMs - nowMs) / MS_PER_HOUR;
    if (deltaHours < 0) {
      const overdue = Math.abs(deltaHours);
      contributions.push({
        label: `Ended ${overdue.toFixed(1)}h ago`,
        delta: 34,
      });
      contributions.push({ label: "Overdue penalty", delta: -Math.min(28, overdue * 1.1) });
    } else {
      contributions.push({ label: "Ends soon", delta: 18 });
    }
  } else {
    contributions.push({ label: "No schedule set", delta: 12 });
  }

  const score = contributions.reduce((total, entry) => total + entry.delta, 0);

  return {
    score: Math.round(score),
    rationale: formatRationale(contributions),
  };
}

export function scoreProjectTask(
  task: ProjectTaskRecord,
  options: ScoreOptions = {}
): ScoreResult {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();

  if (task.status && ["done", "completed", "archived"].includes(task.status)) {
    return { score: 0, rationale: ["Completed"] };
  }

  const contributions: ScoreContribution[] = [];

  const dueMs = toMs(task.dueAt);
  const manualPriority = Number.isFinite(task.priority) ? Number(task.priority) : 0;

  applyManualPriority(manualPriority, contributions);

  if (dueMs != null) {
    const deltaHours = (dueMs - nowMs) / MS_PER_HOUR;
    if (deltaHours <= -1) {
      const overdue = Math.abs(deltaHours);
      contributions.push({ label: `Due ${overdue.toFixed(1)}h ago`, delta: 58 });
      contributions.push({ label: "Overdue penalty", delta: -Math.min(42, overdue * 1.6) });
    } else if (deltaHours < 2) {
      contributions.push({ label: "Due now", delta: 46 - deltaHours * 6 });
    } else if (deltaHours <= 24) {
      contributions.push({ label: "Due in <24h", delta: 34 - (deltaHours - 2) * 0.9 });
    } else if (deltaHours <= 72) {
      contributions.push({ label: "Due in <3d", delta: 24 - (deltaHours - 24) * 0.35 });
    } else if (deltaHours <= 14 * 24) {
      contributions.push({
        label: `Due in ${(deltaHours / 24).toFixed(1)}d`,
        delta: 14 - (deltaHours - 72) * 0.1,
      });
    } else {
      contributions.push({ label: "Future task", delta: 6 });
    }
  } else {
    contributions.push({ label: "No due date", delta: 10 });
  }

  if (task.status === "waiting") {
    contributions.push({ label: "Waiting status", delta: -6 });
  }

  const score = contributions.reduce((total, entry) => total + entry.delta, 0);

  return {
    score: Math.round(score),
    rationale: formatRationale(contributions),
  };
}

export function buildTopActions(
  timelineItems: TimelineItemRecord[],
  tasks: ProjectTaskRecord[],
  conflictItemIds: Set<string>,
  limit = 8
): ProjectTopAction[] {
  const now = new Date();
  const minimum = Math.max(limit, 5);
  const actions: ProjectTopAction[] = [];

  for (const item of timelineItems) {
    const { score, rationale } = scoreTimelineItem(item, { now, conflictItemIds });
    actions.push({
      id: item.id,
      kind: "timeline",
      title: item.title,
      score,
      rationale,
      dueAt: item.startsAt,
      lane: item.lane ?? undefined,
      relatedEmailId: item.refTable === "emails" ? item.refId ?? undefined : undefined,
      metadata: { type: item.type, status: item.status ?? undefined },
    });
  }

  for (const task of tasks) {
    const { score, rationale } = scoreProjectTask(task, { now });
    actions.push({
      id: task.id,
      kind: "task",
      title: task.title,
      score,
      rationale,
      dueAt: task.dueAt ?? undefined,
      metadata: { status: task.status },
    });
  }

  return actions
    .sort((a, b) => b.score - a.score)
    .slice(0, minimum);
}
