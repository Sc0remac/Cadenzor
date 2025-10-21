import { normaliseLabel } from "./labelUtils";
import type { EmailLabel, EmailRecord, ProjectLinkSource, TimelineItemType } from "./types";

export type ProjectAssignmentRuleConditionField =
  | "subject"
  | "from_name"
  | "from_email"
  | "body"
  | "category"
  | "labels"
  | "has_attachment"
  | "received_at"
  | "priority_score"
  | "triage_state";

export type ProjectAssignmentRuleConditionOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "is_one_of"
  | "before"
  | "after"
  | "within_last_days"
  | "greater_than"
  | "less_than"
  | "between";

export type ProjectAssignmentRuleConfidence = "low" | "medium" | "high";

export interface ProjectAssignmentRuleConditionValueRange {
  min?: number | null;
  max?: number | null;
}

export interface ProjectAssignmentRuleConditionValueRelative {
  days?: number | null;
}

export type ProjectAssignmentRuleConditionValue =
  | string
  | number
  | boolean
  | string[]
  | ProjectAssignmentRuleConditionValueRange
  | ProjectAssignmentRuleConditionValueRelative
  | null;

export interface ProjectAssignmentRuleCondition {
  id: string;
  field: ProjectAssignmentRuleConditionField;
  operator: ProjectAssignmentRuleConditionOperator;
  value: ProjectAssignmentRuleConditionValue;
}

export interface ProjectAssignmentRuleConditionGroup {
  logic: "and" | "or";
  conditions: ProjectAssignmentRuleCondition[];
}

export interface ProjectAssignmentRuleAction {
  projectId: string;
  assignToLaneId?: string | null;
  confidence?: ProjectAssignmentRuleConfidence | null;
  note?: string | null;
  createTimelineItem?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface ProjectAssignmentRuleInput {
  id?: string;
  userId?: string;
  projectId?: string;
  name?: unknown;
  description?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
  conditions?: unknown;
  actions?: unknown;
  metadata?: unknown;
}

export interface ProjectAssignmentRule {
  id: string;
  userId: string;
  projectId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
  conditions: ProjectAssignmentRuleConditionGroup;
  actions: ProjectAssignmentRuleAction;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRuleEmailContext {
  email: Pick<
    EmailRecord,
    | "id"
    | "subject"
    | "fromName"
    | "fromEmail"
    | "category"
    | "labels"
    | "priorityScore"
    | "triageState"
    | "receivedAt"
    | "attachments"
    | "summary"
  > & {
    body?: string | null;
  };
  now?: Date;
}

export interface ProjectAssignmentRuleEvaluationMatch {
  conditionId: string;
  operator: ProjectAssignmentRuleConditionOperator;
  field: ProjectAssignmentRuleConditionField;
  matched: boolean;
}

export interface ProjectAssignmentRuleEvaluationResult {
  matched: boolean;
  matches: ProjectAssignmentRuleEvaluationMatch[];
}

const DEFAULT_CONDITION_GROUP: ProjectAssignmentRuleConditionGroup = {
  logic: "and",
  conditions: [],
};

const DEFAULT_ACTION: ProjectAssignmentRuleAction = {
  projectId: "",
  assignToLaneId: null,
  confidence: "high",
  note: null,
  createTimelineItem: false,
  metadata: {},
};

function ensureString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) return fallback;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function ensureBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalised)) return true;
    if (["false", "0", "no", "n"].includes(normalised)) return false;
  }
  return fallback;
}

function ensureNumber(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => ensureString(item))
    .filter((item) => item.length > 0);
}

function ensureConfidence(value: unknown, fallback: ProjectAssignmentRuleConfidence = "high"): ProjectAssignmentRuleConfidence {
  const normalised = ensureString(value).toLowerCase();
  if (normalised === "low" || normalised === "medium" || normalised === "high") {
    return normalised;
  }
  return fallback;
}

function ensureConditionId(value: unknown, index: number): string {
  const id = ensureString(value);
  if (id.length > 0) return id;
  return `cond-${index}`;
}

