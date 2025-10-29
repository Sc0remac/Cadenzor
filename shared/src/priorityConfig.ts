import type {
  EmailTriageState,
  PriorityEmailActionRule,
  PriorityEmailAdvancedBoost,
  PriorityExplainabilityConfig,
  PrioritySchedulingConfig,
} from "./types";

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
  advancedBoosts: PriorityEmailAdvancedBoost[];
  actionRules: PriorityEmailActionRule[];
  explainability: PriorityExplainabilityConfig;
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
  scheduling: PrioritySchedulingConfig;
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
    advancedBoosts?: Array<Partial<PriorityEmailAdvancedBoost>> | null;
    actionRules?: Array<Partial<PriorityEmailActionRule>> | null;
    explainability?: Partial<PriorityExplainabilityConfig> | null;
  } | null;
  tasks?: Partial<PriorityTaskConfig> | null;
  timeline?: Partial<PriorityTimelineConfig> | null;
  health?: Partial<PriorityHealthConfig> | null;
  scheduling?: Partial<PrioritySchedulingConfig> | null;
} | null;

export type PriorityConfigSource = "default" | "custom";

export interface PriorityConfigPreset {
  slug: string;
  name: string;
  description: string;
  recommendedScenarios: string[];
  adjustments: string[];
  overrides: PriorityConfigInput;
}

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

function sanitizeString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  return fallback;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => {
          if (typeof entry === "string") {
            const trimmed = entry.trim();
            return trimmed.length > 0 ? trimmed : null;
          }
          if (entry == null) return null;
          const coerced = String(entry).trim();
          return coerced.length > 0 ? coerced : null;
        })
        .filter((entry): entry is string => Boolean(entry))
    )
  );
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
      "LEGAL/Contract_Executed": 35,
      "LEGAL/Contract_Draft": 33,
      "LEGAL/Addendum_or_Amendment": 32,
      "LEGAL/NDA_or_Clearance": 30,
      "LEGAL/Insurance_Indemnity": 30,
      "LEGAL/Compliance": 29,
      "FINANCE/Settlement": 34,
      "FINANCE/Invoice": 32,
      "FINANCE/Payment_Remittance": 27,
      "FINANCE/Banking_Details": 35,
      "FINANCE/Tax_Docs": 30,
      "FINANCE/Expenses_Receipts": 25,
      "FINANCE/Royalties_Publishing": 24,
      "LOGISTICS/Itinerary_DaySheet": 31,
      "LOGISTICS/Travel": 33,
      "LOGISTICS/Accommodation": 29,
      "LOGISTICS/Ground_Transport": 28,
      "LOGISTICS/Visas_Immigration": 35,
      "LOGISTICS/Technical_Advance": 30,
      "LOGISTICS/Passes_Access": 27,
      "BOOKING/Offer": 32,
      "BOOKING/Hold_or_Availability": 27,
      "BOOKING/Confirmation": 33,
      "BOOKING/Reschedule_or_Cancel": 35,
      "PROMO/Promo_Time_Request": 29,
      "PROMO/Press_Feature": 23,
      "PROMO/Radio_Playlist": 23,
      "PROMO/Deliverables": 28,
      "PROMO/Promos_Submission": 20,
      "ASSETS/Artwork": 22,
      "ASSETS/Audio": 26,
      "ASSETS/Video": 24,
      "ASSETS/Photos": 20,
      "ASSETS/Logos_Brand": 21,
      "ASSETS/EPK_OneSheet": 22,
      "FAN/Support_or_Thanks": 11,
      "FAN/Request": 13,
      "FAN/Issues_or_Safety": 27,
      "MISC/Uncategorized": 10,
    },
    defaultCategoryWeight: 18,
    modelPriorityWeight: 0.6,
    unreadBonus: 8,
    snoozeAgeReduction: 0.65,
    triageStateAdjustments: {
      unassigned: 5,
      acknowledged: -3,
      snoozed: -10,
      resolved: -30,
    },
    crossLabelRules: [
      {
        prefix: "approval/",
        weight: 10,
        description: "Pending approval",
        caseInsensitive: true,
      },
      {
        prefix: "risk/",
        weight: 10,
        description: "Risk flagged",
        caseInsensitive: true,
      },
      {
        prefix: "status/escalated",
        weight: 8,
        description: "Escalated thread",
        caseInsensitive: true,
      },
      {
        prefix: "status/pending_reply",
        weight: 6,
        description: "Awaiting reply",
        caseInsensitive: true,
      },
    ],
    idleAge: {
      shortWindowHours: 4,
      shortWindowMultiplier: 2,
      mediumWindowStartHours: 4,
      mediumWindowEndHours: 24,
      mediumWindowBase: 6,
      mediumWindowMultiplier: 0.9,
      longWindowStartHours: 24,
      longWindowBase: 16,
      longWindowMultiplier: 0.6,
      longWindowMaxBonus: 12,
    },
    advancedBoosts: [
      {
        id: "vip-senders",
        label: "VIP senders",
        description: "Boost key agents and partners for immediate follow-up.",
        weight: 5,
        criteria: {
          senders: ["oran@kazador.io", "agent@kazadoragency.com"],
        },
        explanation: "Designated VIP senders",
      },
      {
        id: "attachment-alert",
        label: "Attachments included",
        description: "Attachments often contain contracts or assets that need review.",
        weight: 3,
        criteria: {
          hasAttachment: true,
        },
        explanation: "Attachments present",
      },
    ],
    actionRules: [
      {
        id: "booking-playbook",
        label: "Run booking playbook",
        description: "Kick off the booking workflow when high-priority offers arrive.",
        actionType: "playbook",
        categories: ["BOOKING/Offer"],
        triageStates: ["unassigned", "acknowledged"],
        minPriority: 70,
        icon: "Ticket",
        color: "#2563eb",
        payload: {
          playbook: "booking-enquiry",
        },
      },
      {
        id: "legal-review",
        label: "Request legal review",
        description: "Send for legal review when contracts hit the inbox.",
        actionType: "create_lead",
        categories: ["LEGAL/Contract_Draft", "LEGAL/Contract_Executed"],
        triageStates: ["unassigned"],
        minPriority: 60,
        icon: "Scale",
        color: "#7c3aed",
        payload: {
          queue: "legal",
        },
      },
    ],
    explainability: {
      showBreakdown: true,
      auditLog: true,
      includeComponentMetadata: true,
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
  scheduling: {
    timezone: "UTC",
    entries: [],
    lastEvaluatedAt: null,
  },
};

