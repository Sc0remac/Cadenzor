import type { EmailTriageState } from "./types";

export interface PriorityTimeConfig {
  upcomingBaseScore: number;
  upcomingDecayPerDay: number;
  overdueBasePenalty: number;
  overduePenaltyPerDay: number;
  overdueMaxPenalty: number;
}

export interface PriorityEmailIdleAgeConfig {
  shortWindowHours: number;
  shortWindowMultiplier: number;
  mediumWindowStartHours: number;
  mediumWindowEndHours: number;
  mediumWindowBase: number;
  mediumWindowMultiplier: number;
  longWindowStartHours: number;
  longWindowBase: number;
  longWindowMultiplier: number;
  longWindowMaxBonus: number;
}

export interface PriorityEmailCrossLabelRule {
  prefix: string;
  weight: number;
  description: string;
  caseInsensitive?: boolean;
}

export interface PriorityEmailConfig {
  categoryWeights: Record<string, number>;
  defaultCategoryWeight: number;
  modelPriorityWeight: number;
  unreadBonus: number;
  snoozeAgeReduction: number;
  triageStateAdjustments: Record<EmailTriageState, number>;
  crossLabelRules: PriorityEmailCrossLabelRule[];
  idleAge: PriorityEmailIdleAgeConfig;
}

export interface PriorityTaskConfig {
  noDueDateValue: number;
  manualPriorityWeight: number;
  statusBoosts: Record<string, number>;
}

export interface PriorityTimelineConfig {
  undatedValue: number;
  manualPriorityWeight: number;
  conflictPenalties: Record<string, number> & { default: number };
  dependencyPenalties: {
    finishToStart: number;
    other: number;
  };
}

export interface PriorityHealthConfig {
  baseScore: number;
  minScore: number;
  maxScore: number;
  openTaskPenaltyPerItem: number;
  openTaskPenaltyCap: number;
  conflictPenaltyPerItem: number;
  conflictPenaltyCap: number;
  linkedEmailPenaltyPerItem: number;
  linkedEmailPenaltyCap: number;
}

export interface PriorityConfig {
  time: PriorityTimeConfig;
  email: PriorityEmailConfig;
  tasks: PriorityTaskConfig;
  timeline: PriorityTimelineConfig;
  health: PriorityHealthConfig;
}

export type PriorityConfigInput = {
  time?: Partial<PriorityTimeConfig> | null;
  email?: {
    categoryWeights?: Record<string, unknown> | null;
    defaultCategoryWeight?: unknown;
    modelPriorityWeight?: unknown;
    unreadBonus?: unknown;
    snoozeAgeReduction?: unknown;
    triageStateAdjustments?: Partial<Record<EmailTriageState, unknown>> | null;
    crossLabelRules?: Array<Partial<PriorityEmailCrossLabelRule>> | null;
    idleAge?: Partial<PriorityEmailIdleAgeConfig> | null;
  } | null;
  tasks?: Partial<PriorityTaskConfig> | null;
  timeline?: Partial<PriorityTimelineConfig> | null;
  health?: Partial<PriorityHealthConfig> | null;
} | null;

export type PriorityConfigSource = "default" | "custom";

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

interface SanitizeOptions {
  min?: number;
  max?: number;
  round?: boolean;
}

function sanitizeNumber(value: unknown, fallback: number, options: SanitizeOptions = {}): number {
  const parsed = toNumber(value);
  let result = parsed ?? fallback;
  if (options.min != null) {
    result = Math.max(options.min, result);
  }
  if (options.max != null) {
    result = Math.min(options.max, result);
  }
  if (options.round) {
    result = Math.round(result);
  }
  return Number.isFinite(result) ? result : fallback;
}

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "1") return true;
    if (lower === "false" || lower === "0") return false;
  }
  return fallback;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const property = (value as Record<string, unknown>)[key];
      if (property && typeof property === "object") {
        deepFreeze(property);
      }
    }
  }
  return value;
}