function ensureCondition(condition: unknown, index: number): ProjectAssignmentRuleCondition {
  if (!condition || typeof condition !== "object") {
    return {
      id: `cond-${index}`,
      field: "subject",
      operator: "contains",
      value: "",
    };
  }

  const raw = condition as Record<string, unknown>;
  const field = ensureString(raw.field, "subject") as ProjectAssignmentRuleConditionField;

  const operator = ((): ProjectAssignmentRuleConditionOperator => {
    const value = ensureString(raw.operator, "contains");
    switch (value) {
      case "contains":
      case "not_contains":
      case "equals":
      case "not_equals":
      case "starts_with":
      case "ends_with":
      case "is_one_of":
      case "before":
      case "after":
      case "within_last_days":
      case "greater_than":
      case "less_than":
      case "between":
        return value;
      default:
        return "contains";
    }
  })();

  const conditionId = ensureConditionId(raw.id, index);

  let value: ProjectAssignmentRuleConditionValue = null;
  if (operator === "between") {
    value = {
      min: ensureNumber((raw.value as any)?.min),
      max: ensureNumber((raw.value as any)?.max),
    };
  } else if (operator === "within_last_days") {
    value = {
      days: ensureNumber((raw.value as any)?.days ?? raw.value, null),
    };
  } else if (field === "labels") {
    if (operator === "is_one_of") {
      value = ensureStringArray(raw.value);
    } else {
      const arr = Array.isArray(raw.value) ? raw.value : [raw.value];
      value = arr.map((item) => ensureString(item).toLowerCase()).filter(Boolean);
    }
  } else if (
    operator === "contains" ||
    operator === "not_contains" ||
    operator === "starts_with" ||
    operator === "ends_with"
  ) {
    const arr = Array.isArray(raw.value) ? raw.value : [raw.value];
    value = arr.map((item) => ensureString(item)).filter(Boolean);
  } else if (operator === "is_one_of") {
    value = ensureStringArray(raw.value);
  } else if (field === "has_attachment") {
    value = ensureBoolean(raw.value);
  } else if (field === "priority_score") {
    value = ensureNumber(raw.value);
  } else {
    value = ensureString(raw.value);
  }

  return {
    id: conditionId,
    field,
    operator,
    value,
  };
}

function ensureConditionGroup(group: unknown): ProjectAssignmentRuleConditionGroup {
  if (!group || typeof group !== "object") {
    return { ...DEFAULT_CONDITION_GROUP };
  }

  const raw = group as Record<string, unknown>;
  const logic = ensureString(raw.logic, "and").toLowerCase() === "or" ? "or" : "and";
  const conditionsRaw = Array.isArray(raw.conditions) ? raw.conditions : [];
  const conditions = conditionsRaw.map((condition, index) => ensureCondition(condition, index));
  return { logic, conditions };
}

function ensureActions(rawActions: unknown, fallbackProjectId: string): ProjectAssignmentRuleAction {
  if (!rawActions || typeof rawActions !== "object") {
    return { ...DEFAULT_ACTION, projectId: fallbackProjectId };
  }

  const params = rawActions as Record<string, unknown>;
  const projectId = ensureString(params.projectId, fallbackProjectId);
  return {
    projectId,
    assignToLaneId: ensureString(params.assignToLaneId ?? params.laneId ?? params.assignToLane, "") || null,
    confidence: ensureConfidence(params.confidence),
    note: ensureString(params.note ?? "", "") || null,
    createTimelineItem: ensureBoolean(params.createTimelineItem, false),
    metadata:
      params.metadata && typeof params.metadata === "object"
        ? (params.metadata as Record<string, unknown>)
        : {},
  };
}

function ensureMetadata(rawMetadata: unknown): Record<string, unknown> {
  if (!rawMetadata || typeof rawMetadata !== "object") {
    return {};
  }
  return { ...(rawMetadata as Record<string, unknown>) };
}

