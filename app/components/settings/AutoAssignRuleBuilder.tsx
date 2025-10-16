"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ConditionEditor, { describeCondition, getFieldType, normaliseConditionValue } from "./ConditionEditor";
import RulePreview from "./RulePreview";
import { type MatchType, type RuleCondition } from "./ruleTypes";

interface AutoAssignRuleBuilderProps {
  value: Record<string, unknown> | null | undefined;
  onChange: (rules: Record<string, unknown> | null) => void;
  disabled?: boolean;
}

interface ParsedState {
  matchType: MatchType;
  conditions: RuleCondition[];
}

interface ConditionPayload extends Record<string, unknown> {
  field: string;
  operator: string;
  value: RuleCondition["value"];
}

const MATCH_TYPE_OPTIONS: Array<{ value: MatchType; label: string }> = [
  { value: "all", label: "Match ALL conditions (AND)" },
  { value: "any", label: "Match ANY condition (OR)" },
];

function createConditionId() {
  return `cond-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function createEmptyCondition(): RuleCondition {
  return {
    id: createConditionId(),
    field: "",
    operator: "equals",
    value: "",
  };
}

function toRuleCondition(node: Record<string, unknown>): RuleCondition | null {
  const field = typeof node.field === "string" ? node.field : "";
  const operator = typeof node.operator === "string" ? node.operator : "equals";
  const rawValue = node.value ?? null;

  if (!field) {
    return null;
  }

  const condition: RuleCondition = {
    id: createConditionId(),
    field,
    operator,
    value: normaliseConditionValue(field, rawValue as RuleCondition["value"]),
  };

  return condition;
}

function parseRules(raw: Record<string, unknown> | null | undefined): ParsedState {
  if (!raw || Object.keys(raw).length === 0) {
    return { matchType: "all", conditions: [] };
  }

  if (Array.isArray((raw as { all?: unknown[] }).all)) {
    const items = ((raw as { all?: unknown[] }).all ?? [])
      .map((entry) => (entry && typeof entry === "object" ? toRuleCondition(entry as Record<string, unknown>) : null))
      .filter((entry): entry is RuleCondition => Boolean(entry));
    return { matchType: "all", conditions: items };
  }

  if (Array.isArray((raw as { any?: unknown[] }).any)) {
    const items = ((raw as { any?: unknown[] }).any ?? [])
      .map((entry) => (entry && typeof entry === "object" ? toRuleCondition(entry as Record<string, unknown>) : null))
      .filter((entry): entry is RuleCondition => Boolean(entry));
    return { matchType: "any", conditions: items };
  }

  if (typeof (raw as { field?: unknown }).field === "string") {
    const single = toRuleCondition(raw as Record<string, unknown>);
    return { matchType: "all", conditions: single ? [single] : [] };
  }

  const inferredConditions: RuleCondition[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!key) continue;
    if (value == null) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      const candidate = toRuleCondition({ field: key, ...(value as Record<string, unknown>) });
      if (candidate) {
        inferredConditions.push(candidate);
      }
      continue;
    }

    const candidate = toRuleCondition({ field: key, operator: "equals", value });
    if (candidate) {
      inferredConditions.push(candidate);
    }
  }

  return { matchType: "all", conditions: inferredConditions };
}

function isConditionComplete(condition: RuleCondition): boolean {
  if (!condition.field || !condition.operator) {
    return false;
  }

  const value = condition.value;
  if (value == null) return false;

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

function normaliseForOutput(condition: RuleCondition): ConditionPayload | null {
  if (!isConditionComplete(condition)) {
    return null;
  }

  const field = condition.field.trim();
  const operator = condition.operator || "equals";
  const fieldType = getFieldType(field);
  const rawValue = condition.value;

  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) return null;
    const values = rawValue.map((entry) => (fieldType === "number" ? Number(entry) : String(entry))).filter((entry) => {
      if (fieldType === "number") {
        return Number.isFinite(entry);
      }
      return String(entry).trim().length > 0;
    });
    if (values.length === 0) return null;
    return { field, operator, value: values };
  }

  if (fieldType === "number") {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) {
      return null;
    }
    return { field, operator, value: numericValue };
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return null;
    }
    return { field, operator, value: trimmed };
  }

  return { field, operator, value: rawValue };
}

function buildRuleTree(matchType: MatchType, conditions: RuleCondition[]): Record<string, unknown> | null {
  const payloads = conditions
    .map((condition) => normaliseForOutput(condition))
    .filter((payload): payload is ConditionPayload => Boolean(payload));

  if (payloads.length === 0) {
    return null;
  }

  if (payloads.length === 1) {
    return payloads[0];
  }

  return matchType === "all" ? { all: payloads } : { any: payloads };
}

export default function AutoAssignRuleBuilder({ value, onChange, disabled = false }: AutoAssignRuleBuilderProps) {
  const [matchType, setMatchType] = useState<MatchType>("all");
  const [conditions, setConditions] = useState<RuleCondition[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const valueSignature = useMemo(() => JSON.stringify(value ?? null), [value]);
  const lastSignatureRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (lastSignatureRef.current === valueSignature) {
      return;
    }
    lastSignatureRef.current = valueSignature;
    const parsed = parseRules(value ?? null);
    setMatchType(parsed.matchType);
    setConditions(parsed.conditions);
  }, [valueSignature, value]);

  useEffect(() => {
    const rules = buildRuleTree(matchType, conditions);
    onChangeRef.current(rules);
  }, [conditions, matchType]);

  const handleAddCondition = () => {
    setConditions((prev) => [...prev, createEmptyCondition()]);
  };

  const handleConditionChange = (id: string, next: RuleCondition) => {
    setConditions((prev) => prev.map((condition) => (condition.id === id ? next : condition)));
  };

  const handleRemoveCondition = (id: string) => {
    setConditions((prev) => prev.filter((condition) => condition.id !== id));
  };

  const handleClearAll = () => {
    setConditions([]);
  };

  const inferredRules = useMemo(() => buildRuleTree(matchType, conditions), [matchType, conditions]);
  const hasConditions = conditions.length > 0;

  return (
    <section className="md:col-span-2">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Auto-assignment rules</h3>
            <p className="text-sm text-gray-600">
              Teach Kazador how to place new tasks and timeline entries into this lane automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPreview((prev) => !prev)}
            className="self-start rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 transition hover:bg-white"
          >
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>

        {!hasConditions ? (
          <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center">
            <p className="text-sm text-gray-600">
              Items will only land in this lane when you explicitly choose it. Add a rule to automate the hand-off.
            </p>
            <button
              type="button"
              onClick={handleAddCondition}
              disabled={disabled}
              className="mt-4 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
            >
              Add first condition
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1">
                <label className="flex flex-col gap-1 text-sm text-gray-700">
                  <span className="font-medium">Match logic</span>
                  <select
                    value={matchType}
                    onChange={(event) => setMatchType(event.target.value as MatchType)}
                    disabled={disabled}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    {MATCH_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleAddCondition}
                  disabled={disabled}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-white disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  Add condition
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={disabled}
                  className="text-sm font-medium text-gray-500 transition hover:text-gray-700 disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  Clear all
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {conditions.map((condition) => (
                <ConditionEditor
                  key={condition.id}
                  condition={condition}
                  onChange={(next) => handleConditionChange(condition.id, next)}
                  onRemove={() => handleRemoveCondition(condition.id)}
                  disableRemove={disabled}
                />
              ))}
            </div>
          </div>
        )}

        {showPreview ? (
          <div className="mt-6">
            <RulePreview
              rules={inferredRules}
              conditions={conditions}
              matchType={matchType}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function summariseAutoAssignRules(rules: Record<string, unknown> | null): string {
  if (!rules || Object.keys(rules).length === 0) {
    return "Manual only";
  }

  if (Array.isArray((rules as { all?: unknown[] }).all)) {
    return ((rules as { all?: unknown[] }).all ?? [])
      .map((entry) => (entry && typeof entry === "object" ? describeCondition(toRuleCondition(entry as Record<string, unknown>) ?? createEmptyCondition()) : null))
      .filter((entry): entry is string => Boolean(entry))
      .join(" • ");
  }

  if (Array.isArray((rules as { any?: unknown[] }).any)) {
    return ((rules as { any?: unknown[] }).any ?? [])
      .map((entry) => (entry && typeof entry === "object" ? describeCondition(toRuleCondition(entry as Record<string, unknown>) ?? createEmptyCondition()) : null))
      .filter((entry): entry is string => Boolean(entry))
      .join(" • ");
  }

  if (typeof (rules as { field?: string }).field === "string") {
    const condition = toRuleCondition(rules as Record<string, unknown>);
    return condition ? describeCondition(condition) : "Manual only";
  }

  const descriptors: string[] = [];
  for (const [field, value] of Object.entries(rules)) {
    if (value == null) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      const condition = toRuleCondition({ field, ...(value as Record<string, unknown>) });
      if (condition) {
        descriptors.push(describeCondition(condition));
      }
    } else {
      const condition = toRuleCondition({ field, operator: "equals", value });
      if (condition) {
        descriptors.push(describeCondition(condition));
      }
    }
  }

  return descriptors.length > 0 ? descriptors.join(" • ") : "Manual only";
}

export function conditionSummaries(conditions: RuleCondition[]): string[] {
  return conditions.filter((condition) => isConditionComplete(condition)).map((condition) => describeCondition(condition));
}