const PRIORITY_CONFIG_DATA: PriorityConfig = {
  time: {
    upcomingBaseScore: 45,
    upcomingDecayPerDay: 4,
    overdueBasePenalty: 25,
    overduePenaltyPerDay: 6,
    overdueMaxPenalty: 60,
  },
  email: {
    categoryWeights: {
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
    },
    defaultCategoryWeight: 40,
    modelPriorityWeight: 0.6,
    unreadBonus: 18,
    snoozeAgeReduction: 0.65,
    triageStateAdjustments: {
      unassigned: 12,
      acknowledged: -8,
      snoozed: -24,
      resolved: -80,
    },
    crossLabelRules: [
      {
        prefix: "approval/",
        weight: 22,
        description: "Pending approval",
        caseInsensitive: true,
      },
      {
        prefix: "risk/",
        weight: 24,
        description: "Risk flagged",
        caseInsensitive: true,
      },
      {
        prefix: "status/escalated",
        weight: 18,
        description: "Escalated thread",
        caseInsensitive: true,
      },
      {
        prefix: "status/pending_reply",
        weight: 14,
        description: "Awaiting reply",
        caseInsensitive: true,
      },
    ],
    idleAge: {
      shortWindowHours: 4,
      shortWindowMultiplier: 5,
      mediumWindowStartHours: 4,
      mediumWindowEndHours: 24,
      mediumWindowBase: 16,
      mediumWindowMultiplier: 2.2,
      longWindowStartHours: 24,
      longWindowBase: 40,
      longWindowMultiplier: 1.5,
      longWindowMaxBonus: 28,
    },
  },
  tasks: {
    noDueDateValue: 10,
    manualPriorityWeight: 0.3,
    statusBoosts: {
      in_progress: 8,
      waiting: 4,
    },
  },
  timeline: {
    undatedValue: 6,
    manualPriorityWeight: 0.25,
    conflictPenalties: {
      error: 25,
      warning: 15,
      default: 15,
    },
    dependencyPenalties: {
      finishToStart: 10,
      other: 6,
    },
  },
  health: {
    baseScore: 100,
    minScore: 5,
    maxScore: 100,
    openTaskPenaltyPerItem: 4,
    openTaskPenaltyCap: 45,
    conflictPenaltyPerItem: 7,
    conflictPenaltyCap: 30,
    linkedEmailPenaltyPerItem: 2,
    linkedEmailPenaltyCap: 20,
  },
};

deepFreeze(PRIORITY_CONFIG_DATA);

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = PRIORITY_CONFIG_DATA;

function sanitizeCategoryWeights(
  overrides: Record<string, unknown> | null | undefined,
  base: Record<string, number>
): Record<string, number> {
  const result: Record<string, number> = { ...base };
  if (!overrides) {
    return result;
  }

  for (const [key, value] of Object.entries(overrides)) {
    const fallback = result[key] ?? base[key] ?? 0;
    result[key] = sanitizeNumber(value, fallback, { min: 0, max: 100, round: true });
  }

  return result;
}

function sanitizeTriageAdjustments(
  overrides: Partial<Record<EmailTriageState, unknown>> | null | undefined,
  base: Record<EmailTriageState, number>
): Record<EmailTriageState, number> {
  const result: Record<EmailTriageState, number> = { ...base };
  if (!overrides) {
    return result;
  }

  for (const [key, value] of Object.entries(overrides)) {
    const state = key as EmailTriageState;
    result[state] = sanitizeNumber(value, result[state] ?? 0, { min: -200, max: 200, round: true });
  }

  return result;
}

function sanitizeCrossLabelRules(
  overrides: Array<Partial<PriorityEmailCrossLabelRule>> | null | undefined,
  base: PriorityEmailCrossLabelRule[]
): PriorityEmailCrossLabelRule[] {
  if (!overrides || overrides.length === 0) {
    return base.map((rule) => clone(rule));
  }

  const overridesByPrefix = new Map<string, PriorityEmailCrossLabelRule>();

  for (const candidate of overrides) {
    if (!candidate) continue;
    const prefixValue = typeof candidate.prefix === "string" ? candidate.prefix.trim() : "";
    if (!prefixValue) continue;
    const fallback = base.find((rule) => rule.prefix === prefixValue);
    const weight = sanitizeNumber(candidate.weight, fallback?.weight ?? 0, {
      min: -200,
      max: 200,
      round: true,
    });
    const descriptionRaw =
      typeof candidate.description === "string" && candidate.description.trim()
        ? candidate.description.trim()
        : fallback?.description ?? prefixValue;
    const caseInsensitive = sanitizeBoolean(candidate.caseInsensitive, fallback?.caseInsensitive ?? true);

    overridesByPrefix.set(prefixValue, {
      prefix: prefixValue,
      weight,
      description: descriptionRaw,
      caseInsensitive,
    });
  }

  const seen = new Set<string>();
  const merged: PriorityEmailCrossLabelRule[] = base.map((rule) => {
    const override = overridesByPrefix.get(rule.prefix);
    seen.add(rule.prefix);
    return override ? override : clone(rule);
  });

  for (const [prefix, rule] of overridesByPrefix.entries()) {
    if (!seen.has(prefix)) {
      merged.push(rule);
    }
  }

  return merged;
}

