"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createEmptyProjectAssignmentRule,
  type ProjectAssignmentRule,
  type ProjectAssignmentRuleInput,
  type ProjectAssignmentRuleCondition,
  type ProjectAssignmentRuleConditionGroup,
  type ProjectAssignmentRuleConfidence,
  type ProjectAssignmentRuleConditionField,
  EMAIL_CATEGORY_OPTIONS,
} from "@kazador/shared";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchProjectAssignmentRules,
  createProjectAssignmentRule,
  updateProjectAssignmentRule,
  deleteProjectAssignmentRule,
  testProjectAssignmentRule,
  replayProjectAssignmentRules,
} from "@/lib/projectAssignmentRulesClient";
import { fetchProjects, type ProjectListItem } from "@/lib/supabaseClient";

const TRIAGE_OPTIONS = [
  { value: "unassigned", label: "Unassigned" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "snoozed", label: "Snoozed" },
  { value: "resolved", label: "Resolved" },
];

const BOOLEAN_OPTIONS = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

interface ConditionFieldConfig {
  value: ProjectAssignmentRuleConditionField;
  label: string;
  type: "text" | "category" | "labels" | "boolean" | "date" | "number" | "triage";
  description?: string;
}

const CONDITION_FIELDS: ConditionFieldConfig[] = [
  { value: "subject", label: "Subject", type: "text" },
  { value: "from_name", label: "From name", type: "text" },
  { value: "from_email", label: "From email", type: "text" },
  { value: "body", label: "Body", type: "text", description: "Matching on body text may take longer." },
  { value: "category", label: "Category", type: "category" },
  { value: "labels", label: "Labels", type: "labels" },
  { value: "has_attachment", label: "Has attachment", type: "boolean" },
  { value: "received_at", label: "Received date", type: "date" },
  { value: "priority_score", label: "Priority score", type: "number" },
  { value: "triage_state", label: "Triage state", type: "triage" },
];

const FIELD_OPERATORS: Record<ProjectAssignmentRuleConditionField, ProjectAssignmentRuleCondition["operator"][]> = {
  subject: ["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with"],
  from_name: ["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with"],
  from_email: ["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with"],
  body: ["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with"],
  category: ["equals", "not_equals", "is_one_of"],
  labels: ["is_one_of", "contains", "not_contains"],
  has_attachment: ["equals"],
  received_at: ["before", "after", "within_last_days"],
  priority_score: ["equals", "greater_than", "less_than", "between"],
  triage_state: ["equals", "not_equals", "is_one_of"],
};

