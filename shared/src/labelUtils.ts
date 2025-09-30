import {
  CROSS_LABEL_DEFINITIONS,
  DEFAULT_EMAIL_LABELS,
  EMAIL_FALLBACK_LABEL,
} from "./types";
import type { EmailLabel } from "./types";

const FALLBACK_LABEL: EmailLabel = EMAIL_FALLBACK_LABEL;
const PRIMARY_LABEL_SET = new Set<string>(DEFAULT_EMAIL_LABELS as readonly string[]);
const PRIMARY_LABEL_KEY_LOOKUP = new Map<string, EmailLabel>(
  (DEFAULT_EMAIL_LABELS as readonly string[]).map((label) => [canonicalKey(label), label])
);
const CROSS_PREFIX_LOOKUP = new Map<string, string>(
  CROSS_LABEL_DEFINITIONS.map((definition) => [definition.prefix.toLowerCase(), definition.prefix])
);

function canonicalKey(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/\/+/g, "/")
    .replace(/[^A-Za-z0-9_\/-]/g, "_")
    .toLowerCase();
}

function sanitiseSegment(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/[^A-Za-z0-9_\/-]/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseLabelCandidate(raw: string): EmailLabel | null {
  const input = raw.trim();
  if (!input) {
    return null;
  }

  const sanitized = input
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/\/+/g, "/");

  const key = canonicalKey(sanitized);
  const directPrimary = PRIMARY_LABEL_KEY_LOOKUP.get(key);
  if (directPrimary) {
    return directPrimary;
  }

  if (sanitized.includes("/")) {
    const [prefix, ...restParts] = sanitized.split("/");
    if (restParts.length > 0) {
      const maybePrimary = PRIMARY_LABEL_KEY_LOOKUP.get(canonicalKey(`${prefix}/${restParts.join("/")}`));
      if (maybePrimary) {
        return maybePrimary;
      }

      const crossTag = normaliseCrossTag(prefix, restParts);
      if (crossTag) {
        return crossTag;
      }
    }
  }

  return null;
}

function normaliseCrossTag(prefix: string, rest: string[]): EmailLabel | null {
  const canonicalPrefix = CROSS_PREFIX_LOOKUP.get(prefix.toLowerCase());
  if (!canonicalPrefix) {
    return null;
  }

  const cleaned = rest
    .map((part) => sanitiseSegment(part))
    .filter((part) => part.length > 0);

  if (cleaned.length === 0) {
    return null;
  }

  return `${canonicalPrefix}/${cleaned.join("/")}`;
}

export function normaliseLabel(
  value: unknown,
  fallback: EmailLabel = FALLBACK_LABEL
): EmailLabel {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = parseLabelCandidate(value);
  if (parsed) {
    return parsed;
  }

  return fallback;
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
          const parsedArray = JSON.parse(trimmed);
          if (Array.isArray(parsedArray)) {
            parsedArray.forEach(visit);
            return;
          }
        } catch (error) {
          // Ignore JSON parse errors and fall through to parsing the string value directly
        }
      }

      const parsed = parseLabelCandidate(trimmed);
      if (parsed) {
        results.push(parsed);
      }
    }
  };

  visit(value);

  const deduped = Array.from(new Set(results));
  return deduped;
}

export function ensureDefaultLabelCoverage(labels: EmailLabel[]): EmailLabel[] {
  const deduped = Array.from(new Set(labels));

  if (deduped.length === 0) {
    return deduped;
  }

  const hasPrimary = deduped.some(
    (label) => PRIMARY_LABEL_SET.has(label) && label !== FALLBACK_LABEL
  );

  if (!hasPrimary && !deduped.includes(FALLBACK_LABEL)) {
    deduped.push(FALLBACK_LABEL);
  }

  return deduped;
}

export function selectPrimaryCategory(labels: EmailLabel[]): EmailLabel | null {
  if (labels.length === 0) {
    return null;
  }

  const preferred = labels.find(
    (label) => PRIMARY_LABEL_SET.has(label) && label !== FALLBACK_LABEL
  );

  if (preferred) {
    return preferred;
  }

  if (labels.includes(FALLBACK_LABEL)) {
    return FALLBACK_LABEL;
  }

  const anyPrimary = labels.find((label) => PRIMARY_LABEL_SET.has(label));
  if (anyPrimary) {
    return anyPrimary;
  }

  return labels[0] ?? null;
}