deepFreeze(PRIORITY_CONFIG_DATA);

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = PRIORITY_CONFIG_DATA;

const PRIORITY_CONFIG_PRESETS_DATA: PriorityConfigPreset[] = [
  {
    slug: "release-week",
    name: "Release Week",
    description: "Elevate promo deliverables and creative approvals leading into a release.",
    recommendedScenarios: ["Album or single launch", "Heavy press cycle"],
    adjustments: [
      "+5 PROMO/Deliverables",
      "+6 PROMO/Promo_Time_Request",
      "+6 ASSETS/Audio",
      "+6 ASSETS/Video",
      "+3 unread inbox bonus",
    ],
    overrides: {
      email: {
        categoryWeights: {
          "PROMO/Deliverables": 33,
          "PROMO/Promo_Time_Request": 35,
          "PROMO/Press_Feature": 28,
          "PROMO/Radio_Playlist": 27,
          "ASSETS/Audio": 32,
          "ASSETS/Video": 30,
          "ASSETS/Artwork": 27,
        },
        unreadBonus: 11,
      },
      timeline: {
        manualPriorityWeight: 0.3,
      },
    },
  },
  {
    slug: "touring-season",
    name: "Touring Season",
    description: "Prioritise logistics, travel, and show confirmations while on the road.",
    recommendedScenarios: ["Active tour routing", "Festival runs"],
    adjustments: [
      "Faster upcoming decay",
      "Stronger overdue penalty",
      "Logistics categories boosted to 32-35",
      "Higher conflict penalties",
    ],
    overrides: {
      time: {
        upcomingDecayPerDay: 6,
        overduePenaltyPerDay: 8,
      },
      email: {
        categoryWeights: {
          "LOGISTICS/Itinerary_DaySheet": 33,
          "LOGISTICS/Travel": 35,
          "LOGISTICS/Accommodation": 32,
          "LOGISTICS/Ground_Transport": 31,
          "LOGISTICS/Visas_Immigration": 35,
          "LOGISTICS/Technical_Advance": 33,
          "LOGISTICS/Passes_Access": 30,
          "BOOKING/Confirmation": 34,
          "BOOKING/Reschedule_or_Cancel": 35,
        },
      },
      timeline: {
        conflictPenalties: {
          default: 20,
          warning: 20,
          error: 32,
        },
        dependencyPenalties: {
          finishToStart: 16,
          other: 10,
        },
      },
    },
  },
  {
    slug: "off-season",
    name: "Off Season",
    description: "Dial priorities back to a balanced baseline for planning periods.",
    recommendedScenarios: ["Post-tour recovery", "Admin catch-up weeks"],
    adjustments: [
      "Lower unread inbox bonus",
      "Moderate promo + assets weights",
      "Reduced conflict penalties",
      "Higher manual task influence",
    ],
    overrides: {
      email: {
        unreadBonus: 6,
        modelPriorityWeight: 0.5,
        categoryWeights: {
          "PROMO/Promo_Time_Request": 26,
          "PROMO/Deliverables": 25,
          "ASSETS/Audio": 23,
          "ASSETS/Video": 22,
          "ASSETS/Artwork": 20,
          "FAN/Support_or_Thanks": 12,
        },
      },
      time: {
        upcomingDecayPerDay: 3,
        overduePenaltyPerDay: 5,
      },
      timeline: {
        conflictPenalties: {
          default: 12,
          warning: 10,
          error: 18,
        },
      },
      tasks: {
        manualPriorityWeight: 0.35,
        noDueDateValue: 18,
      },
    },
  },
  {
    slug: "legal-focus",
    name: "Legal Focus",
    description: "Elevate contract, compliance, and settlement threads to the top.",
    recommendedScenarios: ["Contract negotiation sprints", "Major deal review"],
    adjustments: [
      "LEGAL categories boosted to 32-35",
      "FINANCE/Settlement to 35",
      "Higher AI weighting",
      "Greater manual priority blend",
    ],
    overrides: {
      email: {
        modelPriorityWeight: 0.65,
        categoryWeights: {
          "LEGAL/Contract_Executed": 35,
          "LEGAL/Contract_Draft": 35,
          "LEGAL/Addendum_or_Amendment": 34,
          "LEGAL/NDA_or_Clearance": 33,
          "LEGAL/Insurance_Indemnity": 32,
          "LEGAL/Compliance": 32,
          "FINANCE/Settlement": 35,
          "FINANCE/Invoice": 33,
        },
      },
      tasks: {
        manualPriorityWeight: 0.4,
      },
      timeline: {
        manualPriorityWeight: 0.32,
      },
    },
  },
];

