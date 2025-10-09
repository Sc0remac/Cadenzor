import type {
  ProjectTaskRecord,
  TimelineItemRecord,
  TimelineDependencyRecord,
  ProjectTopAction,
  EmailRecord,
  EmailTriageState,
  ProjectRecord,
  ApprovalRecord,
  ProjectDigestMetrics,
  DigestTopAction,
  DigestProjectSnapshot,
  DigestPayload,
} from "./types";
import { buildConflictIndex, detectTimelineConflicts, type TimelineConflict } from "./timelineConflicts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const CATEGORY_SEVERITY_WEIGHTS: Record<string, number> = Object.freeze({
  "LEGAL/Contract_Executed": 95,
  "LEGAL/Contract_Draft": 90,
  "LEGAL/Addendum_or_Amendment": 88,
  "LEGAL/NDA_or_Clearance": 82,
  "LEGAL/Insurance_Indemnity": 80,
  "LEGAL/Compliance": 76,
  "FINANCE/Settlement": 94,
  "FINANCE/Invoice": 86,
  "FINANCE/Payment_Remittance": 70,
  "FINANCE/Banking_Details": 96,
  "FINANCE/Tax_Docs": 82,
  "FINANCE/Expenses_Receipts": 66,
  "FINANCE/Royalties_Publishing": 62,
  "LOGISTICS/Itinerary_DaySheet": 83,
  "LOGISTICS/Travel": 90,
  "LOGISTICS/Accommodation": 78,
  "LOGISTICS/Ground_Transport": 74,
  "LOGISTICS/Visas_Immigration": 95,
  "LOGISTICS/Technical_Advance": 82,
  "LOGISTICS/Passes_Access": 70,
  "BOOKING/Offer": 86,
  "BOOKING/Hold_or_Availability": 72,
  "BOOKING/Confirmation": 90,
  "BOOKING/Reschedule_or_Cancel": 96,
  "PROMO/Promo_Time_Request": 78,
  "PROMO/Press_Feature": 60,
  "PROMO/Radio_Playlist": 58,
  "PROMO/Deliverables": 74,
  "PROMO/Promos_Submission": 50,
  "ASSETS/Artwork": 55,
  "ASSETS/Audio": 68,
  "ASSETS/Video": 62,
  "ASSETS/Photos": 48,
  "ASSETS/Logos_Brand": 52,
  "ASSETS/EPK_OneSheet": 56,
  "FAN/Support_or_Thanks": 20,
  "FAN/Request": 28,
  "FAN/Issues_or_Safety": 72,
  "MISC/Uncategorized": 18,
});

const DEFAULT_EMAIL_SEVERITY = 40;

const TRIAGE_STATE_ADJUSTMENTS: Record<EmailTriageState, number> = {
  unassigned: 12,
  acknowledged: -8,
  snoozed: -24,
  resolved: -80,
};

const UNREAD_URGENCY_BONUS = 18;
const SNOOZE_AGE_REDUCTION = 0.65;

const CROSS_LABEL_RULES: Array<{
  test: (label: string) => boolean;
  weight: number;
  description: string;
}> = [
  {
    test: (label) => label.toLowerCase().startsWith("approval/"),
    weight: 22,
    description: "Pending approval",
  },
  {
    test: (label) => label.toLowerCase().startsWith("risk/"),
    weight: 24,
    description: "Risk flagged",
  },
  {
    test: (label) => label.toLowerCase().startsWith("status/escalated"),
    weight: 18,
    description: "Escalated thread",
  },
  {
    test: (label) => label.toLowerCase().startsWith("status/pending_reply"),
    weight: 14,
    description: "Awaiting reply",
  },
];

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
}

function formatDays(diffDays: number): string {
  const absolute = Math.abs(diffDays);
  if (absolute < 1) {
    return "<1d";
  }
  return `${Math.round(absolute)}d`;
}

