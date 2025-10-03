import { normaliseLabels } from "./labelUtils";
import type { ProjectRecord } from "./types";

export interface EmailSuggestionInput {
  subject: string;
  summary?: string | null;
  labels?: unknown;
  fromEmail?: string | null;
  fromName?: string | null;
  category?: string | null;
  receivedAt?: string | null;
}

export interface SuggestedTimelineItemPayload {
  title: string;
  type: string;
  lane?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface ProjectSuggestion {
  project: ProjectRecord;
  score: number;
  confidence: number;
  rationales: string[];
  timelineItem?: SuggestedTimelineItemPayload | null;
}

export interface SuggestProjectsOptions {
  limit?: number;
  threshold?: number;
}

interface ScoreContribution {
  label: string;
  delta: number;
}

interface LabelEntry {
  prefix: string;
  value: string;
  raw: string;
}

interface ProjectMetadataIndex {
  keywords: Set<string>;
  labelValues: Set<string>;
  domainValues: Set<string>;
  territoryValues: Set<string>;
}

const SUBJECT_NAME_WEIGHT = 32;
const SUBJECT_SLUG_WEIGHT = 28;
const SUBJECT_KEYWORD_WEIGHT = 12;
const SUMMARY_KEYWORD_WEIGHT = 8;
const LABEL_OVERLAP_WEIGHT = 18;
const PROJECT_LABEL_MATCH_WEIGHT = 60;
const TERRITORY_MATCH_WEIGHT = 22;
const ARTIST_LABEL_WEIGHT = 20;
const DOMAIN_MATCH_WEIGHT = 18;
const CATEGORY_BONUS = new Map<string, number>([
  ["logistics", 12],
  ["promo", 10],
  ["booking", 14],
  ["finance", 6],
]);

function toLabelEntry(label: string): LabelEntry {
  const [prefix, ...rest] = label.split("/");
  const normalizedPrefix = prefix?.toLowerCase() ?? "";
  const normalizedValue = rest.join("/").toLowerCase();
  return { prefix: normalizedPrefix, value: normalizedValue, raw: label.toLowerCase() };
}

function collectKeywordsFromValue(value: unknown, keywords: Set<string>): void {
  if (value == null) return;

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeywordsFromValue(entry, keywords);
    }
    return;
  }

  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectKeywordsFromValue(entry, keywords);
    }
    return;
  }

  if (typeof value === "string") {
    const token = value.trim().toLowerCase();
    if (!token) return;
    keywords.add(token);
    for (const part of token.split(/[^a-z0-9]+/g)) {
      if (part.length >= 3) {
        keywords.add(part);
      }
    }
    return;
  }

  if (typeof value === "number") {
    keywords.add(String(value));
  }
}

function collectProjectMetadata(labels: Record<string, unknown> | null | undefined): ProjectMetadataIndex {
  const index: ProjectMetadataIndex = {
    keywords: new Set<string>(),
    labelValues: new Set<string>(),
    domainValues: new Set<string>(),
    territoryValues: new Set<string>(),
  };

  const visit = (value: unknown, keyPath: string[] = []) => {
    if (value == null) return;

    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, keyPath));
      return;
    }

    if (typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        visit(entry, [...keyPath, key]);
      }
      return;
    }

    if (typeof value === "string" || typeof value === "number") {
      const raw = String(value).trim();
      if (!raw) return;

      const lowered = raw.toLowerCase();
      index.labelValues.add(lowered);
      collectKeywordsFromValue(lowered, index.keywords);

      const keyHint = keyPath.join(".").toLowerCase();
      if (keyHint.includes("domain") || keyHint.includes("email")) {
        index.domainValues.add(lowered);
      }
      if (
        keyHint.includes("territory") ||
        keyHint.includes("region") ||
        keyHint.includes("market") ||
        keyHint.includes("country") ||
        keyHint.includes("city")
      ) {
        index.territoryValues.add(lowered);
      }
    }
  };

  visit(labels ?? {});
  return index;
}