export function normalizeProjectAssignmentRuleInput(
  input: ProjectAssignmentRuleInput,
  defaults?: Partial<ProjectAssignmentRule>
): ProjectAssignmentRule {
  const nowIso = new Date().toISOString();
  const fallbackProjectId = ensureString(input.projectId ?? defaults?.projectId ?? "");

  const conditions = ensureConditionGroup(input.conditions ?? defaults?.conditions ?? DEFAULT_CONDITION_GROUP);
  const actions = ensureActions(input.actions ?? defaults?.actions ?? DEFAULT_ACTION, fallbackProjectId);

  const projectId = actions.projectId || fallbackProjectId;

  return {
    id: ensureString(input.id ?? defaults?.id ?? "temp"),
    userId: ensureString(input.userId ?? defaults?.userId ?? "temp-user"),
    projectId,
    name: ensureString(input.name, defaults?.name ?? "Untitled rule") || "Untitled rule",
    description: ((): string | null => {
      const raw = input.description ?? defaults?.description ?? null;
      if (raw == null) return null;
      const text = ensureString(raw);
      return text.length > 0 ? text : null;
    })(),
    enabled: ensureBoolean(input.enabled ?? defaults?.enabled ?? true, defaults?.enabled ?? true),
    sortOrder: ensureNumber(input.sortOrder ?? defaults?.sortOrder ?? 0, 0) ?? 0,
    conditions,
    actions: { ...actions, projectId },
    metadata: ensureMetadata(input.metadata ?? defaults?.metadata ?? {}),
    createdAt: defaults?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

export function createEmptyProjectAssignmentRule(projectId: string, userId: string): ProjectAssignmentRule {
  const nowIso = new Date().toISOString();
  return {
    id: "temp",
    userId,
    projectId,
    name: "Untitled email rule",
    description: null,
    enabled: true,
    sortOrder: 0,
    conditions: { ...DEFAULT_CONDITION_GROUP },
    actions: { ...DEFAULT_ACTION, projectId },
    metadata: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function normaliseEmailLabels(labels: EmailLabel[] | undefined | null): string[] {
  if (!labels || labels.length === 0) {
    return [];
  }
  return labels.map((label) => normaliseLabel(label));
}

function asLowercaseArray(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => item.toLowerCase());
  }
  return [value.toLowerCase()];
}

function evaluateTextCondition(
  target: string,
  operator: ProjectAssignmentRuleConditionOperator,
  rawValue: ProjectAssignmentRuleConditionValue
): boolean {
  const valueList = Array.isArray(rawValue) ? (rawValue as string[]) : [String(rawValue ?? "")];
  const lowerTarget = target.toLowerCase();

  switch (operator) {
    case "contains":
      return valueList.some((term) => lowerTarget.includes(term.toLowerCase()));
    case "not_contains":
      return valueList.every((term) => !lowerTarget.includes(term.toLowerCase()));
    case "starts_with":
      return valueList.some((term) => lowerTarget.startsWith(term.toLowerCase()));
    case "ends_with":
      return valueList.some((term) => lowerTarget.endsWith(term.toLowerCase()));
    case "equals":
      return valueList.some((term) => lowerTarget === term.toLowerCase());
    case "not_equals":
      return valueList.every((term) => lowerTarget !== term.toLowerCase());
    case "is_one_of":
      return valueList.some((term) => lowerTarget === term.toLowerCase());
    default:
      return false;
  }
}

function evaluateLabelsCondition(
  labels: string[],
  operator: ProjectAssignmentRuleConditionOperator,
  rawValue: ProjectAssignmentRuleConditionValue
): boolean {
  const normalisedLabels = labels.map((label) => label.toLowerCase());

  if (operator === "is_one_of") {
    const values = asLowercaseArray(rawValue as string | string[]);
    return values.some((value) => normalisedLabels.includes(value));
  }

  if (operator === "contains") {
    const values = asLowercaseArray(rawValue as string | string[]);
    return values.some((value) => normalisedLabels.some((label) => label.includes(value)));
  }

  if (operator === "not_contains") {
    const values = asLowercaseArray(rawValue as string | string[]);
    return values.every((value) => normalisedLabels.every((label) => !label.includes(value)));
  }

  return false;
}

function evaluateDateCondition(
  receivedAt: string,
  operator: ProjectAssignmentRuleConditionOperator,
  rawValue: ProjectAssignmentRuleConditionValue,
  now: Date
): boolean {
  const received = new Date(receivedAt);
  if (!Number.isFinite(received.getTime())) {
    return false;
  }

  switch (operator) {
    case "before": {
      if (typeof rawValue !== "string") return false;
      const limit = new Date(rawValue);
      if (!Number.isFinite(limit.getTime())) return false;
      return received.getTime() < limit.getTime();
    }
    case "after": {
      if (typeof rawValue !== "string") return false;
      const limit = new Date(rawValue);
      if (!Number.isFinite(limit.getTime())) return false;
      return received.getTime() > limit.getTime();
    }
    case "within_last_days": {
      const days = ensureNumber((rawValue as ProjectAssignmentRuleConditionValueRelative | null)?.days ?? rawValue, null);
      if (days == null || days < 0) return false;
      const diff = now.getTime() - received.getTime();
      const ms = days * 24 * 60 * 60 * 1000;
      return diff >= 0 && diff <= ms;
    }
    default:
      return false;
  }
}

function evaluateNumberCondition(
  target: number | null | undefined,
  operator: ProjectAssignmentRuleConditionOperator,
  rawValue: ProjectAssignmentRuleConditionValue
): boolean {
  if (target == null) return false;

  const numericTarget = Number(target);
  if (!Number.isFinite(numericTarget)) return false;

  switch (operator) {
    case "equals":
      return Number(rawValue) === numericTarget;
    case "greater_than":
      return numericTarget >= Number(rawValue);
    case "less_than":
      return numericTarget <= Number(rawValue);
    case "between": {
      const range = rawValue as ProjectAssignmentRuleConditionValueRange;
      const min = ensureNumber(range?.min);
      const max = ensureNumber(range?.max);
      if (min != null && numericTarget < min) return false;
      if (max != null && numericTarget > max) return false;
      return true;
    }
    default:
      return false;
  }
}

export function evaluateProjectAssignmentRule(
  rule: ProjectAssignmentRule,
  context: ProjectRuleEmailContext
): ProjectAssignmentRuleEvaluationResult {
  const { email } = context;
  const now = context.now ?? new Date();
  const matches: ProjectAssignmentRuleEvaluationMatch[] = [];

  if (!rule.enabled) {
    return { matched: false, matches };
  }

  const { logic, conditions } = rule.conditions;
  if (conditions.length === 0) {
    return { matched: true, matches };
  }

  let overall = logic === "and";

  for (const condition of conditions) {
    const { field, operator, value } = condition;
    let outcome = false;

    switch (field) {
      case "subject":
        outcome = evaluateTextCondition(email.subject ?? "", operator, value);
        break;
      case "from_name":
        outcome = evaluateTextCondition(email.fromName ?? "", operator, value);
        break;
      case "from_email":
        outcome = evaluateTextCondition(email.fromEmail ?? "", operator, value);
        break;
      case "body": {
        const target = email.body ?? email.summary ?? "";
        outcome = evaluateTextCondition(target, operator, value);
        break;
      }
      case "category":
        outcome = evaluateTextCondition(email.category ?? "", operator, value);
        break;
      case "labels": {
        const labels = normaliseEmailLabels(email.labels ?? []);
        outcome = evaluateLabelsCondition(labels, operator, value);
        break;
      }
      case "has_attachment": {
        const hasAttachment = (email.attachments?.length ?? 0) > 0;
        if (typeof value === "boolean") {
          outcome = operator === "equals" ? hasAttachment === value : hasAttachment !== value;
        } else {
          outcome = hasAttachment === ensureBoolean(value);
        }
        break;
      }
      case "received_at":
        outcome = evaluateDateCondition(email.receivedAt, operator, value, now);
        break;
      case "priority_score":
        outcome = evaluateNumberCondition(email.priorityScore ?? null, operator, value);
        break;
      case "triage_state":
        outcome = evaluateTextCondition(email.triageState ?? "", operator, value);
        break;
      default:
        outcome = false;
    }

    matches.push({
      conditionId: condition.id,
      operator,
      field,
      matched: outcome,
    });

    if (logic === "and" && !outcome) {
      overall = false;
      break;
    }
    if (logic === "or" && outcome) {
      overall = true;
      break;
    }
  }

  return { matched: overall, matches };
}

export interface ProjectAssignmentRuleTestResult {
  emailId: string;
  matched: boolean;
  matches: ProjectAssignmentRuleEvaluationMatch[];
}

export function testProjectAssignmentRule(
  rule: ProjectAssignmentRule,
  emails: ProjectRuleEmailContext[]
): ProjectAssignmentRuleTestResult[] {
  return emails.map((context) => {
    const evaluation = evaluateProjectAssignmentRule(rule, context);
    return {
      emailId: context.email.id,
      matched: evaluation.matched,
      matches: evaluation.matches,
    };
  });
}

export function confidenceLevelToScore(level: ProjectAssignmentRuleConfidence | null | undefined): number | null {
  switch (level) {
    case "high":
      return 1;
    case "medium":
      return 0.7;
    case "low":
      return 0.4;
    default:
      return null;
  }
}

export function scoreToConfidenceLevel(score: number | null | undefined): ProjectAssignmentRuleConfidence | null {
  if (score == null) return null;
  if (score >= 0.85) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

const CATEGORY_TYPE_MAP: Array<{ prefix: string; type: TimelineItemType }> = [
  { prefix: "BOOKING", type: "LIVE_HOLD" },
  { prefix: "LEGAL", type: "LEGAL_ACTION" },
  { prefix: "FINANCE", type: "FINANCE_ACTION" },
  { prefix: "PROMO", type: "PROMO_SLOT" },
  { prefix: "LOGISTICS", type: "TRAVEL_SEGMENT" },
];

export function getTimelineTypeForEmailCategory(category: EmailLabel | string | null | undefined): TimelineItemType {
  if (!category) {
    return "TASK";
  }
  const upper = category.toUpperCase();
  for (const mapping of CATEGORY_TYPE_MAP) {
    if (upper.startsWith(mapping.prefix)) {
      return mapping.type;
    }
  }
  return "TASK";
}

export interface ProjectEmailLinkMetadata {
  ruleId?: string;
  ruleName?: string;
  ruleConfidence?: ProjectAssignmentRuleConfidence;
  linkedBy?: string;
  linkedAt?: string;
  note?: string;
  source?: ProjectLinkSource;
  [key: string]: unknown;
}