deepFreeze(PRIORITY_CONFIG_PRESETS_DATA);

export const PRIORITY_CONFIG_PRESETS: readonly PriorityConfigPreset[] = PRIORITY_CONFIG_PRESETS_DATA;

export function listPriorityConfigPresets(): PriorityConfigPreset[] {
  return PRIORITY_CONFIG_PRESETS.map((preset) => ({
    ...preset,
    recommendedScenarios: [...preset.recommendedScenarios],
    adjustments: [...preset.adjustments],
    overrides: clone(preset.overrides),
  }));
}

export function getPriorityConfigPreset(slug: string): PriorityConfigPreset | null {
  if (!slug) {
    return null;
  }
  const normalized = slug.trim().toLowerCase();
  const preset = PRIORITY_CONFIG_PRESETS.find((entry) => entry.slug === normalized);
  if (!preset) {
    return null;
  }
  return {
    ...preset,
    recommendedScenarios: [...preset.recommendedScenarios],
    adjustments: [...preset.adjustments],
    overrides: clone(preset.overrides),
  };
}

export function applyPriorityConfigPreset(
  preset: PriorityConfigPreset | string,
  base: PriorityConfig = DEFAULT_PRIORITY_CONFIG
): PriorityConfig {
  const presetData =
    typeof preset === "string" ? getPriorityConfigPreset(preset) : preset;
  if (!presetData) {
    throw new Error(`Unknown priority config preset: ${String(preset)}`);
  }
  return normalizePriorityConfigInput(presetData.overrides, base);
}

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

const TRIAGE_STATES: EmailTriageState[] = ["unassigned", "acknowledged", "snoozed", "resolved"];

