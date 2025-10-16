"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createEmptyAutomationRule,
  type AutomationRule,
  type AutomationTriggerType,
  type AutomationRuleInput,
  EMAIL_CATEGORY_OPTIONS,
} from "@kazador/shared";
import { useAuth } from "@/components/AuthProvider";
import {
  createAutomationRule,
  deleteAutomationRule,
  fetchAutomationRules,
  updateAutomationRule,
} from "@/lib/automationRulesClient";

function cloneRule(rule: AutomationRule): AutomationRule {
  return JSON.parse(JSON.stringify(rule)) as AutomationRule;
}

function buildInput(rule: AutomationRule): AutomationRuleInput {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    isEnabled: rule.isEnabled,
    trigger: rule.trigger,
    conditions: rule.conditions,
    actions: rule.actions,
  } satisfies AutomationRuleInput;
}

function isEmailTrigger(
  trigger: AutomationRule["trigger"]
): trigger is Extract<AutomationRule["trigger"], { type: "email_received" }> {
  return trigger.type === "email_received";
}

export default function AutomationSettingsPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? undefined;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationRule>(() => cloneRule(createEmptyAutomationRule()));
  const [categorySearch, setCategorySearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAutomationRules(accessToken)
      .then((list) => {
        if (!cancelled) {
          setRules(list);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load automation rules");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const filteredCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    if (!query) return EMAIL_CATEGORY_OPTIONS;
    return EMAIL_CATEGORY_OPTIONS.filter((name) => name.toLowerCase().includes(query));
  }, [categorySearch]);

  const openCreateForm = () => {
    setEditingRuleId(null);
    setDraft(cloneRule(createEmptyAutomationRule()));
    setFormOpen(true);
    setSuccess(null);
    setError(null);
  };

  const openEditForm = (rule: AutomationRule) => {
    setEditingRuleId(rule.id);
    setDraft(cloneRule(rule));
    setFormOpen(true);
    setSuccess(null);
    setError(null);
  };

  const handleCloseForm = () => {
    setFormOpen(false);
    setEditingRuleId(null);
  };

  const handleTriggerTypeChange = (type: AutomationTriggerType) => {
    setDraft((prev) => {
      const next = cloneRule(prev);
      if (type === "email_received") {
        next.trigger = {
          type,
          options: {
            categories: isEmailTrigger(prev.trigger)
              ? [...(prev.trigger.options.categories ?? [])]
              : [],
            labels: isEmailTrigger(prev.trigger) ? [...(prev.trigger.options.labels ?? [])] : [],
            triageStates: isEmailTrigger(prev.trigger)
              ? [...(prev.trigger.options.triageStates ?? [])]
              : ["unassigned"],
          },
        } as AutomationRule["trigger"];
      } else {
        next.trigger = {
          type,
          options: {
            statuses: [],
            lanes: [],
          },
        } as AutomationRule["trigger"];
      }
      return next;
    });
  };

  const handleCategoryToggle = (category: string) => {
    setDraft((prev) => {
      if (!isEmailTrigger(prev.trigger)) return prev;
      const next = cloneRule(prev);
      if (!isEmailTrigger(next.trigger)) {
        return prev;
      }
      const categories = new Set(next.trigger.options.categories);
      if (categories.has(category)) {
        categories.delete(category);
      } else {
        categories.add(category);
      }
      next.trigger.options.categories = Array.from(categories);
      return next;
    });
  };

  const handleActionTypeChange = (type: AutomationRule["actions"][number]["type"]) => {
    setDraft((prev) => {
      const next = cloneRule(prev);
      if (next.actions.length === 0) {
        next.actions.push({ type, params: {} });
      } else {
        next.actions[0].type = type;
      }
      if (type === "create_task" && !next.actions[0].params?.title) {
        next.actions[0].params = { ...next.actions[0].params, title: "Follow up" };
      }
      return next;
    });
  };

  const handleToggleEnabled = async (rule: AutomationRule) => {
    setError(null);
    try {
      const updated = await updateAutomationRule(
        rule.id,
        {
          ...buildInput(rule),
          isEnabled: !rule.isEnabled,
        },
        accessToken
      );
      setRules((prev) => prev.map((item) => (item.id === rule.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update rule");
    }
  };

  const handleDelete = async (rule: AutomationRule) => {
    if (!confirm(`Delete automation rule "${rule.name}"?`)) {
      return;
    }
    setError(null);
    try {
      await deleteAutomationRule(rule.id, accessToken);
      setRules((prev) => prev.filter((item) => item.id !== rule.id));
      setSuccess("Rule deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rule");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    const triggerPayload = isEmailTrigger(draft.trigger)
      ? {
          type: "email_received" as const,
          options: {
            categories: draft.trigger.options.categories ?? [],
            labels: draft.trigger.options.labels ?? [],
            triageStates: draft.trigger.options.triageStates ?? [],
          },
        }
      : {
          type: "task_created" as const,
          options: {
            statuses: (draft.trigger as Extract<AutomationRule["trigger"], { type: "task_created" }>).options.statuses ?? [],
            lanes: (draft.trigger as Extract<AutomationRule["trigger"], { type: "task_created" }>).options.lanes ?? [],
          },
        };

    const payload: AutomationRuleInput = {
      ...buildInput(draft),
      trigger: triggerPayload,
      actions: draft.actions.map((action) => ({ type: action.type, params: action.params })),
    };

    try {
      if (editingRuleId) {
        const updated = await updateAutomationRule(editingRuleId, payload, accessToken);
        setRules((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setSuccess("Rule updated");
      } else {
        const created = await createAutomationRule(payload, accessToken);
        setRules((prev) => [...prev, created]);
        setSuccess("Rule created");
      }
      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  };

  const renderActionDetails = (rule: AutomationRule) => {
    if (!rule.actions.length) return "No actions";
    const action = rule.actions[0];
    switch (action.type) {
      case "create_task":
        return `Create task (${String(action.params?.title || "Follow up")})`;
      case "assign_timeline_lane":
        return `Assign timeline lane (${String(action.params?.lane || "")})`;
      case "send_email_template":
        return `Send email template (${String(action.params?.templateId || "")})`;
      default:
        return action.type;
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Automation rules</h1>
          <p className="mt-1 text-sm text-gray-600">
            Create automation rules to run playbooks when new emails or tasks arrive.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateForm}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
        >
          New rule
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}
      {success ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-gray-500">Loading automation rules…</p>
      ) : rules.length === 0 ? (
        <p className="mt-6 text-sm text-gray-500">No automation rules yet. Create one to get started.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rules.map((rule) => (
            <li key={rule.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-medium text-gray-900">{rule.name}</p>
                  <p className="mt-1 text-sm text-gray-600">{rule.description || "No description"}</p>
                  <p className="mt-2 text-xs text-gray-500">
                    Trigger: {rule.trigger.type === "email_received" ? "Email received" : "Task created"} · Actions: {renderActionDetails(rule)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(rule)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      rule.isEnabled
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                    }`}
                  >
                    {rule.isEnabled ? "Enabled" : "Disabled"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditForm(rule)}
                      className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(rule)}
                      className="rounded-md border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen ? (
        <div className="mt-10 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">
              {editingRuleId ? "Edit automation rule" : "Create automation rule"}
            </h2>
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
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Description</span>
              <input
                type="text"
                value={draft.description ?? ""}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, description: event.target.value || null }))
                }
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </label>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Trigger type</span>
              <select
                value={draft.trigger.type}
                onChange={(event) => handleTriggerTypeChange(event.target.value as AutomationTriggerType)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              >
                <option value="email_received">Email received</option>
                <option value="task_created">Task created</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-gray-700">Action</span>
              <select
                value={draft.actions[0]?.type ?? "create_task"}
                onChange={(event) => handleActionTypeChange(event.target.value as AutomationRule["actions"][number]["type"])}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              >
                <option value="create_task">Create task</option>
                <option value="assign_timeline_lane">Assign timeline lane</option>
                <option value="send_email_template">Send email template</option>
              </select>
            </label>
          </div>

          {isEmailTrigger(draft.trigger) ? (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Email categories</span>
                <input
                  type="search"
                  placeholder="Search categories"
                  value={categorySearch}
                  onChange={(event) => setCategorySearch(event.target.value)}
                  className="h-9 w-60 rounded-md border border-gray-300 px-3 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {filteredCategories.map((category) => {
                  const checked =
                    isEmailTrigger(draft.trigger) &&
                    (draft.trigger.options.categories ?? []).includes(category);
                  return (
                    <label key={category} className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleCategoryToggle(category)}
                        className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      <span>{category}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="mt-6 text-sm text-gray-500">
              Task trigger configuration will be available in a future update.
            </p>
          )}

          {draft.actions[0]?.type === "create_task" ? (
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-gray-700">Task title</span>
                <input
                  type="text"
                  value={String(draft.actions[0]?.params?.title ?? "Follow up")}
                  onChange={(event) =>
                    setDraft((prev) => {
                      const next = cloneRule(prev);
                      if (!next.actions.length) {
                        next.actions.push({ type: "create_task", params: {} });
                      }
                      next.actions[0].params = {
                        ...next.actions[0].params,
                        title: event.target.value,
                      };
                      return next;
                    })
                  }
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium text-gray-700">Task notes</span>
                <input
                  type="text"
                  value={String(draft.actions[0]?.params?.notes ?? "")}
                  onChange={(event) =>
                    setDraft((prev) => {
                      const next = cloneRule(prev);
                      if (!next.actions.length) {
                        next.actions.push({ type: "create_task", params: {} });
                      }
                      next.actions[0].params = {
                        ...next.actions[0].params,
                        notes: event.target.value,
                      };
                      return next;
                    })
                  }
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
            </div>
          ) : null}

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
              {saving ? "Saving…" : "Save rule"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

