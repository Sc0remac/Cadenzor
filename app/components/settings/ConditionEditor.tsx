"use client";

import { useId, type ChangeEvent } from "react";
import type { FieldType } from "./ruleTypes";
import { type RuleCondition } from "./ruleTypes";

interface FieldOption {
  value: string;
  label: string;
  type: FieldType;
  suggestions?: string[];
}

interface OperatorOption {
  value: string;
  label: string;
  types: FieldType[];
}

export const FIELD_OPTIONS: FieldOption[] = [
  { value: "type", label: "Type", type: "text", suggestions: ["task", "event", "milestone", "hold"] },
  { value: "title", label: "Title", type: "text" },
  { value: "description", label: "Description", type: "text" },
  { value: "status", label: "Status", type: "text", suggestions: ["todo", "in_progress", "done", "waiting"] },
  { value: "category", label: "Category", type: "text", suggestions: ["FINANCE", "LEGAL", "BOOKING", "PROMO", "TRAVEL"] },
  { value: "priority", label: "Priority", type: "number" },
  { value: "labels.territory", label: "Territory", type: "text" },
  { value: "labels.city", label: "City", type: "text" },
  { value: "labels.venue", label: "Venue", type: "text" },
  { value: "labels.artist", label: "Artist", type: "text" },
];

export const OPERATOR_OPTIONS: OperatorOption[] = [
  { value: "equals", label: "equals", types: ["text", "number", "boolean"] },
  { value: "not_equals", label: "does not equal", types: ["text", "number", "boolean"] },
  { value: "contains", label: "contains", types: ["text"] },
  { value: "not_contains", label: "does not contain", types: ["text"] },
  { value: "matches_regex", label: "matches regex", types: ["text"] },
  { value: "gt", label: "greater than", types: ["number"] },
  { value: "gte", label: "greater than or equal", types: ["number"] },
  { value: "lt", label: "less than", types: ["number"] },
  { value: "lte", label: "less than or equal", types: ["number"] },
  { value: "in", label: "is one of", types: ["text", "number"] },
  { value: "not_in", label: "is not one of", types: ["text", "number"] },
];

export function getFieldOption(field: string | null | undefined): FieldOption | undefined {
  if (!field) return undefined;
  return FIELD_OPTIONS.find((option) => option.value === field);
}

export function getFieldType(field: string | null | undefined): FieldType {
  return getFieldOption(field)?.type ?? "text";
}

export function getAllowedOperators(field: string | null | undefined): OperatorOption[] {
  const fieldType = getFieldType(field);
  return OPERATOR_OPTIONS.filter((option) => option.types.includes(fieldType));
}

function formatValueForDisplay(condition: RuleCondition): string {
  if (condition.value == null) return "";
  if (Array.isArray(condition.value)) {
    return condition.value.join(", ");
  }
  return String(condition.value ?? "");
}

function normaliseTextList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normaliseNumberList(raw: string): number[] {
  return raw
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((value) => Number.isFinite(value));
}