function formatRationale(contributions: ScoreContribution[]): string[] {
  if (contributions.length === 0) {
    return ["No heuristics matched"];
  }

  return contributions
    .filter((entry) => Math.round(entry.delta) !== 0)
    .map((entry) => {
      const rounded = Math.round(entry.delta);
      const sign = rounded > 0 ? "+" : "";
      return `${entry.label} (${sign}${rounded})`;
    });
}

function addContribution(
  contributions: ScoreContribution[],
  label: string,
  delta: number
) {
  if (delta === 0) return;
  contributions.push({ label, delta });
}

function buildTimelineSuggestion(
  subject: string,
  category: string | null | undefined,
  labels: LabelEntry[],
  receivedAt?: string | null
): SuggestedTimelineItemPayload | null {
  const normalisedCategory = category?.toLowerCase() ?? "";
  const title = subject || "Email follow-up";

  if (normalisedCategory.startsWith("promo/promo_time_request")) {
    return {
      title,
      type: "event",
      lane: "Promo",
      priority: 65,
      metadata: { category },
    };
  }

  if (normalisedCategory.startsWith("logistics/")) {
    return {
      title,
      type: "milestone",
      lane: "Live",
      startsAt: receivedAt ?? null,
      priority: 55,
      metadata: { category },
    };
  }

  if (
    normalisedCategory === "booking/offer" ||
    normalisedCategory === "booking/hold_or_availability" ||
    normalisedCategory === "booking/confirmation"
  ) {
    return {
      title,
      type: "lead",
      lane: "Live",
      priority: 70,
      metadata: { category },
    };
  }

  const labelPrefixes = new Set(labels.map((entry) => entry.prefix));
  if (labelPrefixes.has("logistics")) {
    return {
      title,
      type: "milestone",
      lane: "Live",
      startsAt: receivedAt ?? null,
      priority: 52,
      metadata: { labels: labels.map((entry) => entry.raw) },
    };
  }

  if (labelPrefixes.has("promo")) {
    return {
      title,
      type: "event",
      lane: "Promo",
      priority: 58,
      metadata: { labels: labels.map((entry) => entry.raw) },
    };
  }

  return null;
}

