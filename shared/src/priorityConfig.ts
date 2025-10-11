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

export function getPriorityConfig(_userId?: string): PriorityConfig {
  return DEFAULT_PRIORITY_CONFIG;
}

export function clonePriorityConfig(): PriorityConfig {
  return JSON.parse(JSON.stringify(DEFAULT_PRIORITY_CONFIG)) as PriorityConfig;
}
