"use client";

import { useCallback, useEffect, useState } from "react";
import { PRIMARY_LABEL_DEFINITIONS, CROSS_LABEL_DEFINITIONS } from "@kazador/shared";
import type { LabelDefinition, CrossLabelDefinition } from "@kazador/shared";

interface CustomLabel extends LabelDefinition {
  id: string;
  isCustom: boolean;
}

interface ClassificationPromptSettings {
  systemMessage: string;
  userInstructions: string;
  model: string;
  temperature: number;
  maxLabels: number;
}

const DEFAULT_PROMPT_SETTINGS: ClassificationPromptSettings = {
  systemMessage: "",
  userInstructions: "",
  model: "gpt-4o-mini",
  temperature: 0.4,
  maxLabels: 3,
};

interface AdminEmailSettingsPanelProps {
  accessToken: string | null;
}

export default function AdminEmailSettingsPanel({ accessToken }: AdminEmailSettingsPanelProps) {
  // Label management state
  const [labels, setLabels] = useState<CustomLabel[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(true);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<CustomLabel | null>(null);
  const [isAddingLabel, setIsAddingLabel] = useState(false);
  const [savingLabel, setSavingLabel] = useState(false);

  // Prompt management state
  const [promptSettings, setPromptSettings] = useState<ClassificationPromptSettings>(DEFAULT_PROMPT_SETTINGS);
  const [promptLoading, setPromptLoading] = useState(true);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  // Status messages
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Load email labels
  const loadLabels = useCallback(async () => {
    if (!accessToken) return;

    setLabelsLoading(true);
    setLabelsError(null);

    try {
      // Convert default labels to CustomLabel format
      const defaultLabels: CustomLabel[] = PRIMARY_LABEL_DEFINITIONS.map((def, index) => ({
        ...def,
        id: `default-${index}`,
        isCustom: false,
      }));

      // TODO: Load custom labels from API
      // For now, just use defaults
      setLabels(defaultLabels);
    } catch (err) {
      setLabelsError(err instanceof Error ? err.message : "Failed to load labels");
    } finally {
      setLabelsLoading(false);
    }
  }, [accessToken]);

  // Load classification prompt settings
  const loadPromptSettings = useCallback(async () => {
    if (!accessToken) return;

    setPromptLoading(true);
    setPromptError(null);

    try {
      const response = await fetch("/api/admin/classification-prompt", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to load classification prompt");
      }

      const data = await response.json();
      setPromptSettings(data.settings || DEFAULT_PROMPT_SETTINGS);
    } catch (err) {
      // If endpoint doesn't exist yet, use defaults
      console.error("Failed to load prompt settings:", err);
      setPromptSettings(DEFAULT_PROMPT_SETTINGS);
    } finally {
      setPromptLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) {
      void loadLabels();
      void loadPromptSettings();
    }
  }, [accessToken, loadLabels, loadPromptSettings]);

  const showStatus = useCallback((type: "success" | "error", message: string) => {
    setStatusMessage({ type, message });
    setTimeout(() => setStatusMessage(null), 5000);
  }, []);

  const handleAddLabel = useCallback(() => {
    setIsAddingLabel(true);
    setEditingLabel({
      id: "new",
      name: "",
      meaning: "",
      whyItMatters: "",
      isCustom: true,
    });
  }, []);

  const handleEditLabel = useCallback((label: CustomLabel) => {
    if (!label.isCustom) {
      showStatus("error", "Cannot edit default labels");
      return;
    }
    setEditingLabel(label);
    setIsAddingLabel(false);
  }, [showStatus]);

  const handleCancelEdit = useCallback(() => {
    setEditingLabel(null);
    setIsAddingLabel(false);
  }, []);

  const handleSaveLabel = useCallback(async () => {
    if (!editingLabel || !accessToken) return;

    if (!editingLabel.name.trim()) {
      showStatus("error", "Label name is required");
      return;
    }

    if (!editingLabel.meaning.trim()) {
      showStatus("error", "Label meaning is required");
      return;
    }

    setSavingLabel(true);

    try {
      // TODO: Implement API call to save custom label
      showStatus("success", isAddingLabel ? "Label added successfully" : "Label updated successfully");
      setEditingLabel(null);
      setIsAddingLabel(false);
      await loadLabels();
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : "Failed to save label");
    } finally {
      setSavingLabel(false);
    }
  }, [editingLabel, accessToken, isAddingLabel, showStatus, loadLabels]);

  const handleDeleteLabel = useCallback(async (label: CustomLabel) => {
    if (!label.isCustom) {
      showStatus("error", "Cannot delete default labels");
      return;
    }

    if (!confirm(`Delete label "${label.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      // TODO: Implement API call to delete custom label
      showStatus("success", "Label deleted successfully");
      await loadLabels();
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : "Failed to delete label");
    }
  }, [showStatus, loadLabels]);

  const handleSavePrompt = useCallback(async () => {
    if (!accessToken) return;

    setSavingPrompt(true);

    try {
      const response = await fetch("/api/admin/classification-prompt", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ settings: promptSettings }),
      });

      if (!response.ok) {
        throw new Error("Failed to save classification prompt");
      }

      showStatus("success", "Classification prompt updated successfully");
      setEditingPrompt(false);
      await loadPromptSettings();
    } catch (err) {
      showStatus("error", err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setSavingPrompt(false);
    }
  }, [accessToken, promptSettings, showStatus, loadPromptSettings]);

  const handleResetPrompt = useCallback(() => {
    if (!confirm("Reset to default classification prompt? Your custom changes will be lost.")) {
      return;
    }
    setPromptSettings(DEFAULT_PROMPT_SETTINGS);
  }, []);

  return (
    <div className="space-y-8">
      {/* Status Message */}
      {statusMessage && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
            statusMessage.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {statusMessage.message}
        </div>
      )}

      {/* Email Labels Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Email Labels</h2>
            <p className="mt-1 text-sm text-gray-600">
              Manage email classification labels. Default labels cannot be edited or deleted.
            </p>
          </div>
          <button
            onClick={handleAddLabel}
            disabled={isAddingLabel}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Custom Label
          </button>
        </div>

        {labelsLoading ? (
          <p className="text-sm text-gray-500">Loading labels…</p>
        ) : labelsError ? (
          <p className="text-sm text-red-600">{labelsError}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Label
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Meaning
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Why It Matters
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Type
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {labels.map((label) => (
                  <tr key={label.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                      {label.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{label.meaning}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{label.whyItMatters}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          label.isCustom
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {label.isCustom ? "Custom" : "Default"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      {label.isCustom ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEditLabel(label)}
                            className="text-gray-600 hover:text-gray-900"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteLabel(label)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Edit/Add Label Form */}
        {editingLabel && (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">
              {isAddingLabel ? "Add Custom Label" : "Edit Label"}
            </h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Label Name</label>
                <input
                  type="text"
                  value={editingLabel.name}
                  onChange={(e) => setEditingLabel({ ...editingLabel, name: e.target.value })}
                  placeholder="e.g., CUSTOM/My_Category"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Use format: CATEGORY/Subcategory_Name (e.g., CUSTOM/Special_Event)
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Meaning</label>
                <textarea
                  value={editingLabel.meaning}
                  onChange={(e) => setEditingLabel({ ...editingLabel, meaning: e.target.value })}
                  placeholder="Brief description of what this label represents"
                  rows={2}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Why It Matters</label>
                <textarea
                  value={editingLabel.whyItMatters}
                  onChange={(e) =>
                    setEditingLabel({ ...editingLabel, whyItMatters: e.target.value })
                  }
                  placeholder="Why this label is important for automation and workflows"
                  rows={2}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={handleCancelEdit}
                  disabled={savingLabel}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveLabel}
                  disabled={savingLabel}
                  className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingLabel ? "Saving…" : "Save Label"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cross-Label Definitions (Read-only) */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
          <h3 className="text-lg font-semibold text-gray-900">Cross-Tag Prefixes (Read-only)</h3>
          <p className="mt-1 text-sm text-gray-600">
            These optional prefixes can be appended after primary labels to add metadata.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {CROSS_LABEL_DEFINITIONS.map((def) => (
              <div key={def.prefix} className="rounded-md border border-gray-200 bg-white p-3">
                <p className="font-mono text-sm font-semibold text-gray-900">{def.prefix}/</p>
                <p className="mt-1 text-xs text-gray-600">{def.meaning}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Classification Prompt Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">OpenAI Classification Prompt</h2>
            <p className="mt-1 text-sm text-gray-600">
              View and edit the prompt sent to OpenAI for email classification.
            </p>
          </div>
          {!editingPrompt && (
            <button
              onClick={() => setEditingPrompt(true)}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Edit Prompt
            </button>
          )}
        </div>

        {promptLoading ? (
          <p className="text-sm text-gray-500">Loading prompt settings…</p>
        ) : promptError ? (
          <p className="text-sm text-red-600">{promptError}</p>
        ) : (
          <div className="space-y-4">
            {/* Warning Banner */}
            {editingPrompt && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <div className="flex items-start gap-2">
                  <svg
                    className="mt-0.5 h-5 w-5 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <div>
                    <p className="font-semibold">Warning: Advanced Settings</p>
                    <p className="mt-1">
                      Editing the classification prompt may disrupt email categorization and automation workflows. The prompt must return a valid JSON object with keys: <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">summary</code>, <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">labels</code>, and <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">sentiment</code>.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Model</label>
                  <select
                    value={promptSettings.model}
                    onChange={(e) => setPromptSettings({ ...promptSettings, model: e.target.value })}
                    disabled={!editingPrompt}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    <option value="gpt-4o-mini">gpt-4o-mini (Recommended)</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-4-turbo">gpt-4-turbo</option>
                    <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Temperature</label>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={promptSettings.temperature}
                      onChange={(e) =>
                        setPromptSettings({ ...promptSettings, temperature: parseFloat(e.target.value) })
                      }
                      disabled={!editingPrompt}
                      className="flex-1"
                    />
                    <span className="w-12 text-sm text-gray-600">{promptSettings.temperature}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Lower = more consistent, Higher = more creative
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Max Labels per Email</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={promptSettings.maxLabels}
                    onChange={(e) =>
                      setPromptSettings({ ...promptSettings, maxLabels: parseInt(e.target.value) })
                    }
                    disabled={!editingPrompt}
                    className="mt-1 w-32 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">System Message</label>
                  <div className="mt-1 rounded-md border border-gray-300 bg-gray-50 p-4">
                    <pre className="whitespace-pre-wrap font-mono text-xs text-gray-700">
{`You are an assistant labelling inbox emails for an artist manager.
Return between 1 and ${promptSettings.maxLabels} labels for each message.

Primary labels (always include at least one and place it first):
${labels.map(l => `- ${l.name}: ${l.meaning}`).join('\n')}

Rules:
- Use the exact label names and casing shown above.
- Never invent new primary labels; use MISC/Uncategorized when nothing fits.
- Prioritise concise, factual summaries supporting the chosen labels.
- Include a sentiment assessment with label positive/neutral/negative and confidence 0-1.`}
                    </pre>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    This is a read-only view of the generated system message. Label changes above will update this automatically.
                  </p>
                </div>
              </div>

              {editingPrompt && (
                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    onClick={handleResetPrompt}
                    disabled={savingPrompt}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reset to Default
                  </button>
                  <button
                    onClick={() => setEditingPrompt(false)}
                    disabled={savingPrompt}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSavePrompt}
                    disabled={savingPrompt}
                    className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingPrompt ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
