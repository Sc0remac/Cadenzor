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

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function toMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
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

  const rationale: string[] = [];
  let score = 0;

  const startMs = toMs(item.startsAt);
  const endMs = toMs(item.endsAt);
  const manualPriority = Number.isFinite(item.priority) ? item.priority : 0;

  if (manualPriority > 0) {
    score += Math.min(30, Math.max(5, manualPriority * 0.3));
    rationale.push(`Manual priority (${manualPriority})`);
  }

  if (startMs != null) {
    const delta = startMs - nowMs;

    if (delta <= 0) {
      const overdueHours = Math.abs(delta) / MS_PER_HOUR;
      const overdueScore = Math.min(40, 10 + overdueHours * 0.75);
      score += overdueScore;
      rationale.push(`Overdue by ${overdueHours.toFixed(1)}h`);
    } else if (delta < 48 * MS_PER_HOUR) {
      const urgencyScore = 35 - (delta / (48 * MS_PER_HOUR)) * 10;
      score += urgencyScore;
      rationale.push(`Starts in ${(delta / MS_PER_HOUR).toFixed(1)}h`);
    } else if (delta < 7 * MS_PER_DAY) {
      const urgencyScore = 15 - (delta / (7 * MS_PER_DAY)) * 10;
      score += Math.max(5, urgencyScore);
      rationale.push(`Starts in ${(delta / MS_PER_DAY).toFixed(1)}d`);
    }
  }

  if (endMs != null && endMs < nowMs) {
    const tailDelta = (nowMs - endMs) / MS_PER_HOUR;
    score += Math.min(20, 5 + tailDelta * 0.25);
    rationale.push(`Ended ${tailDelta.toFixed(1)}h ago`);
  }

  if (conflicts.has(item.id)) {
    score += 20;
    rationale.push("Conflict detected");
  }

  if (!item.startsAt && !item.endsAt) {
    score += 10;
    rationale.push("Unsheduled item");
  }

  return {
    score: Math.max(0, Math.round(score)),
    rationale: rationale.length > 0 ? rationale : ["No urgency signals"],
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

  const rationale: string[] = [];
  let score = 0;

  const dueMs = toMs(task.dueAt);
  const manualPriority = Number.isFinite(task.priority) ? task.priority : 0;

  if (manualPriority > 0) {
    score += Math.min(30, Math.max(5, manualPriority * 0.3));
    rationale.push(`Manual priority (${manualPriority})`);
  }

  if (dueMs != null) {
    const delta = dueMs - nowMs;
    if (delta <= 0) {
      const overdueHours = Math.abs(delta) / MS_PER_HOUR;
      score += Math.min(40, 10 + overdueHours * 0.75);
      rationale.push(`Overdue by ${overdueHours.toFixed(1)}h`);
    } else if (delta < 24 * MS_PER_HOUR) {
      score += 25;
      rationale.push("Due in <24h");
    } else if (delta < 3 * MS_PER_DAY) {
      score += 15;
      rationale.push("Due in <3d");
    } else {
      score += Math.max(5, 10 - delta / (14 * MS_PER_DAY));
      rationale.push(`Due in ${(delta / MS_PER_DAY).toFixed(1)}d`);
    }
  } else {
    score += 8;
    rationale.push("No due date");
  }

  return {
    score: Math.max(0, Math.round(score)),
    rationale: rationale.length > 0 ? rationale : ["No urgency signals"],
  };
}

export function buildTopActions(
  timelineItems: TimelineItemRecord[],
  tasks: ProjectTaskRecord[],
  conflictItemIds: Set<string>,
  limit = 8
): ProjectTopAction[] {
  const now = new Date();
  const actions: ProjectTopAction[] = [];

  for (const item of timelineItems) {
    const { score, rationale } = scoreTimelineItem(item, { now, conflictItemIds });
    if (score <= 0) continue;
    actions.push({
      id: item.id,
      kind: "timeline",
      title: item.title,
      score,
      rationale,
      dueAt: item.startsAt,
      lane: item.lane ?? undefined,
      metadata: { type: item.type },
    });
  }

  for (const task of tasks) {
    const { score, rationale } = scoreProjectTask(task, { now });
    if (score <= 0) continue;
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
    .slice(0, limit);
}