function formatHours(diffHours: number): string {
  const absolute = Math.abs(diffHours);
  if (absolute < 1) {
    return "<1h";
  }
  if (absolute < 24) {
    return `${Math.round(absolute)}h`;
  }
  return formatDays(diffHours / 24);
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

function computeEmailComponents(email: EmailRecord, now: Date): ScoreComponent[] {
  const components: ScoreComponent[] = [];
  const categoryWeight = CATEGORY_SEVERITY_WEIGHTS[email.category] ?? DEFAULT_EMAIL_SEVERITY;
  components.push({ label: `Category ${email.category}`, value: categoryWeight });

  if (email.priorityScore != null && !Number.isNaN(email.priorityScore)) {
    const priorityValue = Math.round(Math.min(100, Math.max(0, email.priorityScore)) * 0.6);
    if (priorityValue !== 0) {
      components.push({ label: `Model priority ${email.priorityScore}`, value: priorityValue });
    }
  }

  if (email.receivedAt) {
    const received = new Date(email.receivedAt);
    if (!Number.isNaN(received.getTime())) {
      const diffMs = now.getTime() - received.getTime();
      if (diffMs >= 0) {
        const ageHours = diffMs / HOUR_MS;
        let ageValue: number;
        if (ageHours < 4) {
          ageValue = Math.round(ageHours * 5);
        } else if (ageHours < 24) {
          ageValue = Math.round(16 + (ageHours - 4) * 2.2);
        } else {
          ageValue = Math.round(40 + Math.min(28, (ageHours - 24) * 1.5));
        }

        if (email.triageState === "snoozed") {
          ageValue = Math.round(ageValue * SNOOZE_AGE_REDUCTION);
        }

        if (ageValue !== 0) {
          components.push({ label: `Idle ${formatHours(ageHours)}`, value: ageValue });
        }
      }
    }
  }

  if (!email.isRead) {
    components.push({ label: "Unread in inbox", value: UNREAD_URGENCY_BONUS });
  }

  const state = email.triageState ?? "unassigned";
  const triageAdjustment = TRIAGE_STATE_ADJUSTMENTS[state] ?? 0;
  if (triageAdjustment !== 0) {
    components.push({ label: `Triage ${state}`, value: triageAdjustment });
  }

  const uniqueLabels = Array.isArray(email.labels) ? Array.from(new Set(email.labels)) : [];
  for (const rule of CROSS_LABEL_RULES) {
    if (uniqueLabels.some(rule.test)) {
      components.push({ label: rule.description, value: rule.weight });
    }
  }

  return components;
}

function buildEmailTopAction(projectId: string, email: EmailRecord, now: Date): ProjectTopAction | null {
  if (email.triageState === "resolved") {
    return null;
  }

  const components = computeEmailComponents(email, now);
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

function calculateHealthScore(openTasks: number, conflicts: number, linkedEmails: number): number {
  const taskPenalty = Math.min(45, openTasks * 4);
  const conflictPenalty = Math.min(30, conflicts * 7);
  const emailPenalty = Math.min(20, linkedEmails * 2);
  const health = 100 - taskPenalty - conflictPenalty - emailPenalty;
  return Math.max(5, Math.min(100, Math.round(health)));
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
    if (item.status === "done" || item.status === "canceled") {
      continue;
    }

    const components: ScoreComponent[] = [];
    if (item.startsAt) {
      components.push(...computeDateComponent(new Date(item.startsAt), now, "Starts"));
    } else if (item.endsAt) {
      components.push(...computeDateComponent(new Date(item.endsAt), now, "Ends"));
    } else if (item.dueAt) {
      components.push(...computeDateComponent(new Date(item.dueAt), now, "Due"));
    } else {
      components.push({ label: "Undated timeline entry", value: 6 });
    }

    components.push(...computeManualPriorityComponent(item.priorityScore, 0.25));

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
    const action = buildEmailTopAction(projectId, email, now);
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
    const healthScore = entry.metrics?.healthScore ?? calculateHealthScore(openTasks, conflictCount, linkedEmails);
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
