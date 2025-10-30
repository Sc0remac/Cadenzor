import type { EmailThreadRecord } from "./types";

const HOUR_IN_MS = 60 * 60 * 1000;

export type ThreadPriorityComponentId =
  | "recency"
  | "heat"
  | "urgency"
  | "impact"
  | "outstanding";

export interface ThreadPriorityComponentBreakdown {
  id: ThreadPriorityComponentId;
  label: string;
  value: number;
  weight: number;
  weightedValue: number;
  metadata?: Record<string, unknown>;
}

export interface ThreadPriorityResult {
  score: number;
  components: ThreadPriorityComponentBreakdown[];
}

export interface ThreadPriorityInput {
  /**
   * ISO datetime string for the most recent message in the thread.
   */
  lastMessageAt?: string | null;
  /**
   * Total messages observed in the thread.
   */
  messageCount?: number;
  /**
    * Messages observed inside the configured heat window (defaults to 7 days).
    */
  recentMessageCount?: number;
  /**
   * Number of unread messages remaining in the thread.
   */
  unreadCount?: number;
  /**
   * ISO datetime string for the most urgent deadline referenced in the conversation.
   */
  upcomingDeadlineAt?: string | null;
  /**
   * Whether new messages contain explicit urgency or request keywords.
   */
  hasUrgentKeyword?: boolean;
  /**
   * ISO datetime for the next reply that the user is expected to give.
   */
  expectedReplyBy?: string | null;
  /**
   * Count of attachments that should influence perceived impact.
   */
  attachmentsOfInterestCount?: number;
  /**
   * Priority score of an associated project (0-100). Treated as a multiplier.
   */
  linkedProjectPriority?: number | null;
  /**
   * Total unanswered questions directed at the user.
   */
  outstandingQuestions?: number;
  /**
   * Questions whose deadlines or expectations are already overdue.
   */
  overdueQuestions?: number;
}

export interface ThreadPriorityOptions {
  now?: Date;
  config?: ThreadPriorityConfig;
  /**
   * Optional existing thread record used for default fallbacks.
   */
  thread?: Pick<
    EmailThreadRecord,
    "lastMessageAt" | "messageCount" | "unreadCount"
  > | null;
}

export interface ThreadPriorityConfig {
  weights: Record<ThreadPriorityComponentId, number>;
  recencyHalfLifeHours: number;
  heat: {
    activityWindowDays: number;
    highActivityThreshold: number;
    unreadContribution: number;
  };
  urgency: {
    immediateDeadlineHours: number;
    soonDeadlineHours: number;
    upcomingWeekHours: number;
    urgentKeywordBonus: number;
    expectedReplyOverdueHours: number;
  };
  impact: {
    attachmentValue: number;
    maxAttachmentScore: number;
    projectPriorityMultiplier: number;
  };
  outstanding: {
    baseQuestionValue: number;
    overdueBonus: number;
    expectedReplyGraceHours: number;
    maxScore: number;
  };
}

export const DEFAULT_THREAD_PRIORITY_CONFIG: ThreadPriorityConfig = {
  weights: {
    recency: 0.25,
    heat: 0.2,
    urgency: 0.25,
    impact: 0.15,
    outstanding: 0.15,
  },
  recencyHalfLifeHours: 24,
  heat: {
    activityWindowDays: 7,
    highActivityThreshold: 6,
    unreadContribution: 5,
  },
  urgency: {
    immediateDeadlineHours: 24,
    soonDeadlineHours: 72,
    upcomingWeekHours: 24 * 7,
    urgentKeywordBonus: 20,
    expectedReplyOverdueHours: 6,
  },
  impact: {
    attachmentValue: 35,
    maxAttachmentScore: 90,
    projectPriorityMultiplier: 0.6,
  },
  outstanding: {
    baseQuestionValue: 25,
    overdueBonus: 15,
    expectedReplyGraceHours: 12,
    maxScore: 100,
  },
};