const CONFIDENCE_OPTIONS: { value: ProjectAssignmentRuleConfidence; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

function cloneProjectRule(rule: ProjectAssignmentRule): ProjectAssignmentRule {
  return JSON.parse(JSON.stringify(rule)) as ProjectAssignmentRule;
}

function generateConditionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `cond-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDefaultCondition(field: ProjectAssignmentRuleConditionField = "subject"): ProjectAssignmentRuleCondition {
  const operator = FIELD_OPERATORS[field][0];
  return {
    id: generateConditionId(),
    field,
    operator,
    value: defaultValueFor(field, operator),
  };
}

function defaultValueFor(
  field: ProjectAssignmentRuleConditionField,
  operator: ProjectAssignmentRuleCondition["operator"]
): ProjectAssignmentRuleCondition["value"] {
  switch (field) {
    case "subject":
    case "from_name":
    case "from_email":
    case "body":
      if (operator === "contains" || operator === "not_contains" || operator === "starts_with" || operator === "ends_with") {
        return [""];
      }
      return "";
    case "category":
      return operator === "is_one_of" ? [] : "";
    case "labels":
      return [];
    case "has_attachment":
      return false;
    case "received_at":
      if (operator === "within_last_days") {
        return { days: 7 };
      }
      return new Date().toISOString().slice(0, 10);
    case "priority_score":
      if (operator === "between") {
        return { min: null, max: null };
      }
      return 0;
    case "triage_state":
      return operator === "is_one_of" ? [] : "unassigned";
    default:
      return "";
  }
}

function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (value == null) return [];
  return [String(value)];
}

function stringifyConditionValue(condition: ProjectAssignmentRuleCondition): string {
  switch (condition.field) {
    case "subject":
    case "from_name":
    case "from_email":
    case "body":
    case "labels":
      if (Array.isArray(condition.value)) {
        return condition.value.join(", ");
      }
      return String(condition.value ?? "");
    case "category":
    case "triage_state":
      if (Array.isArray(condition.value)) {
        return condition.value.join(", ");
      }
      return String(condition.value ?? "");
    case "has_attachment":
      return condition.value ? "true" : "false";
    case "received_at":
      if (condition.operator === "within_last_days") {
        const days = (condition.value as { days?: number | null })?.days ?? 7;
        return String(days);
      }
      return String(condition.value ?? "");
    case "priority_score":
      if (condition.operator === "between") {
        const range = condition.value as { min?: number | null; max?: number | null };
        const min = range?.min != null ? String(range.min) : "";
        const max = range?.max != null ? String(range.max) : "";
        return `${min},${max}`;
      }
      return String(condition.value ?? "");
    default:
      return String(condition.value ?? "");
  }
}

function parseConditionValue(
  field: ProjectAssignmentRuleConditionField,
  operator: ProjectAssignmentRuleCondition["operator"],
  input: string
): ProjectAssignmentRuleCondition["value"] {
  const trimmed = input.trim();
  switch (field) {
    case "subject":
    case "from_name":
    case "from_email":
    case "body":
      if (operator === "contains" || operator === "not_contains" || operator === "starts_with" || operator === "ends_with") {
        return trimmed ? trimmed.split(",").map((part) => part.trim()).filter(Boolean) : [];
      }
      return trimmed;
    case "category":
    case "triage_state":
      if (operator === "is_one_of") {
        return trimmed ? trimmed.split(",").map((part) => part.trim()).filter(Boolean) : [];
      }
      return trimmed;
    case "labels":
      return trimmed ? trimmed.split(",").map((part) => part.trim()).filter(Boolean) : [];
    case "has_attachment":
      return trimmed === "true";
    case "received_at":
      if (operator === "within_last_days") {
        const value = Number(trimmed || "7");
        return { days: Number.isFinite(value) ? value : 7 };
      }
      return trimmed;
    case "priority_score":
      if (operator === "between") {
        const [minRaw, maxRaw] = trimmed.split(",");
        const min = minRaw != null && minRaw !== "" ? Number(minRaw) : null;
        const max = maxRaw != null && maxRaw !== "" ? Number(maxRaw) : null;
        return { min: Number.isFinite(min ?? NaN) ? min : null, max: Number.isFinite(max ?? NaN) ? max : null };
      }
      return trimmed === "" ? null : Number(trimmed);
    default:
      return trimmed;
  }
}

export function ProjectEmailRulesSection({ accessToken }: { accessToken?: string }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? "user";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState<ProjectAssignmentRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectAssignmentRule | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [testSummary, setTestSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [ruleList, projectList] = await Promise.all([
          fetchProjectAssignmentRules(accessToken),
          fetchProjects({ accessToken }),
        ]);
        if (!cancelled) {
          setRules(ruleList);
          setProjects(projectList);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load project rules");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const handleOpenForm = (rule?: ProjectAssignmentRule) => {
    if (rule) {
      setEditingRuleId(rule.id);
      setDraft(cloneProjectRule(rule));
    } else {
      const emptyRule = createEmptyProjectAssignmentRule("", userId);
      emptyRule.enabled = true;
      emptyRule.sortOrder = rules.length;
      emptyRule.conditions = { logic: "and", conditions: [createDefaultCondition()] } as ProjectAssignmentRuleConditionGroup;
      setEditingRuleId(null);
      setDraft(emptyRule);
    }
    setSuccess(null);
    setError(null);
    setFormOpen(true);
  };

  const handleCloseForm = () => {
    setFormOpen(false);
    setDraft(null);
    setEditingRuleId(null);
  };

  const handleDraftChange = <K extends keyof ProjectAssignmentRule>(key: K, value: ProjectAssignmentRule[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleActionChange = (updater: (action: ProjectAssignmentRule["actions"]) => ProjectAssignmentRule["actions"]) => {
    setDraft((prev) => (prev ? { ...prev, actions: updater(prev.actions) } : prev));
  };

  const handleConditionUpdate = (index: number, updater: (condition: ProjectAssignmentRuleCondition) => ProjectAssignmentRuleCondition) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneProjectRule(prev);
      next.conditions.conditions[index] = updater(next.conditions.conditions[index]);
      return next;
    });
  };

  const handleAddCondition = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneProjectRule(prev);
      next.conditions.conditions = [...next.conditions.conditions, createDefaultCondition()];
      return next;
    });
  };

  const handleRemoveCondition = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneProjectRule(prev);
      next.conditions.conditions = next.conditions.conditions.filter((_, condIndex) => condIndex !== index);
      if (next.conditions.conditions.length === 0) {
        next.conditions.conditions = [createDefaultCondition()];
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!draft) {
      setError("Select or create a rule to save");
      return;
    }

    if (!draft.projectId) {
      setError("Choose a project for this rule");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload: ProjectAssignmentRuleInput = {
      id: editingRuleId ?? undefined,
      name: draft.name,
      description: draft.description,
      enabled: draft.enabled,
      projectId: draft.projectId,
      sortOrder: draft.sortOrder,
      conditions: draft.conditions,
      actions: { ...draft.actions, projectId: draft.projectId },
    };

    try {
      if (editingRuleId) {
        const updated = await updateProjectAssignmentRule(editingRuleId, payload, accessToken);
        setRules((prev) => prev.map((rule) => (rule.id === updated.id ? updated : rule)));
        setSuccess("Project email rule updated");
      } else {
        const created = await createProjectAssignmentRule(payload, accessToken);
        setRules((prev) => [...prev, created]);
        setSuccess("Project email rule created");
      }
      handleCloseForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save project rule");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (rule: ProjectAssignmentRule) => {
    try {
      const updated = await updateProjectAssignmentRule(
        rule.id,
        {
          id: rule.id,
          enabled: !rule.enabled,
          projectId: rule.projectId,
          name: rule.name,
          description: rule.description,
          sortOrder: rule.sortOrder,
          conditions: rule.conditions,
          actions: rule.actions,
        },
        accessToken
      );
      setRules((prev) => prev.map((item) => (item.id === rule.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update rule state");
    }
  };

  const handleDelete = async (rule: ProjectAssignmentRule) => {
    if (!confirm(`Delete project email rule "${rule.name}"?`)) {
      return;
    }
    try {
      await deleteProjectAssignmentRule(rule.id, accessToken);
      setRules((prev) => prev.filter((item) => item.id !== rule.id));
      setSuccess("Project email rule deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rule");
    }
  };

  const handleTestRule = async (rule: ProjectAssignmentRule) => {
    try {
      const result = await testProjectAssignmentRule(rule.id, accessToken);
      setTestSummary(`Matched ${result.matchedCount} of ${result.total} recent emails`);
      setSuccess(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to test rule");
    }
  };

  const handleReplayRules = async () => {
    try {
      const result = await replayProjectAssignmentRules(accessToken);
      setSuccess(`Processed ${result.processed} emails · Created ${result.linksCreated} links · Skipped ${result.skipped}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to re-run rules");
    }
  };

  const filteredRules = useMemo(() => {
    if (!projectFilter) {
      return rules;
    }
    return rules.filter((rule) => rule.projectId === projectFilter);
  }, [rules, projectFilter]);

  const conditionLogic = draft?.conditions.logic ?? "and";

  return (
    <section className="mt-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Project email rules</h2>
          <p className="mt-1 text-sm text-gray-600">
            Automatically link incoming emails to projects when their metadata matches your conditions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleReplayRules}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            Re-run rules
          </button>
          <button
            type="button"
            onClick={() => handleOpenForm()}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
          >
            Add rule
          </button>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {success ? <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p> : null}
      {testSummary ? <p className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700">{testSummary}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600">
          Filter by project
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          >
            <option value="">All projects</option>
            {projects.map((item) => (
              <option key={item.project.id} value={item.project.id}>
                {item.project.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading project rules…</p>
      ) : filteredRules.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">No project email rules configured yet.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {filteredRules.map((rule) => {
            const project = projects.find((item) => item.project.id === rule.projectId)?.project;
            return (
              <li key={rule.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{rule.name}</p>
                    <p className="text-sm text-gray-600">{rule.description || "No description"}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Target project: {project ? project.name : rule.projectId} · Conditions: {rule.conditions.conditions.length} · Sort order: {rule.sortOrder}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(rule)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                        rule.enabled ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                      }`}
                    >
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenForm(rule)}
                      className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTestRule(rule)}
                      className="rounded-md border border-indigo-300 px-3 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50"
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(rule)}
                      className="rounded-md border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {formOpen && draft ? (
        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">{editingRuleId ? "Edit project rule" : "Create project rule"}</h3>
            <button type="button" onClick={handleCloseForm} className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Name</span>
              <input
                type="text"
                value={draft.name}
                onChange={(event) => handleDraftChange("name", event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Description</span>
              <input
                type="text"
                value={draft.description ?? ""}
                onChange={(event) => handleDraftChange("description", event.target.value || null)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </label>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Target project</span>
              <select
                value={draft.projectId}
                onChange={(event) => {
                  const value = event.target.value;
                  handleDraftChange("projectId", value);
                  handleActionChange((action) => ({ ...action, projectId: value }));
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              >
                <option value="">Select project…</option>
                {projects.map((item) => (
                  <option key={item.project.id} value={item.project.id}>
                    {item.project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Sort order</span>
              <input
                type="number"
                value={draft.sortOrder}
                onChange={(event) => handleDraftChange("sortOrder", Number(event.target.value))}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </label>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Conditions</span>
              <div className="flex items-center gap-2">
                <label className="inline-flex items.center gap-2 text-xs text-gray-600">
                  <span>Logic</span>
                  <select
                    value={conditionLogic}
                    onChange={(event) =>
                      setDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              conditions: { ...prev.conditions, logic: event.target.value === "or" ? "or" : "and" },
                            }
                          : prev
                      )
                    }
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  >
                    <option value="and">All conditions (AND)</option>
                    <option value="or">Any condition (OR)</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleAddCondition}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  + Add condition
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {draft.conditions.conditions.map((condition, index) => {
                const fieldConfig = CONDITION_FIELDS.find((field) => field.value === condition.field) ?? CONDITION_FIELDS[0];
                const operators = FIELD_OPERATORS[condition.field];
                const valueInput = stringifyConditionValue(condition);
                return (
                  <div key={condition.id} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div className="grid gap-3 md:grid-cols-4">
                      <label className="flex flex-col gap-1 text-xs">
                        <span className="font-medium text-gray-600">Field</span>
                        <select
                          value={condition.field}
                          onChange={(event) => {
                            const value = event.target.value as ProjectAssignmentRuleConditionField;
                            handleConditionUpdate(index, () => ({
                              ...createDefaultCondition(value),
                            }));
                          }}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                        >
                          {CONDITION_FIELDS.map((field) => (
                            <option key={field.value} value={field.value}>
                              {field.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        <span className="font-medium text-gray-600">Operator</span>
                        <select
                          value={condition.operator}
                          onChange={(event) => {
                            const nextOperator = event.target.value as ProjectAssignmentRuleCondition["operator"];
                            handleConditionUpdate(index, (current) => ({
                              ...current,
                              operator: nextOperator,
                              value: defaultValueFor(current.field, nextOperator),
                            }));
                          }}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                        >
                          {operators.map((operator) => (
                            <option key={operator} value={operator}>
                              {operator.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs md:col-span-2">
                        <span className="font-medium text-gray-600">Value</span>
                        {fieldConfig.type === "boolean" ? (
                          <select
                            value={valueInput}
                            onChange={(event) => handleConditionUpdate(index, (current) => ({ ...current, value: event.target.value === "true" }))}
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                          >
                            {BOOLEAN_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : fieldConfig.type === "triage" ? (
                          <select
                            multiple={condition.operator === "is_one_of"}
                            value={ensureArray(condition.value)}
                            onChange={(event) => {
                              const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                              handleConditionUpdate(index, (current) => ({
                                ...current,
                                value: condition.operator === "is_one_of" ? selected : selected[0] ?? "",
                              }));
                            }}
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                          >
                            {TRIAGE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : fieldConfig.type === "category" ? (
                          <select
                            multiple={condition.operator === "is_one_of"}
                            value={ensureArray(condition.value)}
                            onChange={(event) => {
                              const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
                              handleConditionUpdate(index, (current) => ({
                                ...current,
                                value: condition.operator === "is_one_of" ? selected : selected[0] ?? "",
                              }));
                            }}
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                          >
                            {EMAIL_CATEGORY_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : fieldConfig.type === "date" ? (
                          condition.operator === "within_last_days" ? (
                            <input
                              type="number"
                              min={0}
                              value={(condition.value as { days?: number | null })?.days ?? 7}
                              onChange={(event) =>
                                handleConditionUpdate(index, (current) => ({
                                  ...current,
                                  value: { days: Number(event.target.value) },
                                }))
                              }
                              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                            />
                          ) : (
                            <input
                              type="date"
                              value={String(condition.value ?? "").slice(0, 10)}
                              onChange={(event) => handleConditionUpdate(index, (current) => ({ ...current, value: event.target.value }))}
                              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                            />
                          )
                        ) : fieldConfig.type === "number" ? (
                          condition.operator === "between" ? (
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="number"
                                placeholder="Min"
                                value={(condition.value as { min?: number | null })?.min ?? ""}
                                onChange={(event) =>
                                  handleConditionUpdate(index, (current) => ({
                                    ...current,
                                    value: {
                                      ...(current.value as { min?: number | null; max?: number | null }),
                                      min: event.target.value === "" ? null : Number(event.target.value),
                                    },
                                  }))
                                }
                                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                              />
                              <input
                                type="number"
                                placeholder="Max"
                                value={(condition.value as { max?: number | null })?.max ?? ""}
                                onChange={(event) =>
                                  handleConditionUpdate(index, (current) => ({
                                    ...current,
                                    value: {
                                      ...(current.value as { min?: number | null; max?: number | null }),
                                      max: event.target.value === "" ? null : Number(event.target.value),
                                    },
                                  }))
                                }
                                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                              />
                            </div>
                          ) : (
                            <input
                              type="number"
                              value={Number(condition.value ?? "")}
                              onChange={(event) => handleConditionUpdate(index, (current) => ({ ...current, value: event.target.value === "" ? null : Number(event.target.value) }))}
                              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                            />
                          )
                        ) : (
                          <input
                            type="text"
                            value={valueInput}
                            onChange={(event) => handleConditionUpdate(index, (current) => ({
                              ...current,
                              value: parseConditionValue(current.field, current.operator, event.target.value),
                            }))}
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                          />
                        )}
                        {fieldConfig.description ? (
                          <span className="mt-1 text-[11px] text-gray-500">{fieldConfig.description}</span>
                        ) : null}
                      </label>
                    </div>
                    <div className="mt-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveCondition(index)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Confidence</span>
              <select
                value={draft.actions.confidence ?? "high"}
                onChange={(event) => handleActionChange((action) => ({ ...action, confidence: event.target.value as ProjectAssignmentRuleConfidence }))}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              >
                {CONFIDENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Note (optional)</span>
              <textarea
                value={String(draft.actions.note ?? "")}
                onChange={(event) => handleActionChange((action) => ({ ...action, note: event.target.value || null }))}
                rows={3}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </label>
          </div>

          <div className="mt-8 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleCloseForm}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {saving ? "Saving…" : "Save project rule"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default ProjectEmailRulesSection;
