"use client";

import { useMemo, useState } from "react";
import type { MatchType, RuleCondition } from "./ruleTypes";
import { describeCondition, getFieldOption } from "./ConditionEditor";

interface RulePreviewProps {
  rules: Record<string, unknown> | null;
  conditions: RuleCondition[];
  matchType: MatchType;
}

function isComplete(condition: RuleCondition): boolean {
  if (!condition.field || !condition.operator) return false;
  const value = condition.value;
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function formatValue(value: RuleCondition["value"], field: string): string {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "number" ? entry.toString() : `'${String(entry)}'`))
      .join(", ");
  }
  if (typeof value === "number") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    return `'${trimmed}'`;
  }
  return String(value ?? "");
}

function operatorPositiveLabel(operator: string): string {
  switch (operator) {
    case "equals":
      return "equals";
    case "not_equals":
      return "does not equal";
    case "contains":
      return "contains";
    case "not_contains":
      return "does not contain";
    case "matches_regex":
      return "matches";
    case "gt":
      return "is greater than";
    case "gte":
      return "is greater than or equal to";
    case "lt":
      return "is less than";
    case "lte":
      return "is less than or equal to";
    case "in":
      return "is one of";
    case "not_in":
      return "is not one of";
    default:
      return operator;
  }
}

function operatorNegativeLabel(operator: string): string {
  switch (operator) {
    case "equals":
      return "does not equal";
    case "not_equals":
      return "equals";
    case "contains":
      return "does not contain";
    case "not_contains":
      return "contains";
    case "matches_regex":
      return "does not match";
    case "gt":
      return "is less than or equal to";
    case "gte":
      return "is less than";
    case "lt":
      return "is greater than or equal to";
    case "lte":
      return "is greater than";
    case "in":
      return "is not one of";
    case "not_in":
      return "is one of";
    default:
      return operator;
  }
}

function buildExample(condition: RuleCondition): { match: string; miss: string } {
  const fieldMeta = getFieldOption(condition.field);
  const fieldLabel = fieldMeta?.label ?? (condition.field || "Item");
  const valueLabel = formatValue(condition.value, condition.field);
  const positiveOperator = operatorPositiveLabel(condition.operator);
  const negativeOperator = operatorNegativeLabel(condition.operator);

  return {
    match: `${fieldLabel} ${positiveOperator} ${valueLabel}`.trim(),
    miss: `${fieldLabel} ${negativeOperator} ${valueLabel}`.trim(),
  };
}

export default function RulePreview({ rules, conditions, matchType }: RulePreviewProps) {
  const [showJson, setShowJson] = useState(false);
  const validConditions = useMemo(() => conditions.filter(isComplete), [conditions]);
  const heading = matchType === "all" ? "Match ALL of these conditions:" : "Match ANY of these conditions:";
  const conditionDescriptions = useMemo(() => validConditions.map((condition) => describeCondition(condition)), [validConditions]);
  const examples = useMemo(() => validConditions.map((condition) => buildExample(condition)), [validConditions]);
  const hasRules = rules != null && Object.keys(rules).length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">Rule preview</h4>
        {hasRules ? (
          <button
            type="button"
            onClick={() => setShowJson((prev) => !prev)}
            className="text-sm font-medium text-gray-500 transition hover:text-gray-800"
          >
            {showJson ? "Hide JSON" : "View JSON structure"}
          </button>
        ) : null}
      </div>

      {!hasRules ? (
        <p className="mt-3 text-sm text-gray-500">No rules configured yet. Add at least one condition to preview the output.</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-700">Human-readable summary</p>
            <p className="mt-2 text-sm text-gray-600">{heading}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
              {conditionDescriptions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          {examples.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-gray-700">Example outcomes</p>
              <ul className="mt-2 space-y-2 text-sm text-gray-600">
                {examples.slice(0, 2).map((example, index) => (
                  <li key={`match-${index}`} className="rounded-md bg-gray-100 px-3 py-2">
                    <p className="font-medium text-gray-700">Would match</p>
                    <p className="text-sm text-gray-600">{example.match}</p>
                  </li>
                ))}
                {examples.slice(0, 2).map((example, index) => (
                  <li key={`miss-${index}`} className="rounded-md bg-white px-3 py-2">
                    <p className="font-medium text-gray-700">Would not match</p>
                    <p className="text-sm text-gray-600">{example.miss}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {showJson ? (
            <div>
              <p className="text-sm font-medium text-gray-700">JSON structure</p>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-slate-900 p-4 text-xs text-slate-100">
                {JSON.stringify(rules, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
