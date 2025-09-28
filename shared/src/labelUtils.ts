import { DEFAULT_EMAIL_LABELS } from "./types";
import type { EmailLabel } from "./types";

const FALLBACK_LABEL: EmailLabel = "other";
const KNOWN_DEFAULT_LABELS = new Set<string>(DEFAULT_EMAIL_LABELS as readonly string[]);

export function normaliseLabel(
  value: unknown,
  fallback: EmailLabel = FALLBACK_LABEL
): EmailLabel {
  if (typeof value !== "string") {
    return fallback;
  }

  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .trim();

  if (!slug) {
    return fallback;
  }

  if (slug === "general" || slug === "uncategorized" || slug === "uncategorised") {
    return "other";
  }

  return slug;
}

export function normaliseLabels(value: unknown): EmailLabel[] {
  const results: EmailLabel[] = [];

  const visit = (input: unknown) => {
    if (input == null) {
      return;
    }

    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) {
        return;
      }

      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            parsed.forEach(visit);
            return;
          }
        } catch (err) {
          // Ignore JSON parse errors and fall through to slugify
        }
      }

      results.push(normaliseLabel(trimmed));
      return;
    }
  };

  visit(value);

  const deduped = Array.from(new Set(results.filter(Boolean)));
  return deduped;
}

export function ensureDefaultLabelCoverage(labels: EmailLabel[]): EmailLabel[] {
  const deduped = Array.from(new Set(labels));

  if (deduped.length === 0) {
    return deduped;
  }

  const hasDefault = deduped.some((label) => KNOWN_DEFAULT_LABELS.has(label));
  const hasUnknown = deduped.some((label) => !KNOWN_DEFAULT_LABELS.has(label));

  if ((!hasDefault || hasUnknown) && !deduped.includes("other")) {
    deduped.push("other");
  }

  return deduped;
}

export function selectPrimaryCategory(labels: EmailLabel[]): EmailLabel | null {
  if (labels.length === 0) {
    return null;
  }

  const preferred = labels.find(
    (label) => KNOWN_DEFAULT_LABELS.has(label) && label !== "other"
  );

  if (preferred) {
    return preferred;
  }

  if (labels.includes("other")) {
    return "other";
  }

  return labels[0] ?? null;
}
