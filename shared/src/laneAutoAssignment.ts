import type { TimelineLaneDefinition } from "./types";

export interface LaneAutoAssignContext {
  type?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  category?: string | null;
  priority?: number | null;
  labels?: Record<string, unknown> | null;
  [key: string]: unknown;
}

type ConditionNode = {
  all?: ConditionNode[];
  any?: ConditionNode[];
  none?: ConditionNode[];
  field?: string;
  operator?: string;
  value?: unknown;
};

type RuleNode = ConditionNode | Record<string, unknown> | null | undefined;

function isConditionNode(value: unknown): value is ConditionNode {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ConditionNode;
  return (
    Array.isArray(candidate.all) ||
    Array.isArray(candidate.any) ||
    Array.isArray(candidate.none) ||
    (typeof candidate.field === "string" && typeof candidate.operator === "string")
  );
}

function getFieldValue(context: Record<string, unknown>, fieldPath: string): unknown {
  const segments = fieldPath.split(".").map((segment) => segment.trim()).filter(Boolean);
  let value: unknown = context;
  for (const segment of segments) {
    if (value == null || typeof value !== "object") {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function compareValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    const targetSet = new Set(expected.map((entry) => normaliseValue(entry)));
    if (Array.isArray(actual)) {
      return actual.map((entry) => normaliseValue(entry)).some((entry) => targetSet.has(entry));
    }
    return targetSet.has(normaliseValue(actual));
  }

  if (typeof expected === "string") {
    const expectedValue = expected.trim().toLowerCase();
    if (Array.isArray(actual)) {
      return actual.some((entry) => normaliseValue(entry) === expectedValue);
    }
    return normaliseValue(actual) === expectedValue;
  }

  if (typeof expected === "number") {
    const actualNumber = typeof actual === "number" ? actual : Number(actual);
    return Number.isFinite(actualNumber) && actualNumber === expected;
  }

  if (typeof expected === "boolean") {
    return Boolean(actual) === expected;
  }

  if (expected == null) {
    return actual == null;
  }

  if (typeof expected === "object") {
    if (isConditionNode(expected)) {
      return evaluateCondition(expected as ConditionNode, {});
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  return actual === expected;
}

function normaliseValue(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function evaluateOperator(value: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case "eq":
    case "equals":
      return compareValue(value, expected);
    case "ne":
    case "not_equals":
      return !compareValue(value, expected);
    case "contains": {
      if (typeof value !== "string" && !Array.isArray(value)) return false;
      if (Array.isArray(value)) {
        return value.some((entry) => normaliseValue(entry).includes(normaliseValue(expected)));
      }
      return normaliseValue(value).includes(normaliseValue(expected));
    }
    case "not_contains": {
      if (typeof value !== "string" && !Array.isArray(value)) return true;
      if (Array.isArray(value)) {
        return !value.some((entry) => normaliseValue(entry).includes(normaliseValue(expected)));
      }
      return !normaliseValue(value).includes(normaliseValue(expected));
    }
    case "gt":
    case "greater_than":
      return Number(value) > Number(expected);
    case "gte":
    case "greater_than_or_equal":
      return Number(value) >= Number(expected);
    case "lt":
    case "less_than":
      return Number(value) < Number(expected);
    case "lte":
    case "less_than_or_equal":
      return Number(value) <= Number(expected);
    case "matches_regex":
      try {
        const regex = new RegExp(String(expected));
        return typeof value === "string" && regex.test(value);
      } catch {
        return false;
      }
    case "in": {
      const list = Array.isArray(expected) ? expected : [expected];
      return list.map(normaliseValue).includes(normaliseValue(value));
    }
    case "not_in": {
      const list = Array.isArray(expected) ? expected : [expected];
      return !list.map(normaliseValue).includes(normaliseValue(value));
    }
    default:
      return compareValue(value, expected);
  }
}

function evaluateCondition(condition: ConditionNode, context: Record<string, unknown>): boolean {
  if (Array.isArray(condition.all) && condition.all.length > 0) {
    return condition.all.every((child) => evaluateCondition(child, context));
  }

  if (Array.isArray(condition.any) && condition.any.length > 0) {
    return condition.any.some((child) => evaluateCondition(child, context));
  }

  if (Array.isArray(condition.none) && condition.none.length > 0) {
    return !condition.none.some((child) => evaluateCondition(child, context));
  }

  if (typeof condition.field === "string" && typeof condition.operator === "string") {
    const actual = getFieldValue(context, condition.field);
    return evaluateOperator(actual, condition.operator, condition.value);
  }

  return false;
}

function evaluateRuleNode(rules: RuleNode, context: Record<string, unknown>): boolean {
  if (!rules) return false;

  if (isConditionNode(rules)) {
    return evaluateCondition(rules, context);
  }

  if (typeof rules !== "object") {
    return false;
  }

  return Object.entries(rules).every(([rawField, rawValue]) => {
    const field = rawField.trim();
    if (!field) return true;

    if (isConditionNode(rawValue)) {
      return evaluateCondition(rawValue, context);
    }

    const actual = getFieldValue(context, field);
    if (Array.isArray(rawValue) || typeof rawValue !== "object" || rawValue == null) {
      return compareValue(actual, rawValue);
    }

    if ("operator" in (rawValue as Record<string, unknown>)) {
      const operator = String((rawValue as Record<string, unknown>).operator ?? "eq");
      const value = (rawValue as Record<string, unknown>).value;
      return evaluateOperator(actual, operator, value);
    }

    return evaluateRuleNode(rawValue as RuleNode, typeof actual === "object" && actual != null ? (actual as Record<string, unknown>) : context);
  });
}

export function resolveAutoAssignedLane(
  lanes: TimelineLaneDefinition[],
  context: LaneAutoAssignContext
): TimelineLaneDefinition | null {
  if (!lanes || lanes.length === 0) {
    return null;
  }

  const sorted = [...lanes].sort((a, b) => {
    const orderA = a.sortOrder ?? 0;
    const orderB = b.sortOrder ?? 0;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.name.localeCompare(b.name);
  });

  const evaluationContext: Record<string, unknown> = {
    ...context,
    labels: context.labels ?? {},
    metadata: context,
  };

  for (const lane of sorted) {
    if (!lane.autoAssignRules || Object.keys(lane.autoAssignRules).length === 0) {
      continue;
    }

    if (evaluateRuleNode(lane.autoAssignRules as RuleNode, evaluationContext)) {
      return lane;
    }
  }

  return null;
}

export function evaluateLaneAssignment(
  lane: TimelineLaneDefinition,
  context: LaneAutoAssignContext
): boolean {
  if (!lane.autoAssignRules || Object.keys(lane.autoAssignRules).length === 0) {
    return false;
  }
  const evaluationContext: Record<string, unknown> = {
    ...context,
    labels: context.labels ?? {},
    metadata: context,
  };
  return evaluateRuleNode(lane.autoAssignRules as RuleNode, evaluationContext);
}