function scoreProjectForContext(
  project: ProjectRecord,
  email: EmailSuggestionInput,
  normalizedLabels: string[],
  labelEntries: LabelEntry[]
): ProjectSuggestion | null {
  const contributions: ScoreContribution[] = [];
  const subjectLower = (email.subject || "").toLowerCase();
  const summaryLower = (email.summary || "").toLowerCase();
  const fromDomain = email.fromEmail?.split("@")[1]?.toLowerCase();
  const categoryLower = email.category?.toLowerCase() ?? "";
  const receivedAtMs = email.receivedAt ? Date.parse(email.receivedAt) : null;

  const metadata = collectProjectMetadata(project.labels ?? {});
  collectKeywordsFromValue(project.name, metadata.keywords);
  collectKeywordsFromValue(project.slug, metadata.keywords);

  if (project.status === "active") {
    addContribution(contributions, "Active project", 4);
  } else if (project.status === "paused") {
    addContribution(contributions, "Paused project", 2);
  }

  const slugLower = project.slug ? project.slug.toLowerCase() : null;
  if (slugLower) {
    if (subjectLower.includes(slugLower)) {
      addContribution(contributions, `Subject references slug ${project.slug}`, SUBJECT_SLUG_WEIGHT);
    }
    if (summaryLower.includes(slugLower)) {
      addContribution(contributions, `Summary mentions slug ${project.slug}`, SUMMARY_KEYWORD_WEIGHT);
    }
  }

  const projectNameLower = project.name.toLowerCase();
  if (project.name && project.name.length > 3 && subjectLower.includes(projectNameLower)) {
    addContribution(contributions, `Subject references ${project.name}`, SUBJECT_NAME_WEIGHT);
  }

  const matchedLabelValues = new Set<string>();
  for (const entry of labelEntries) {
    if (!entry.value) continue;

    if (entry.prefix === "project" && slugLower && entry.value === slugLower) {
      addContribution(contributions, "Project label match", PROJECT_LABEL_MATCH_WEIGHT);
      matchedLabelValues.add(entry.raw);
      continue;
    }

    if (
      entry.prefix === "artist" &&
      (metadata.keywords.has(entry.value) || metadata.labelValues.has(entry.value))
    ) {
      addContribution(contributions, `Artist tag ${entry.value}`, ARTIST_LABEL_WEIGHT);
      matchedLabelValues.add(entry.raw);
    }

    if (entry.prefix === "territory" && metadata.territoryValues.has(entry.value)) {
      addContribution(contributions, `Territory ${entry.value} matches project`, TERRITORY_MATCH_WEIGHT);
      matchedLabelValues.add(entry.raw);
    }

    if (!matchedLabelValues.has(entry.raw) && metadata.labelValues.has(entry.value)) {
      addContribution(contributions, `Label overlap ${entry.prefix}/${entry.value}`, LABEL_OVERLAP_WEIGHT);
      matchedLabelValues.add(entry.raw);
    }
  }

  let subjectHits = 0;
  let summaryHits = 0;
  for (const keyword of metadata.keywords) {
    if (!keyword || keyword.length < 3) continue;

    if (subjectHits < 3 && subjectLower.includes(keyword)) {
      const weight = SUBJECT_KEYWORD_WEIGHT - subjectHits * 2;
      addContribution(contributions, `Subject mentions "${keyword}"`, weight);
      subjectHits += 1;
    } else if (summaryHits < 3 && summaryLower.includes(keyword)) {
      const weight = SUMMARY_KEYWORD_WEIGHT - summaryHits * 1.5;
      addContribution(contributions, `Summary references "${keyword}"`, weight);
      summaryHits += 1;
    }
  }

  if (fromDomain && (metadata.domainValues.has(fromDomain) || metadata.keywords.has(fromDomain))) {
    addContribution(contributions, `Sender domain ${fromDomain}`, DOMAIN_MATCH_WEIGHT);
  }

  if (categoryLower) {
    const categoryPrefix = categoryLower.split("/")[0];
    const bonus = CATEGORY_BONUS.get(categoryPrefix);
    if (bonus) {
      addContribution(contributions, `${categoryPrefix} category`, bonus);
    }
  }

  if (project.startDate && receivedAtMs && !Number.isNaN(receivedAtMs)) {
    const startMs = Date.parse(project.startDate);
    if (!Number.isNaN(startMs)) {
      const diffDays = Math.abs(receivedAtMs - startMs) / (24 * 60 * 60 * 1000);
      if (diffDays <= 90) {
        const delta = Math.max(6, 20 - diffDays * 0.4);
        addContribution(contributions, `Within ${Math.round(diffDays)}d of project start`, delta);
      }
    }
  }

  if (project.endDate && receivedAtMs && !Number.isNaN(receivedAtMs)) {
    const endMs = Date.parse(project.endDate);
    if (!Number.isNaN(endMs) && receivedAtMs > endMs) {
      addContribution(contributions, "Email arrives after project end", -12);
    }
  }

  if (normalizedLabels.length === 0 && contributions.length < 2) {
    addContribution(contributions, "Unlabelled email", -10);
  }

  const score = contributions.reduce((total, entry) => total + entry.delta, 0);
  if (score <= 0) {
    return null;
  }

  const timelineItem = buildTimelineSuggestion(
    email.subject,
    email.category,
    labelEntries,
    email.receivedAt ?? null
  );

  return {
    project,
    score: Math.round(score),
    confidence: Math.max(0, Math.min(100, Math.round(score))),
    rationales: formatRationale(contributions),
    timelineItem,
  };
}

export function suggestProjectsForEmail(
  projects: ProjectRecord[],
  email: EmailSuggestionInput,
  options: SuggestProjectsOptions = {}
): ProjectSuggestion[] {
  const limit = options.limit ?? 5;
  const threshold = options.threshold ?? 40;

  const normalizedLabels = normaliseLabels(email.labels ?? []);
  const labelEntries = normalizedLabels.map(toLabelEntry);

  const suggestions: ProjectSuggestion[] = [];

  for (const project of projects) {
    if (project.status === "archived") {
      continue;
    }
    const result = scoreProjectForContext(project, email, normalizedLabels, labelEntries);
    if (result && result.score >= threshold) {
      suggestions.push(result);
    }
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}