function sanitizeEmailConfig(
  input: PriorityConfigInput["email"],
  base: PriorityEmailConfig
): PriorityEmailConfig {
  if (!input) {
    return clone(base);
  }

  return {
    categoryWeights: sanitizeCategoryWeights(input.categoryWeights, base.categoryWeights),
    defaultCategoryWeight: sanitizeNumber(input.defaultCategoryWeight, base.defaultCategoryWeight, {
      min: 0,
      max: 100,
      round: true,
    }),
    modelPriorityWeight: sanitizeNumber(input.modelPriorityWeight, base.modelPriorityWeight, {
      min: 0,
      max: 1,
    }),
    unreadBonus: sanitizeNumber(input.unreadBonus, base.unreadBonus, { min: -100, max: 200, round: true }),
    snoozeAgeReduction: sanitizeNumber(input.snoozeAgeReduction, base.snoozeAgeReduction, { min: 0, max: 1 }),
    triageStateAdjustments: sanitizeTriageAdjustments(input.triageStateAdjustments, base.triageStateAdjustments),
    crossLabelRules: sanitizeCrossLabelRules(input.crossLabelRules, base.crossLabelRules),
    idleAge: {
      shortWindowHours: sanitizeNumber(input.idleAge?.shortWindowHours, base.idleAge.shortWindowHours, {
        min: 0,
        max: 72,
        round: true,
      }),
      shortWindowMultiplier: sanitizeNumber(input.idleAge?.shortWindowMultiplier, base.idleAge.shortWindowMultiplier, {
        min: 0,
      }),
      mediumWindowStartHours: sanitizeNumber(
        input.idleAge?.mediumWindowStartHours,
        base.idleAge.mediumWindowStartHours,
        { min: 0, max: 72, round: true }
      ),
      mediumWindowEndHours: sanitizeNumber(input.idleAge?.mediumWindowEndHours, base.idleAge.mediumWindowEndHours, {
        min: 1,
        max: 168,
        round: true,
      }),
      mediumWindowBase: sanitizeNumber(input.idleAge?.mediumWindowBase, base.idleAge.mediumWindowBase, {
        min: 0,
        max: 200,
        round: true,
      }),
      mediumWindowMultiplier: sanitizeNumber(
        input.idleAge?.mediumWindowMultiplier,
        base.idleAge.mediumWindowMultiplier,
        { min: 0 }
      ),
      longWindowStartHours: sanitizeNumber(input.idleAge?.longWindowStartHours, base.idleAge.longWindowStartHours, {
        min: 0,
        max: 720,
        round: true,
      }),
      longWindowBase: sanitizeNumber(input.idleAge?.longWindowBase, base.idleAge.longWindowBase, {
        min: 0,
        max: 400,
        round: true,
      }),
      longWindowMultiplier: sanitizeNumber(input.idleAge?.longWindowMultiplier, base.idleAge.longWindowMultiplier, {
        min: 0,
      }),
      longWindowMaxBonus: sanitizeNumber(input.idleAge?.longWindowMaxBonus, base.idleAge.longWindowMaxBonus, {
        min: 0,
        max: 400,
        round: true,
      }),
    },
  } satisfies PriorityEmailConfig;
}

function sanitizeTimeConfig(input: PriorityConfigInput["time"], base: PriorityTimeConfig): PriorityTimeConfig {
  if (!input) {
    return clone(base);
  }
  return {
    upcomingBaseScore: sanitizeNumber(input.upcomingBaseScore, base.upcomingBaseScore, { min: 0, max: 200, round: true }),
    upcomingDecayPerDay: sanitizeNumber(input.upcomingDecayPerDay, base.upcomingDecayPerDay, { min: 0, max: 50, round: true }),
    overdueBasePenalty: sanitizeNumber(input.overdueBasePenalty, base.overdueBasePenalty, { min: 0, max: 200, round: true }),
    overduePenaltyPerDay: sanitizeNumber(input.overduePenaltyPerDay, base.overduePenaltyPerDay, {
      min: 0,
      max: 100,
      round: true,
    }),
    overdueMaxPenalty: sanitizeNumber(input.overdueMaxPenalty, base.overdueMaxPenalty, { min: 0, max: 400, round: true }),
  } satisfies PriorityTimeConfig;
}

function sanitizeTaskConfig(input: PriorityConfigInput["tasks"], base: PriorityTaskConfig): PriorityTaskConfig {
  if (!input) {
    return clone(base);
  }
  return {
    noDueDateValue: sanitizeNumber(input.noDueDateValue, base.noDueDateValue, { min: 0, max: 100, round: true }),
    manualPriorityWeight: sanitizeNumber(input.manualPriorityWeight, base.manualPriorityWeight, { min: 0, max: 1 }),
    statusBoosts: {
      ...base.statusBoosts,
      ...Object.fromEntries(
        Object.entries(input.statusBoosts ?? {}).map(([key, value]) => [
          key,
          sanitizeNumber(value, base.statusBoosts[key as keyof PriorityTaskConfig["statusBoosts"]] ?? 0, {
            min: -100,
            max: 200,
            round: true,
          }),
        ])
      ),
    },
  } satisfies PriorityTaskConfig;
}