function parseValue(
  field: string | null | undefined,
  operator: string,
  event: ChangeEvent<HTMLInputElement>
): string | number | string[] | number[] | boolean | null {
  const raw = event.target.value;
  const fieldType = getFieldType(field);

  if (!raw.trim()) {
    return fieldType === "number" ? null : "";
  }

  if (operator === "in" || operator === "not_in") {
    if (fieldType === "number") {
      return normaliseNumberList(raw);
    }
    return normaliseTextList(raw);
  }

  if (fieldType === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (fieldType === "boolean") {
    return raw.trim().toLowerCase() === "true";
  }

  return raw;
}

interface ConditionEditorProps {
  condition: RuleCondition;
  onChange: (next: RuleCondition) => void;
  onRemove: () => void;
  disableRemove?: boolean;
}

export default function ConditionEditor({
  condition,
  onChange,
  onRemove,
  disableRemove = false,
}: ConditionEditorProps) {
  const valueInputId = useId();
  const fieldOption = getFieldOption(condition.field);
  const allowedOperators = getAllowedOperators(condition.field);
  const hasFieldSelected = Boolean(condition.field);
  const displayValue = formatValueForDisplay(condition);

  const handleFieldChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextField = event.target.value;
    const fieldType = getFieldType(nextField);
    const nextOperators = getAllowedOperators(nextField);
    const defaultOperator = nextOperators[0]?.value ?? "equals";

    const nextValue = fieldType === "number" ? null : "";

    onChange({
      ...condition,
      field: nextField,
      operator: defaultOperator,
      value: nextValue,
    });
  };

  const handleOperatorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextOperator = event.target.value;
    let nextValue = condition.value;

    if (nextOperator === "in" || nextOperator === "not_in") {
      nextValue = Array.isArray(condition.value) ? condition.value : [];
    } else if (Array.isArray(condition.value)) {
      nextValue = condition.value.length > 0 ? condition.value[0] : "";
    }

    onChange({
      ...condition,
      operator: nextOperator,
      value: nextValue,
    });
  };

  const handleValueChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = parseValue(condition.field, condition.operator, event);
    onChange({
      ...condition,
      value: nextValue,
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex-1">
          <label className="flex w-full flex-col gap-1 text-sm text-gray-700">
            <span className="font-medium">Field</span>
            <select
              value={condition.field}
              onChange={handleFieldChange}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            >
              <option value="">Select field…</option>
              {FIELD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex-1">
          <label className="flex w-full flex-col gap-1 text-sm text-gray-700">
            <span className="font-medium">Operator</span>
            <select
              value={condition.operator}
              onChange={handleOperatorChange}
              disabled={!hasFieldSelected}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              {!hasFieldSelected ? <option value="">Select a field first</option> : null}
              {allowedOperators.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex-1">
          <label className="flex w-full flex-col gap-1 text-sm text-gray-700">
            <span className="font-medium">Value</span>
            <input
              id={valueInputId}
              type={getFieldType(condition.field) === "number" && condition.operator !== "in" && condition.operator !== "not_in" ? "number" : "text"}
              value={displayValue}
              onChange={handleValueChange}
              disabled={!hasFieldSelected}
              placeholder={fieldOption?.type === "number" ? "Enter a number" : "Enter a value"}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
              list={fieldOption?.suggestions && fieldOption.suggestions.length > 0 ? `${valueInputId}-suggestions` : undefined}
            />
            {fieldOption?.suggestions && fieldOption.suggestions.length > 0 ? (
              <datalist id={`${valueInputId}-suggestions`}>
                {fieldOption.suggestions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            ) : null}
            {condition.operator === "in" || condition.operator === "not_in" ? (
              <span className="text-xs text-gray-500">Separate values with commas.</span>
            ) : null}
          </label>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disableRemove}
          className="self-start rounded-md border border-transparent px-3 py-2 text-sm font-medium text-gray-500 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function normaliseConditionValue(field: string, value: RuleCondition["value"]): RuleCondition["value"] {
  const fieldType = getFieldType(field);
  if (value == null) return value;

  if (fieldType === "number") {
    if (Array.isArray(value)) {
      return value.map((entry) => (typeof entry === "number" ? entry : Number(entry))).filter((entry) => Number.isFinite(entry));
    }
    return typeof value === "number" && Number.isFinite(value) ? value : Number(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  return typeof value === "string" ? value : String(value);
}

export function describeCondition(condition: RuleCondition): string {
  const fieldOption = getFieldOption(condition.field);
  const fieldLabel = fieldOption?.label ?? (condition.field || "Field");
  const operatorLabel = OPERATOR_OPTIONS.find((option) => option.value === condition.operator)?.label ?? condition.operator;

  if (condition.value == null || (typeof condition.value === "string" && !condition.value.trim())) {
    return `${fieldLabel} ${operatorLabel}`;
  }

  if (Array.isArray(condition.value)) {
    return `${fieldLabel} ${operatorLabel} ${condition.value.join(", ")}`;
  }

  return `${fieldLabel} ${operatorLabel} ${condition.value}`;
}
