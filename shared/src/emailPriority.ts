import type { EmailLabel, EmailTriageState, PriorityEmailAdvancedBoost } from "./types";
import {
  DEFAULT_PRIORITY_CONFIG,
  type PriorityConfig,
  type PriorityEmailCrossLabelRule,
} from "./priorityConfig";

const HOUR_MS = 60 * 60 * 1000;

export interface EmailPriorityInput {
  category: EmailLabel;
  labels?: EmailLabel[] | null;
  receivedAt?: string | null;
  isRead: boolean;
  triageState?: EmailTriageState | null;
  snoozedUntil?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
  subject?: string | null;
  hasAttachments?: boolean | null;
  /**
   * Optional precomputed model priority score (0-100) to blend with manual weighting.
   */
  modelScore?: number | null;
}

export interface EmailPriorityComponent {
  label: string;
  value: number;
}

export interface EmailPriorityOptions {
  now?: Date;
  config?: PriorityConfig | PriorityConfig["email"];
}

export interface EmailPriorityBreakdown {
  total: number;
  components: EmailPriorityComponent[];
}

function isFullPriorityConfig(
  config: PriorityConfig | PriorityConfig["email"]
): config is PriorityConfig {
  return typeof (config as PriorityConfig).email === "object";
}

function resolveEmailConfig(
  config?: PriorityConfig | PriorityConfig["email"]
): PriorityConfig["email"] {
  if (!config) {
    return DEFAULT_PRIORITY_CONFIG.email;
  }
  if (isFullPriorityConfig(config)) {
    return config.email;
  }
  return config;
}

function matchesCrossLabelRule(rule: PriorityEmailCrossLabelRule, label: string): boolean {
  const comparisonLabel = rule.caseInsensitive ? label.toLowerCase() : label;
  const prefix = rule.caseInsensitive ? rule.prefix.toLowerCase() : rule.prefix;
  return comparisonLabel.startsWith(prefix);
}

function getEmailDomain(email: string | null | undefined): string | null {
  if (!email || typeof email !== "string") {
    return null;
  }
  const match = email.split("@");
  if (match.length === 2 && match[1]) {
    return match[1].toLowerCase();
  }
  return null;
}

function matchesAdvancedBoost(
  boost: PriorityEmailAdvancedBoost,
  components: EmailPriorityComponent[],
  input: EmailPriorityInput,
  currentScore: number
): boolean {
  const criteria = boost.criteria ?? {};

  if (criteria.minPriority != null && currentScore < criteria.minPriority) {
    return false;
  }

  if (criteria.senders && criteria.senders.length > 0) {
    const sender = (input.fromEmail ?? input.fromName ?? "").toLowerCase();
    const matchSender = criteria.senders.some((value) => sender.includes(value.toLowerCase()));
    if (!matchSender) {
      return false;
    }
  }

  if (criteria.domains && criteria.domains.length > 0) {
    const domain = getEmailDomain(input.fromEmail ?? null);
    if (!domain || !criteria.domains.some((value) => domain === value.toLowerCase())) {
      return false;
    }
  }

  if (criteria.keywords && criteria.keywords.length > 0) {
    const subject = (input.subject ?? "").toLowerCase();
    if (!criteria.keywords.some((keyword) => subject.includes(keyword.toLowerCase()))) {
      return false;
    }
  }

  if (criteria.labels && criteria.labels.length > 0) {
    const labels = Array.isArray(input.labels) ? input.labels.map((label) => label.toLowerCase()) : [];
    if (!criteria.labels.some((label) => labels.includes(label.toLowerCase()))) {
      return false;
    }
  }

  if (criteria.categories && criteria.categories.length > 0) {
    const category = input.category?.toLowerCase();
    if (!criteria.categories.some((value) => category === value.toLowerCase())) {
      return false;
    }
  }

  if (criteria.hasAttachment != null) {
    const hasAttachments = input.hasAttachments ?? false;
    if (criteria.hasAttachment !== hasAttachments) {
      return false;
    }
  }

  return true;
}

function formatHours(diffHours: number): string {
  const absolute = Math.abs(diffHours);
  if (absolute < 1) {
    return "<1h";
  }
  if (absolute < 24) {
    return `${Math.round(absolute)}h`;
  }
  const diffDays = absolute / 24;
  if (diffDays < 1) {
    return "<1d";
  }
  return `${Math.round(diffDays)}d`;
}

