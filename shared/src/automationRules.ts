import { PRIMARY_LABEL_DEFINITIONS } from "./types";

export type AutomationTriggerType = "email_received" | "task_created";

export interface AutomationTriggerConfigEmail {
  categories?: string[];
  labels?: string[];
  triageStates?: string[];
}

export interface AutomationTriggerConfigTask {
  statuses?: string[];
  lanes?: string[];
}

export type AutomationTriggerConfig =
  | { type: "email_received"; options: AutomationTriggerConfigEmail }
  | { type: "task_created"; options: AutomationTriggerConfigTask };

export type AutomationConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "less_than";

export interface AutomationCondition {
  field: string;
  operator: AutomationConditionOperator;
  value: string | number | boolean;
}

export interface AutomationConditionGroup {
  logic: "and" | "or";
  conditions: AutomationCondition[];
}

export type AutomationActionType =
  | "create_task"
  | "assign_timeline_lane"
  | "send_email_template";

export interface AutomationAction {
  type: AutomationActionType;
  params: Record<string, unknown>;
}

export interface AutomationRuleInput {
  id?: string;
  name?: unknown;
  description?: unknown;
  isEnabled?: unknown;
  trigger?: Partial<AutomationTriggerConfig> | null;
  conditions?: Partial<AutomationConditionGroup> | null;
  actions?: Array<Partial<AutomationAction>> | null;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  trigger: AutomationTriggerConfig;
  conditions: AutomationConditionGroup;
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
}

export const EMAIL_CATEGORY_OPTIONS = PRIMARY_LABEL_DEFINITIONS.map((definition) => definition.name);

const DEFAULT_TRIGGER: AutomationTriggerConfig = {
  type: "email_received",
  options: {
    categories: EMAIL_CATEGORY_OPTIONS.slice(0, 4),
    labels: [],
    triageStates: ["unassigned"],
  },
};

const DEFAULT_CONDITION_GROUP: AutomationConditionGroup = {
  logic: "and",
  conditions: [],
};

const DEFAULT_ACTION: AutomationAction = {
  type: "create_task",
  params: {
    title: "Follow up",
  },
};

function ensureString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

function ensureBoolean(value: unknown, fallback = false): boolean {
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

function ensureStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function ensureTrigger(input: Partial<AutomationTriggerConfig> | null | undefined): AutomationTriggerConfig {
  if (!input || typeof input !== "object") {
    return DEFAULT_TRIGGER;
  }

  if (input.type === "task_created") {
    const options = input.options as AutomationTriggerConfigTask | undefined;
    return {
      type: "task_created",
      options: {
        statuses: ensureStringArray(options?.statuses),
        lanes: ensureStringArray(options?.lanes),
      },
    } satisfies AutomationTriggerConfig;
  }

  const options = input.options as AutomationTriggerConfigEmail | undefined;
  return {
    type: "email_received",
    options: {
      categories: ensureStringArray(options?.categories),
      labels: ensureStringArray(options?.labels),
      triageStates: ensureStringArray(options?.triageStates),
    },
  } satisfies AutomationTriggerConfig;
}

function ensureCondition(condition: Partial<AutomationCondition>): AutomationCondition {
  return {
    field: ensureString(condition.field, "email.category"),
    operator: ((): AutomationConditionOperator => {
      switch (condition.operator) {
        case "equals":
        case "not_equals":
        case "contains":
        case "not_contains":
        case "greater_than":
        case "less_than":
          return condition.operator;
        default:
          return "equals";
      }
    })(),
    value: condition.value ?? "",
  } satisfies AutomationCondition;
}

function ensureConditions(input: Partial<AutomationConditionGroup> | null | undefined): AutomationConditionGroup {
  if (!input || typeof input !== "object") {
    return DEFAULT_CONDITION_GROUP;
  }

  const logic = input.logic === "or" ? "or" : "and";
  const conditions = Array.isArray(input.conditions)
    ? input.conditions.map((condition) => ensureCondition(condition))
    : [];

  return { logic, conditions } satisfies AutomationConditionGroup;
}

function ensureAction(action: Partial<AutomationAction>): AutomationAction {
  const type: AutomationActionType = ((): AutomationActionType => {
    switch (action.type) {
      case "create_task":
      case "assign_timeline_lane":
      case "send_email_template":
        return action.type;
      default:
        return "create_task";
    }
  })();

  const params = action.params && typeof action.params === "object" ? action.params : {};

  return { type, params } satisfies AutomationAction;
}

function ensureActions(actions: Array<Partial<AutomationAction>> | null | undefined): AutomationAction[] {
  if (!Array.isArray(actions) || actions.length === 0) {
    return [DEFAULT_ACTION];
  }
  return actions.map((action) => ensureAction(action));
}

export function normalizeAutomationRuleInput(
  input: AutomationRuleInput,
  defaults?: Partial<AutomationRule>
): AutomationRule {
  const nowIso = new Date().toISOString();

  return {
    id: ensureString(input.id, defaults?.id || "temp"),
    name: ensureString(input.name, defaults?.name || "Untitled rule"),
    description: ((): string | null => {
      const raw = input.description;
      if (raw == null) return defaults?.description ?? null;
      if (typeof raw === "string") return raw;
      return defaults?.description ?? null;
    })(),
    isEnabled: ensureBoolean(input.isEnabled, defaults?.isEnabled ?? true),
    trigger: ensureTrigger(input.trigger ?? defaults?.trigger ?? null),
    conditions: ensureConditions(input.conditions ?? defaults?.conditions ?? null),
    actions: ensureActions(input.actions ?? defaults?.actions ?? null),
    createdAt: defaults?.createdAt ?? nowIso,
    updatedAt: nowIso,
  } satisfies AutomationRule;
}

export function createEmptyAutomationRule(): AutomationRule {
  const nowIso = new Date().toISOString();
  return {
    id: "temp",
    name: "Untitled rule",
    description: null,
    isEnabled: true,
    trigger: ensureTrigger(DEFAULT_TRIGGER),
    conditions: ensureConditions(DEFAULT_CONDITION_GROUP),
    actions: ensureActions([DEFAULT_ACTION]),
    createdAt: nowIso,
    updatedAt: nowIso,
  } satisfies AutomationRule;
}