function clamp(value: number, min = 0, max = 100): number {
  if (Number.isNaN(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function hoursBetween(late: Date, early: Date): number {
  return (late.getTime() - early.getTime()) / HOUR_IN_MS;
}

function parseDate(input?: string | null): Date | null {
  if (!input) {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function normaliseWeights(
  weights: Record<ThreadPriorityComponentId, number>
): Record<ThreadPriorityComponentId, number> {
  const entries = Object.entries(weights) as Array<
    [ThreadPriorityComponentId, number]
  >;
  const sum = entries.reduce((total, [, value]) => total + value, 0);
  if (sum <= 0) {
    const uniform = 1 / entries.length;
    return entries.reduce((acc, [key]) => {
      acc[key] = uniform;
      return acc;
    }, {} as Record<ThreadPriorityComponentId, number>);
  }
  return entries.reduce((acc, [key, value]) => {
    acc[key] = value / sum;
    return acc;
  }, {} as Record<ThreadPriorityComponentId, number>);
}

function calculateRecencyScore(
  lastMessageAt: string | null | undefined,
  now: Date,
  config: ThreadPriorityConfig
): ThreadPriorityComponentBreakdown {
  const lastMessageDate = parseDate(lastMessageAt);
  if (!lastMessageDate) {
    return {
      id: "recency",
      label: "Recency",
      value: 0,
      weight: 0,
      weightedValue: 0,
      metadata: { reason: "missing_last_message" },
    };
  }

  const hoursSinceLastMessage = hoursBetween(now, lastMessageDate);
  if (hoursSinceLastMessage <= 0) {
    return {
      id: "recency",
      label: "Recency",
      value: 100,
      weight: 0,
      weightedValue: 0,
      metadata: { hoursSinceLastMessage },
    };
  }

  const halfLife = Math.max(config.recencyHalfLifeHours, 1);
  const decayRatio = hoursSinceLastMessage / halfLife;
  const score = clamp(Math.pow(0.5, decayRatio) * 100);

  return {
    id: "recency",
    label: "Recency",
    value: score,
    weight: 0,
    weightedValue: 0,
    metadata: { hoursSinceLastMessage, halfLifeHours: halfLife },
  };
}

function calculateHeatScore(
  input: ThreadPriorityInput,
  thread: ThreadPriorityOptions["thread"],
  config: ThreadPriorityConfig
): ThreadPriorityComponentBreakdown {
  const recentCount =
    input.recentMessageCount ??
    input.messageCount ??
    thread?.messageCount ??
    0;
  const unread = input.unreadCount ?? thread?.unreadCount ?? 0;
  const threshold = Math.max(config.heat.highActivityThreshold, 1);
  const recentActivityRatio = recentCount / threshold;
  const base = clamp(recentActivityRatio * 100);
  const unreadContribution = clamp(unread * config.heat.unreadContribution);
  const value = clamp(base + unreadContribution);

  return {
    id: "heat",
    label: "Heat",
    value,
    weight: 0,
    weightedValue: 0,
    metadata: {
      recentCount,
      unread,
      threshold,
    },
  };
}

function calculateUrgencyScore(
  input: ThreadPriorityInput,
  now: Date,
  config: ThreadPriorityConfig
): ThreadPriorityComponentBreakdown {
  let value = 0;
  const metadata: Record<string, unknown> = {};

  const deadline = parseDate(input.upcomingDeadlineAt);
  if (deadline) {
    const hoursUntilDeadline = hoursBetween(deadline, now);
    metadata.hoursUntilDeadline = hoursUntilDeadline;
    if (hoursUntilDeadline <= 0) {
      value = 100;
    } else if (hoursUntilDeadline <= config.urgency.immediateDeadlineHours) {
      value = 95;
    } else if (hoursUntilDeadline <= config.urgency.soonDeadlineHours) {
      value = 80;
    } else if (hoursUntilDeadline <= config.urgency.upcomingWeekHours) {
      value = 55;
    } else {
      value = 35;
    }
  }

  if (input.hasUrgentKeyword) {
    value = clamp(value + config.urgency.urgentKeywordBonus);
    metadata.hasUrgentKeyword = true;
  }

  const expectedReply = parseDate(input.expectedReplyBy);
  if (expectedReply) {
    const hoursUntilReply = hoursBetween(expectedReply, now);
    metadata.hoursUntilExpectedReply = hoursUntilReply;
    if (hoursUntilReply <= -config.urgency.expectedReplyOverdueHours) {
      value = Math.max(value, 90);
      metadata.expectedReplyStatus = "overdue";
    } else if (hoursUntilReply <= config.urgency.immediateDeadlineHours) {
      value = Math.max(value, 75);
      metadata.expectedReplyStatus = "due_soon";
    }
  }

  return {
    id: "urgency",
    label: "Urgency",
    value,
    weight: 0,
    weightedValue: 0,
    metadata,
  };
}

function calculateImpactScore(
  input: ThreadPriorityInput,
  thread: ThreadPriorityOptions["thread"],
  config: ThreadPriorityConfig
): ThreadPriorityComponentBreakdown {
  const attachmentsCount = input.attachmentsOfInterestCount ?? 0;
  const attachmentScore = clamp(
    attachmentsCount * config.impact.attachmentValue,
    0,
    config.impact.maxAttachmentScore
  );

  const projectPriority = clamp(
    input.linkedProjectPriority ?? 0,
    0,
    100
  );
  const projectContribution = clamp(
    projectPriority * config.impact.projectPriorityMultiplier
  );

  const unread = clamp(input.unreadCount ?? thread?.unreadCount ?? 0, 0, 100);

  const value = clamp(attachmentScore + projectContribution + unread);

  return {
    id: "impact",
    label: "Impact",
    value,
    weight: 0,
    weightedValue: 0,
    metadata: {
      attachmentsCount,
      attachmentScore,
      projectPriority,
      projectContribution,
      unread,
    },
  };
}

function calculateOutstandingScore(
  input: ThreadPriorityInput,
  now: Date,
  config: ThreadPriorityConfig
): ThreadPriorityComponentBreakdown {
  const outstandingCount = Math.max(input.outstandingQuestions ?? 0, 0);
  const overdueCount = Math.max(input.overdueQuestions ?? 0, 0);

  let value = outstandingCount * config.outstanding.baseQuestionValue;
  if (overdueCount > 0) {
    value += overdueCount * config.outstanding.overdueBonus;
  }

  const expectedReply = parseDate(input.expectedReplyBy);
  if (expectedReply) {
    const hoursPastDue = hoursBetween(now, expectedReply);
    if (hoursPastDue > config.outstanding.expectedReplyGraceHours) {
      value = Math.max(value, 80);
    }
  }

  value = clamp(value, 0, config.outstanding.maxScore);

  return {
    id: "outstanding",
    label: "Outstanding Work",
    value,
    weight: 0,
    weightedValue: 0,
    metadata: {
      outstandingCount,
      overdueCount,
    },
  };
}

export function calculateThreadPriority(
  input: ThreadPriorityInput,
  options: ThreadPriorityOptions = {}
): ThreadPriorityResult {
  const config = options.config ?? DEFAULT_THREAD_PRIORITY_CONFIG;
  const now = options.now ?? new Date();
  const threadDefaults = options.thread ?? null;

  const weights = normaliseWeights(config.weights);

  const recency = calculateRecencyScore(
    input.lastMessageAt ?? threadDefaults?.lastMessageAt,
    now,
    config
  );
  const heat = calculateHeatScore(input, threadDefaults, config);
  const urgency = calculateUrgencyScore(input, now, config);
  const impact = calculateImpactScore(input, threadDefaults, config);
  const outstanding = calculateOutstandingScore(input, now, config);

  const components: ThreadPriorityComponentBreakdown[] = [
    recency,
    heat,
    urgency,
    impact,
    outstanding,
  ].map((component) => {
    const weight = weights[component.id];
    const weightedValue = clamp(component.value * weight);
    return {
      ...component,
      weight,
      weightedValue,
    };
  });

  const score = components.reduce((total, component) => {
    return total + component.weightedValue;
  }, 0);

  return {
    score: clamp(score),
    components,
  };
}