function sanitizeAdvancedBoosts(
  boosts: Array<Partial<PriorityEmailAdvancedBoost>> | null | undefined,
  base: PriorityEmailAdvancedBoost[]
): PriorityEmailAdvancedBoost[] {
  const source = Array.isArray(boosts) ? boosts : [];
  if (source.length === 0) {
    return base.map((boost) => clone(boost));
  }

  return source.map((candidate, index) => {
    const fallback = base[index] ?? base[0];
    const id = sanitizeString(candidate?.id, fallback?.id ?? `boost-${index}`);
    const label = sanitizeString(candidate?.label, fallback?.label ?? "Custom boost");
    const description = sanitizeString(candidate?.description, fallback?.description ?? "");
    const weight = sanitizeNumber(candidate?.weight, fallback?.weight ?? 0, {
      min: -100,
      max: 200,
      round: true,
    });
    const criteria = candidate?.criteria && typeof candidate.criteria === "object" ? candidate.criteria : {};

    const hasAttachmentRaw = (criteria as any).hasAttachment;
    let hasAttachment: boolean | null = null;
    if (hasAttachmentRaw === true || hasAttachmentRaw === false) {
      hasAttachment = hasAttachmentRaw;
    } else if (typeof hasAttachmentRaw === "string") {
      const normalized = hasAttachmentRaw.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") hasAttachment = true;
      if (normalized === "false" || normalized === "0") hasAttachment = false;
    }

    const minPriorityRaw = (criteria as any).minPriority;
    const minPriorityValue = sanitizeNumber(
      minPriorityRaw,
      fallback?.criteria?.minPriority ?? 0,
      {
        min: 0,
        max: 100,
        round: true,
      }
    );

    return {
      id,
      label,
      description: description || null,
      weight,
      criteria: {
        senders: sanitizeStringArray((criteria as any).senders ?? fallback?.criteria?.senders ?? []),
        domains: sanitizeStringArray((criteria as any).domains ?? fallback?.criteria?.domains ?? []),
        keywords: sanitizeStringArray((criteria as any).keywords ?? fallback?.criteria?.keywords ?? []),
        labels: sanitizeStringArray((criteria as any).labels ?? fallback?.criteria?.labels ?? []),
        categories: sanitizeStringArray((criteria as any).categories ?? fallback?.criteria?.categories ?? []),
        hasAttachment,
        minPriority:
          minPriorityRaw == null && fallback?.criteria?.minPriority == null ? null : minPriorityValue,
      },
      explanation: sanitizeString(candidate?.explanation, fallback?.explanation ?? "") || null,
    } satisfies PriorityEmailAdvancedBoost;
  });
}

function sanitizeActionRules(
  rules: Array<Partial<PriorityEmailActionRule>> | null | undefined,
  base: PriorityEmailActionRule[]
): PriorityEmailActionRule[] {
  const source = Array.isArray(rules) ? rules : [];
  if (source.length === 0) {
    return base.map((rule) => clone(rule));
  }

  return source.map((candidate, index) => {
    const fallback = base[index] ?? base[0];
    const id = sanitizeString(candidate?.id, fallback?.id ?? `action-${index}`);
    const label = sanitizeString(candidate?.label, fallback?.label ?? "Custom action");
    const description = sanitizeString(candidate?.description, fallback?.description ?? "");
    const actionType = ((): PriorityEmailActionRule["actionType"] => {
      switch (candidate?.actionType) {
        case "playbook":
        case "create_lead":
        case "open_url":
        case "custom":
          return candidate.actionType;
        default:
          return fallback?.actionType ?? "playbook";
      }
    })();
    const triageStates = Array.isArray(candidate?.triageStates)
      ? candidate.triageStates.filter((state): state is EmailTriageState => TRIAGE_STATES.includes(state as EmailTriageState))
      : fallback?.triageStates ?? [];
    const minPriority = sanitizeNumber(candidate?.minPriority, fallback?.minPriority ?? 0, {
      min: 0,
      max: 100,
      round: true,
    });

    return {
      id,
      label,
      description: description || null,
      actionType,
      categories: sanitizeStringArray(candidate?.categories ?? fallback?.categories ?? []),
      triageStates,
      minPriority,
      icon: sanitizeString(candidate?.icon, fallback?.icon ?? "") || null,
      color: sanitizeString(candidate?.color, fallback?.color ?? "") || null,
      payload: (() => {
        if (candidate?.payload && typeof candidate.payload === "object") {
          return { ...candidate.payload };
        }
        if (fallback?.payload && typeof fallback.payload === "object") {
          return { ...fallback.payload };
        }
        return null;
      })(),
    } satisfies PriorityEmailActionRule;
  });
}

