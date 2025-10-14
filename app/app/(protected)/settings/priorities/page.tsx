"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PRIORITY_CONFIG,
  PRIMARY_LABEL_DEFINITIONS,
  clonePriorityConfig,
  isPriorityConfigEqual,
  normalizePriorityConfigInput,
  type PriorityConfig,
  type PriorityEmailCrossLabelRule,
} from "@kazador/shared";
import { useAuth } from "@/components/AuthProvider";
import {
  applyPriorityPreset,
  fetchPriorityConfig,
  fetchPriorityConfigPresets,
  resetPriorityConfig,
  updatePriorityConfig,
  type PriorityConfigPayload,
  type PriorityConfigPresetSummary,
} from "@/lib/priorityConfigClient";

interface CategoryGroup {
  name: string;
  categories: Array<{ name: string; meaning: string; weight: number }>;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Never saved";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function weightToColor(weight: number): string {
  if (weight >= 80) return "bg-rose-500";
  if (weight >= 60) return "bg-amber-500";
  if (weight >= 40) return "bg-yellow-400";
  if (weight >= 20) return "bg-lime-400";
  return "bg-emerald-400";
}

function buildCategoryGroups(
  weights: Record<string, number>,
  filter: string
): CategoryGroup[] {
  const query = filter.trim().toLowerCase();
  const grouped = new Map<string, CategoryGroup>();

  for (const definition of PRIMARY_LABEL_DEFINITIONS) {
    const prefix = definition.name.split("/")[0];
    const weight = weights[definition.name] ?? DEFAULT_PRIORITY_CONFIG.email.categoryWeights[definition.name] ?? 0;
    const matches =
      !query ||
      definition.name.toLowerCase().includes(query) ||
      definition.meaning.toLowerCase().includes(query);
    if (!matches) {
      continue;
    }
    const group = grouped.get(prefix) ?? { name: prefix, categories: [] };
    group.categories.push({ name: definition.name, meaning: definition.meaning, weight });
    grouped.set(prefix, group);
  }

  return Array.from(grouped.values()).map((group) => ({
    name: group.name,
    categories: group.categories.sort((a, b) => b.weight - a.weight),
  }));
}