function sanitizeTimelineConfig(input: PriorityConfigInput["timeline"], base: PriorityTimelineConfig): PriorityTimelineConfig {
  if (!input) {
    return clone(base);
  }
  return {
    undatedValue: sanitizeNumber(input.undatedValue, base.undatedValue, { min: 0, max: 100, round: true }),
    manualPriorityWeight: sanitizeNumber(input.manualPriorityWeight, base.manualPriorityWeight, { min: 0, max: 1 }),
    conflictPenalties: {
      ...base.conflictPenalties,
      ...Object.fromEntries(
        Object.entries(input.conflictPenalties ?? {}).map(([key, value]) => [
          key,
          sanitizeNumber(value, base.conflictPenalties[key as keyof PriorityTimelineConfig["conflictPenalties"]] ?? 0, {
            min: 0,
            max: 200,
            round: true,
          }),
        ])
      ),
    } as PriorityTimelineConfig["conflictPenalties"],
    dependencyPenalties: {
      finishToStart: sanitizeNumber(
        input.dependencyPenalties?.finishToStart,
        base.dependencyPenalties.finishToStart,
        { min: 0, max: 200, round: true }
      ),
      other: sanitizeNumber(input.dependencyPenalties?.other, base.dependencyPenalties.other, {
        min: 0,
        max: 200,
        round: true,
      }),
    },
  } satisfies PriorityTimelineConfig;
}

function sanitizeHealthConfig(input: PriorityConfigInput["health"], base: PriorityHealthConfig): PriorityHealthConfig {
  if (!input) {
    return clone(base);
  }
  return {
    baseScore: sanitizeNumber(input.baseScore, base.baseScore, { min: 0, max: 200, round: true }),
    minScore: sanitizeNumber(input.minScore, base.minScore, { min: 0, max: 200, round: true }),
    maxScore: sanitizeNumber(input.maxScore, base.maxScore, { min: 0, max: 200, round: true }),
    openTaskPenaltyPerItem: sanitizeNumber(
      input.openTaskPenaltyPerItem,
      base.openTaskPenaltyPerItem,
      { min: 0, max: 100, round: true }
    ),
    openTaskPenaltyCap: sanitizeNumber(input.openTaskPenaltyCap, base.openTaskPenaltyCap, { min: 0, max: 400, round: true }),
    conflictPenaltyPerItem: sanitizeNumber(
      input.conflictPenaltyPerItem,
      base.conflictPenaltyPerItem,
      { min: 0, max: 100, round: true }
    ),
    conflictPenaltyCap: sanitizeNumber(input.conflictPenaltyCap, base.conflictPenaltyCap, { min: 0, max: 400, round: true }),
    linkedEmailPenaltyPerItem: sanitizeNumber(
      input.linkedEmailPenaltyPerItem,
      base.linkedEmailPenaltyPerItem,
      { min: 0, max: 100, round: true }
    ),
    linkedEmailPenaltyCap: sanitizeNumber(
      input.linkedEmailPenaltyCap,
      base.linkedEmailPenaltyCap,
      { min: 0, max: 400, round: true }
    ),
  } satisfies PriorityHealthConfig;
}

export function clonePriorityConfig(base: PriorityConfig = DEFAULT_PRIORITY_CONFIG): PriorityConfig {
  return clone(base);
}

export function normalizePriorityConfigInput(
  input: PriorityConfigInput,
  base: PriorityConfig = DEFAULT_PRIORITY_CONFIG
): PriorityConfig {
  const workingBase = clonePriorityConfig(base);
  if (!input || typeof input !== "object") {
    return workingBase;
  }

  const configInput = input as PriorityConfigInput;
  return {
    time: sanitizeTimeConfig(configInput.time, workingBase.time),
    email: sanitizeEmailConfig(configInput.email, workingBase.email),
    tasks: sanitizeTaskConfig(configInput.tasks, workingBase.tasks),
    timeline: sanitizeTimelineConfig(configInput.timeline, workingBase.timeline),
    health: sanitizeHealthConfig(configInput.health, workingBase.health),
  } satisfies PriorityConfig;
}

function sortObject<T>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item)) as unknown as T;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const sorted: Record<string, unknown> = {};
  for (const [key, val] of entries) {
    sorted[key] = sortObject(val);
  }
  return sorted as unknown as T;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

export function isPriorityConfigEqual(a: PriorityConfig, b: PriorityConfig): boolean {
  return stableSerialize(a) === stableSerialize(b);
}

export function getPriorityConfig(input?: PriorityConfigInput | null): PriorityConfig {
  if (!input) {
    return DEFAULT_PRIORITY_CONFIG;
  }
  return normalizePriorityConfigInput(input);
}