function sanitizeExplainability(
  input: Partial<PriorityExplainabilityConfig> | null | undefined,
  base: PriorityExplainabilityConfig
): PriorityExplainabilityConfig {
  if (!input || typeof input !== "object") {
    return clone(base);
  }
  return {
    showBreakdown: sanitizeBoolean(input.showBreakdown, base.showBreakdown),
    auditLog: sanitizeBoolean(input.auditLog, base.auditLog),
    includeComponentMetadata: sanitizeBoolean(
      input.includeComponentMetadata,
      base.includeComponentMetadata
    ),
  } satisfies PriorityExplainabilityConfig;
}

function sanitizeSchedulingConfig(
  input: Partial<PrioritySchedulingConfig> | null | undefined,
  base: PrioritySchedulingConfig
): PrioritySchedulingConfig {
  if (!input || typeof input !== "object") {
    return clone(base);
  }

  const entries = Array.isArray(input.entries)
    ? input.entries.map((entry, index) => {
        const fallback = base.entries[index] ?? base.entries[0];
        const id = sanitizeString(entry?.id, fallback?.id ?? `schedule-${index}`);
        const label = sanitizeString(entry?.label, fallback?.label ?? "Scheduled preset");
        const presetSlug = sanitizeString(entry?.presetSlug, fallback?.presetSlug ?? "");
        const days = Array.isArray(entry?.daysOfWeek)
          ? Array.from(
              new Set(
                entry.daysOfWeek
                  .map((day) => Number(day))
                  .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
              )
            )
          : fallback?.daysOfWeek ?? [];
        const startTime = sanitizeString(entry?.startTime, fallback?.startTime ?? "08:00");
        const endTime = sanitizeString(entry?.endTime, fallback?.endTime ?? "") || null;
        const autoApply = sanitizeBoolean(entry?.autoApply, fallback?.autoApply ?? true);

        return {
          id,
          label,
          presetSlug,
          daysOfWeek: days,
          startTime,
          endTime,
          autoApply,
        };
      })
    : base.entries.map((entry) => clone(entry));

  return {
    timezone: sanitizeString(input.timezone, base.timezone || "UTC"),
    entries,
    lastEvaluatedAt: sanitizeString(input.lastEvaluatedAt, base.lastEvaluatedAt ?? "") || null,
  } satisfies PrioritySchedulingConfig;
}

function sanitizeEmailConfig(
  input: Exclude<PriorityConfigInput, null>["email"],
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
    advancedBoosts: sanitizeAdvancedBoosts(input.advancedBoosts, base.advancedBoosts),
    actionRules: sanitizeActionRules(input.actionRules, base.actionRules),
    explainability: sanitizeExplainability(input.explainability, base.explainability),
  } satisfies PriorityEmailConfig;
}

function sanitizeTimeConfig(input: Exclude<PriorityConfigInput, null>["time"], base: PriorityTimeConfig): PriorityTimeConfig {
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

function sanitizeTaskConfig(input: Exclude<PriorityConfigInput, null>["tasks"], base: PriorityTaskConfig): PriorityTaskConfig {
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

function sanitizeTimelineConfig(input: Exclude<PriorityConfigInput, null>["timeline"], base: PriorityTimelineConfig): PriorityTimelineConfig {
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

function sanitizeHealthConfig(input: Exclude<PriorityConfigInput, null>["health"], base: PriorityHealthConfig): PriorityHealthConfig {
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

  const configInput = input as Exclude<PriorityConfigInput, null>;
  return {
    time: sanitizeTimeConfig(configInput.time, workingBase.time),
    email: sanitizeEmailConfig(configInput.email, workingBase.email),
    tasks: sanitizeTaskConfig(configInput.tasks, workingBase.tasks),
    timeline: sanitizeTimelineConfig(configInput.timeline, workingBase.timeline),
    health: sanitizeHealthConfig(configInput.health, workingBase.health),
    scheduling: sanitizeSchedulingConfig(configInput.scheduling, workingBase.scheduling),
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