export default function PrioritySettingsPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [payload, setPayload] = useState<PriorityConfigPayload | null>(null);
  const [config, setConfig] = useState<PriorityConfig>(() => clonePriorityConfig(DEFAULT_PRIORITY_CONFIG));
  const [baselineConfig, setBaselineConfig] = useState<PriorityConfig>(() =>
    clonePriorityConfig(DEFAULT_PRIORITY_CONFIG)
  );
  const [presets, setPresets] = useState<PriorityConfigPresetSummary[]>([]);
  const [presetLoading, setPresetLoading] = useState(true);
  const [presetError, setPresetError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPresetLoading(true);
    setPresetError(null);

    fetchPriorityConfig(accessToken)
      .then((response) => {
        if (cancelled) return;
        setPayload(response);
        setBaselineConfig(clonePriorityConfig(response.config));
        setConfig(clonePriorityConfig(response.config));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load configuration");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    fetchPriorityConfigPresets(accessToken)
      .then((response) => {
        if (cancelled) return;
        setPresets(response);
      })
      .catch((err) => {
        if (cancelled) return;
        setPresetError(err instanceof Error ? err.message : "Failed to load presets");
      })
      .finally(() => {
        if (!cancelled) {
          setPresetLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const categoryGroups = useMemo(
    () => buildCategoryGroups(config.email.categoryWeights, searchTerm),
    [config.email.categoryWeights, searchTerm]
  );

  const hasChanges = useMemo(() => !isPriorityConfigEqual(config, baselineConfig), [config, baselineConfig]);

  const handleResetAll = async () => {
    if (!accessToken) {
      setError("Authentication required");
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Reset all priority settings to their default values? This will immediately save the change."
      );
      if (!confirmed) {
        return;
      }
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await resetPriorityConfig({}, accessToken);
      setPayload(response);
      setBaselineConfig(clonePriorityConfig(response.config));
      setConfig(clonePriorityConfig(response.config));
      if (response.resetCategories && response.resetCategories.length > 0) {
        setSuccess(`Reset ${response.resetCategories.length} categories to defaults.`);
      } else {
        setSuccess("Priority configuration reset to defaults.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset configuration");
    } finally {
      setSaving(false);
    }
  };

  const updateCategoryWeight = (name: string, weight: number) => {
    setConfig((prev) => {
      if (!Number.isFinite(weight)) {
        return prev;
      }
      const next = clonePriorityConfig(prev);
      const clamped = Math.max(0, Math.min(100, Math.round(weight)));
      next.email.categoryWeights[name] = clamped;
      return next;
    });
  };

  const resetCategoryWeight = (name: string) => {
    const fallback = DEFAULT_PRIORITY_CONFIG.email.categoryWeights[name] ?? DEFAULT_PRIORITY_CONFIG.email.defaultCategoryWeight;
    updateCategoryWeight(name, fallback);
  };

  const updateTimeSetting = (key: keyof PriorityConfig["time"], value: number) => {
    setConfig((prev) => {
      if (!Number.isFinite(value)) {
        return prev;
      }
      const next = clonePriorityConfig(prev);
      next.time[key] = value;
      return next;
    });
  };

  const updateEmailSetting = (key: keyof PriorityConfig["email"], value: number) => {
    setConfig((prev) => {
      if (!Number.isFinite(value)) {
        return prev;
      }
      const next = clonePriorityConfig(prev);
      if (key === "modelPriorityWeight" || key === "snoozeAgeReduction") {
        next.email[key] = Math.max(0, Math.min(1, value));
      } else if (key === "unreadBonus" || key === "defaultCategoryWeight") {
        next.email[key] = Math.max(0, Math.min(100, Math.round(value)));
      }
      return next;
    });
  };

  const updateTimelineSetting = (key: keyof PriorityConfig["timeline"], value: number) => {
    setConfig((prev) => {
      if (!Number.isFinite(value)) {
        return prev;
      }
      const next = clonePriorityConfig(prev);
      if (key === "manualPriorityWeight") {
        next.timeline[key] = Math.max(0, Math.min(1, value));
      } else if (key === "undatedValue") {
        next.timeline[key] = Math.max(0, Math.min(100, Math.round(value)));
      }
      return next;
    });
  };

  const updateTimelinePenalty = (key: keyof PriorityConfig["timeline"]["conflictPenalties"], value: number) => {
    setConfig((prev) => {
      if (!Number.isFinite(value)) {
        return prev;
      }
      const next = clonePriorityConfig(prev);
      next.timeline.conflictPenalties[key] = Math.max(0, Math.min(200, Math.round(value)));
      return next;
    });
  };

  const updateDependencyPenalty = (key: keyof PriorityConfig["timeline"]["dependencyPenalties"], value: number) => {
    setConfig((prev) => {
      if (!Number.isFinite(value)) {
        return prev;
      }
      const next = clonePriorityConfig(prev);
      next.timeline.dependencyPenalties[key] = Math.max(0, Math.min(200, Math.round(value)));
      return next;
    });
  };

  const updateTaskSetting = (key: keyof PriorityConfig["tasks"], value: number) => {
    setConfig((prev) => {
      if (!Number.isFinite(value)) {
        return prev;
      }
      const next = clonePriorityConfig(prev);
      if (key === "manualPriorityWeight") {
        next.tasks[key] = Math.max(0, Math.min(1, value));
      } else if (key === "noDueDateValue") {
        next.tasks[key] = Math.max(0, Math.min(100, Math.round(value)));
      }
      return next;
    });
  };

  const updateCrossLabelRule = (
    index: number,
    updater: (rule: PriorityEmailCrossLabelRule) => PriorityEmailCrossLabelRule
  ) => {
    setConfig((prev) => {
      const next = clonePriorityConfig(prev);
      const rules = [...next.email.crossLabelRules];
      const existing = rules[index];
      if (!existing) {
        return prev;
      }
      rules[index] = updater({ ...existing });
      next.email.crossLabelRules = rules;
      return next;
    });
  };

  const addCrossLabelRule = () => {
    setConfig((prev) => {
      const next = clonePriorityConfig(prev);
      next.email.crossLabelRules = [
        ...next.email.crossLabelRules,
        {
          prefix: "",
          description: "",
          weight: 0,
          caseInsensitive: true,
        },
      ];
      return next;
    });
  };

  const removeCrossLabelRule = (index: number) => {
    setConfig((prev) => {
      const next = clonePriorityConfig(prev);
      next.email.crossLabelRules = next.email.crossLabelRules.filter((_, i) => i !== index);
      return next;
    });
  };

  const handleApplyPreset = async (slug: string) => {
    if (!accessToken) {
      setError("Authentication required");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await applyPriorityPreset(slug, accessToken);
      setPayload(response);
      setBaselineConfig(clonePriorityConfig(response.config));
      setConfig(clonePriorityConfig(response.config));
      if (response.preset?.name) {
        setSuccess(`${response.preset.name} preset applied.`);
      } else {
        setSuccess("Preset applied.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply preset");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    try {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const timestamp = new Date().toISOString().slice(0, 10);
      anchor.download = `priority-config-${timestamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccess("Priority configuration exported.");
    } catch (err) {
      setError("Failed to export configuration");
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalized = normalizePriorityConfigInput(parsed);
      setConfig(clonePriorityConfig(normalized));
      setSuccess("Imported configuration. Review changes and save to apply.");
      setError(null);
    } catch (err) {
      setError("Failed to import configuration. Please provide a valid Kazador export.");
    }
  };

  const triggerImport = () => {
    fileInputRef.current?.click();
  };

  const handleSave = async () => {
    if (!accessToken) {
      setError("Authentication required");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await updatePriorityConfig(config, accessToken);
      setPayload(response);
      setBaselineConfig(clonePriorityConfig(response.config));
      setConfig(clonePriorityConfig(response.config));
      setSuccess("Priority configuration saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  if (!accessToken) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">Priority settings</h1>
        <p className="text-sm text-gray-600">
          You need to be signed in to manage priority configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={handleImportFile}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Priority settings</h1>
          <p className="text-sm text-gray-600">
            Tune how Kazador ranks projects, emails, and tasks across the workspace.
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Last updated: {formatTimestamp(payload?.updatedAt ?? null)} • Source: {payload?.source ?? "default"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={triggerImport}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Import JSON
          </button>
          <button
            type="button"
            onClick={handleResetAll}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || saving || loading}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm transition ${
              hasChanges && !saving && !loading
                ? "bg-gray-900 hover:bg-gray-700"
                : "bg-gray-400 cursor-not-allowed"
            }`}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>
      ) : null}

      <section className="space-y-4">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Category weights</h2>
            <p className="text-sm text-gray-600">
              Adjust urgency for each primary label. Higher values surface sooner in inbox and digest views.
            </p>
          </div>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search categories"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 sm:w-64"
          />
        </header>
        {loading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">Loading configuration…</div>
        ) : categoryGroups.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
            No categories match that filter.
          </div>
        ) : (
          <div className="space-y-6">
            {categoryGroups.map((group) => (
              <div key={group.name} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900">{group.name}</h3>
                <div className="mt-4 space-y-4">
                  {group.categories.map((category) => (
                    <div
                      key={category.name}
                      className="flex flex-col gap-3 rounded border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{category.name}</p>
                        <p className="text-xs text-gray-500">{category.meaning}</p>
                      </div>
                      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-10 rounded-full ${weightToColor(category.weight)}`} aria-hidden />
                          <span className="text-sm font-semibold text-gray-900">{category.weight}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={category.weight}
                          onChange={(event) => updateCategoryWeight(category.name, Number(event.target.value))}
                          className="h-2 w-48 cursor-pointer rounded-lg bg-gray-200"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={category.weight}
                            onChange={(event) => updateCategoryWeight(category.name, Number(event.target.value))}
                            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                          />
                          <button
                            type="button"
                            onClick={() => resetCategoryWeight(category.name)}
                            className="text-xs font-medium text-gray-500 hover:text-gray-900"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Presets &amp; shortcuts</h2>
            <p className="text-sm text-gray-600">
              Apply curated configurations for common seasons. Presets save immediately and can be tweaked afterward.
            </p>
          </div>
        </header>
        {presetError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{presetError}</div>
        ) : null}
        {presetLoading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">Loading presets…</div>
        ) : presets.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
            No presets are available yet.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {presets.map((preset) => (
              <div
                key={preset.slug}
                className="flex h-full flex-col justify-between rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="space-y-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{preset.name}</h3>
                    <p className="text-sm text-gray-600">{preset.description}</p>
                  </div>
                  {preset.recommendedScenarios.length > 0 ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Best for</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-500">
                        {preset.recommendedScenarios.map((scenario) => (
                          <li key={scenario}>{scenario}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {preset.adjustments.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {preset.adjustments.map((item) => (
                        <span
                          key={item}
                          className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => handleApplyPreset(preset.slug)}
                  disabled={saving || loading}
                  className={`mt-4 w-full rounded-md px-3 py-2 text-sm font-semibold text-white shadow-sm transition ${
                    !saving && !loading ? "bg-gray-900 hover:bg-gray-700" : "bg-gray-400 cursor-not-allowed"
                  }`}
                >
                  Apply preset
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-semibold text-gray-900">Age &amp; time factors</h2>
          <p className="text-sm text-gray-600">
            Control how urgency increases as deadlines approach or emails go stale.
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Upcoming decay per day</h3>
            <p className="mt-1 text-xs text-gray-500">How quickly upcoming tasks lose urgency each day.</p>
            <input
              type="number"
              min={0}
              max={50}
              value={config.time.upcomingDecayPerDay}
              onChange={(event) => updateTimeSetting("upcomingDecayPerDay", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Overdue penalty per day</h3>
            <p className="mt-1 text-xs text-gray-500">Extra urgency added for each day an item is overdue.</p>
            <input
              type="number"
              min={0}
              max={100}
              value={config.time.overduePenaltyPerDay}
              onChange={(event) => updateTimeSetting("overduePenaltyPerDay", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Email idle multiplier</h3>
            <p className="mt-1 text-xs text-gray-500">Multiplier for long-running idle threads.</p>
            <input
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={config.email.idleAge.longWindowMultiplier}
              onChange={(event) =>
                setConfig((prev) => {
                  const nextValue = Number(event.target.value);
                  if (!Number.isFinite(nextValue)) {
                    return prev;
                  }
                  const next = clonePriorityConfig(prev);
                  next.email.idleAge.longWindowMultiplier = Math.max(0, nextValue);
                  return next;
                })
              }
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Unread inbox bonus</h3>
            <p className="mt-1 text-xs text-gray-500">Boost applied to unread emails waiting in the inbox.</p>
            <input
              type="number"
              min={0}
              max={200}
              value={config.email.unreadBonus}
              onChange={(event) => updateEmailSetting("unreadBonus", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-semibold text-gray-900">Manual weighting</h2>
          <p className="text-sm text-gray-600">Balance human-set priorities with automated scoring.</p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Model priority influence</h3>
            <p className="mt-1 text-xs text-gray-500">Blend AI priority scores into email rankings (0 = ignore AI, 1 = full weight).</p>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={config.email.modelPriorityWeight}
              onChange={(event) => updateEmailSetting("modelPriorityWeight", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Snoozed email reduction</h3>
            <p className="mt-1 text-xs text-gray-500">How much to down-rank snoozed threads while they sleep.</p>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={config.email.snoozeAgeReduction}
              onChange={(event) => updateEmailSetting("snoozeAgeReduction", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Task manual priority weight</h3>
            <p className="mt-1 text-xs text-gray-500">Influence of human-set task priority versus automatic scoring.</p>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={config.tasks.manualPriorityWeight}
              onChange={(event) => updateTaskSetting("manualPriorityWeight", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Timeline manual priority weight</h3>
            <p className="mt-1 text-xs text-gray-500">Weight given to manual timeline priority adjustments.</p>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={config.timeline.manualPriorityWeight}
              onChange={(event) => updateTimelineSetting("manualPriorityWeight", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <header>
          <h2 className="text-xl font-semibold text-gray-900">Conflict &amp; dependency penalties</h2>
          <p className="text-sm text-gray-600">Adjust how the timeline penalises conflicts and blocking items.</p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Default conflict penalty</h3>
            <input
              type="number"
              min={0}
              max={200}
              value={config.timeline.conflictPenalties.default}
              onChange={(event) => updateTimelinePenalty("default", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Severe conflict penalty</h3>
            <input
              type="number"
              min={0}
              max={200}
              value={config.timeline.conflictPenalties.error}
              onChange={(event) => updateTimelinePenalty("error", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Blocking dependency boost</h3>
            <input
              type="number"
              min={0}
              max={200}
              value={config.timeline.dependencyPenalties.finishToStart}
              onChange={(event) => updateDependencyPenalty("finishToStart", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Other dependency penalty</h3>
            <input
              type="number"
              min={0}
              max={200}
              value={config.timeline.dependencyPenalties.other}
              onChange={(event) => updateDependencyPenalty("other", Number(event.target.value))}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Cross-label boosts</h2>
            <p className="text-sm text-gray-600">
              Configure additional boosts when secondary labels like approvals or risk flags are present.
            </p>
          </div>
          <button
            type="button"
            onClick={addCrossLabelRule}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Add rule
          </button>
        </header>
        <div className="space-y-4">
          {config.email.crossLabelRules.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm">
              No cross-label rules configured.
            </div>
          ) : (
            config.email.crossLabelRules.map((rule, index) => (
              <div key={`${rule.prefix}-${index}`} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex-1 space-y-3">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Prefix</label>
                      <input
                        type="text"
                        value={rule.prefix}
                        onChange={(event) =>
                          updateCrossLabelRule(index, (current) => ({ ...current, prefix: event.target.value }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Description</label>
                      <input
                        type="text"
                        value={rule.description}
                        onChange={(event) =>
                          updateCrossLabelRule(index, (current) => ({ ...current, description: event.target.value }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-3 md:w-48">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Weight</label>
                      <input
                        type="number"
                        min={-200}
                        max={200}
                        value={rule.weight}
                        onChange={(event) =>
                          updateCrossLabelRule(index, (current) => ({
                            ...current,
                            weight: (() => {
                              const parsed = Number(event.target.value);
                              if (!Number.isFinite(parsed)) {
                                return current.weight;
                              }
                              return Math.max(-200, Math.min(200, Math.round(parsed)));
                            })(),
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={rule.caseInsensitive}
                        onChange={(event) =>
                          updateCrossLabelRule(index, (current) => ({
                            ...current,
                            caseInsensitive: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                      />
                      Case insensitive match
                    </label>
                    <button
                      type="button"
                      onClick={() => removeCrossLabelRule(index)}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