function resolveIdleAgeValue(
  ageHours: number,
  triageState: EmailTriageState,
  snoozedUntil: string | null,
  config: PriorityConfig["email"],
  now: Date
): number {
  const idleConfig = config.idleAge;
  let value: number;

  if (ageHours < idleConfig.shortWindowHours) {
    value = Math.round(ageHours * idleConfig.shortWindowMultiplier);
  } else if (ageHours < idleConfig.mediumWindowEndHours) {
    const hoursIntoMedium = Math.max(0, ageHours - idleConfig.mediumWindowStartHours);
    value = Math.round(idleConfig.mediumWindowBase + hoursIntoMedium * idleConfig.mediumWindowMultiplier);
  } else {
    const hoursBeyondLongStart = Math.max(0, ageHours - idleConfig.longWindowStartHours);
    const incremental = Math.min(
      idleConfig.longWindowMaxBonus,
      hoursBeyondLongStart * idleConfig.longWindowMultiplier
    );
    value = Math.round(idleConfig.longWindowBase + incremental);
  }

  if (triageState === "snoozed") {
    const snoozeDate = snoozedUntil ? new Date(snoozedUntil) : null;
    if (!snoozeDate || snoozeDate.getTime() > now.getTime()) {
      value = Math.round(value * config.snoozeAgeReduction);
    } else {
      value = Math.round(value * config.snoozeAgeReduction);
    }
  }

  return value;
}

export function calculateEmailPriorityComponents(
  input: EmailPriorityInput,
  options: EmailPriorityOptions = {}
): EmailPriorityComponent[] {
  const config = resolveEmailConfig(options.config);
  const now = options.now ?? new Date();
  const components: EmailPriorityComponent[] = [];

  const categoryWeight =
    config.categoryWeights[input.category] ?? config.defaultCategoryWeight;
  components.push({ label: `Category ${input.category}`, value: categoryWeight });

  const modelScore = input.modelScore;
  if (modelScore != null && !Number.isNaN(modelScore)) {
    const clamped = Math.min(100, Math.max(0, modelScore));
    const weighted = Math.round(clamped * config.modelPriorityWeight);
    if (weighted !== 0) {
      components.push({ label: `Model priority ${clamped}`, value: weighted });
    }
  }

  if (input.receivedAt) {
    const received = new Date(input.receivedAt);
    if (!Number.isNaN(received.getTime())) {
      const diffMs = now.getTime() - received.getTime();
      if (diffMs >= 0) {
        const ageHours = diffMs / HOUR_MS;
        const ageValue = resolveIdleAgeValue(
          ageHours,
          input.triageState ?? "unassigned",
          input.snoozedUntil ?? null,
          config,
          now
        );
        if (ageValue !== 0) {
          components.push({ label: `Idle ${formatHours(ageHours)}`, value: ageValue });
        }
      }
    }
  }

  if (!input.isRead) {
    components.push({ label: "Unread in inbox", value: config.unreadBonus });
  }

  const state = input.triageState ?? "unassigned";
  const triageAdjustment = config.triageStateAdjustments[state] ?? 0;
  if (triageAdjustment !== 0) {
    components.push({ label: `Triage ${state}`, value: triageAdjustment });
  }

  const labels = Array.isArray(input.labels) ? input.labels : [];
  const uniqueLabels = Array.from(new Set(labels));
  for (const rule of config.crossLabelRules) {
    if (uniqueLabels.some((label) => matchesCrossLabelRule(rule, label))) {
      components.push({ label: rule.description, value: rule.weight });
    }
  }

  let runningScore = sumEmailPriorityComponents(components);
  for (const boost of config.advancedBoosts ?? []) {
    if (matchesAdvancedBoost(boost, components, input, runningScore)) {
      components.push({ label: boost.label, value: boost.weight });
      runningScore += boost.weight;
    }
  }

  return components;
}

export function sumEmailPriorityComponents(components: EmailPriorityComponent[]): number {
  return components.reduce((total, component) => total + component.value, 0);
}

export function calculateEmailInboxPriority(
  input: EmailPriorityInput,
  options: EmailPriorityOptions = {}
): number {
  const components = calculateEmailPriorityComponents(input, options);
  const total = Math.round(sumEmailPriorityComponents(components));
  return Math.max(0, total);
}

export function buildEmailPriorityBreakdown(
  input: EmailPriorityInput,
  options: EmailPriorityOptions = {}
): EmailPriorityBreakdown {
  const components = calculateEmailPriorityComponents(input, options);
  const total = Math.max(0, Math.round(sumEmailPriorityComponents(components)));
  return { total, components };
}
