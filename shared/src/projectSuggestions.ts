import type { EmailRecord, ProjectRecord } from "./types";

export interface ProjectSuggestion {
  project: ProjectRecord;
  score: number;
  rationales: string[];
}

interface ProjectMetadata {
  keywords: string[];
  labelValues: string[];
  domains: string[];
}

function normalise(text: string): string {
  return text.trim().toLowerCase();
}

function extractProjectMetadata(project: ProjectRecord): ProjectMetadata {
  const keywords: Set<string> = new Set();
  const labelValues: Set<string> = new Set();
  const domains: Set<string> = new Set();

  const addKeyword = (raw: string | null | undefined) => {
    if (!raw) return;
    const cleaned = normalise(raw).replace(/[^a-z0-9\s/_-]/g, " ");
    for (const token of cleaned.split(/\s|[\/_-]/).map((token) => token.trim())) {
      if (token.length >= 3) {
        keywords.add(token);
      }
    }
  };

  addKeyword(project.name);
  addKeyword(project.slug);
  addKeyword(project.description ?? "");

  if (project.labels) {
    for (const [key, value] of Object.entries(project.labels)) {
      if (value == null) continue;
      const stringValue = String(value).trim();
      if (!stringValue) continue;
      const valueNormalised = normalise(stringValue);
      labelValues.add(valueNormalised);
      addKeyword(stringValue);
      if (key.toLowerCase().includes("domain") || valueNormalised.includes(".")) {
        const domainMatch = valueNormalised.match(/([a-z0-9-]+\.[a-z]{2,})/);
        if (domainMatch) {
          domains.add(domainMatch[1]);
        }
      }
    }
  }

  return {
    keywords: Array.from(keywords),
    labelValues: Array.from(labelValues),
    domains: Array.from(domains),
  };
}

function scoreSubject(subject: string, metadata: ProjectMetadata): { score: number; matches: string[] } {
  const lower = normalise(subject);
  const matches: string[] = [];
  let score = 0;

  for (const keyword of metadata.keywords) {
    if (lower.includes(keyword)) {
      score += 8;
      matches.push(keyword);
    }
  }

  return { score, matches };
}

function scoreSummary(summary: string | null | undefined, metadata: ProjectMetadata): { score: number; matches: string[] } {
  if (!summary) {
    return { score: 0, matches: [] };
  }
  const lower = normalise(summary);
  const matches: string[] = [];
  let score = 0;
  for (const keyword of metadata.keywords) {
    if (lower.includes(keyword)) {
      score += 4;
      matches.push(keyword);
    }
  }
  return { score, matches };
}

function scoreLabels(emailLabels: string[] | undefined, metadata: ProjectMetadata): { score: number; matches: string[] } {
  if (!emailLabels || emailLabels.length === 0) {
    return { score: 0, matches: [] };
  }
  const matches: string[] = [];
  let score = 0;
  for (const label of emailLabels) {
    const normalised = normalise(label);
    if (metadata.labelValues.includes(normalised)) {
      score += 15;
      matches.push(label);
    }
  }
  return { score, matches };
}

function scoreDomain(email: EmailRecord, metadata: ProjectMetadata): { score: number; match: string | null } {
  const domain = email.fromEmail.split("@")[1]?.toLowerCase();
  if (!domain) {
    return { score: 0, match: null };
  }
  for (const candidate of metadata.domains) {
    if (domain.endsWith(candidate)) {
      return { score: 18, match: candidate };
    }
  }
  return { score: 0, match: null };
}

function scoreTimelineProximity(email: EmailRecord, project: ProjectRecord): { score: number; note: string | null } {
  if (!project.startDate) {
    return { score: 0, note: null };
  }
  const emailDate = new Date(email.receivedAt);
  const startDate = new Date(project.startDate);
  const diffDays = Math.abs(Math.round((startDate.getTime() - emailDate.getTime()) / (24 * 60 * 60 * 1000)));
  if (diffDays <= 14) {
    return { score: 12, note: `Project start is ${diffDays}d from email` };
  }
  if (project.endDate) {
    const endDate = new Date(project.endDate);
    const endDiff = Math.abs(Math.round((endDate.getTime() - emailDate.getTime()) / (24 * 60 * 60 * 1000)));
    if (endDiff <= 14) {
      return { score: 10, note: `Project wrap is ${endDiff}d from email` };
    }
  }
  return { score: 0, note: null };
}

export interface SuggestProjectsOptions {
  excludeProjectIds?: Set<string>;
  limit?: number;
}

export function suggestProjectsForEmail(
  email: EmailRecord,
  projects: ProjectRecord[],
  options: SuggestProjectsOptions = {}
): ProjectSuggestion[] {
  const exclude = options.excludeProjectIds ?? new Set<string>();
  const limit = options.limit ?? 5;

  const suggestions: ProjectSuggestion[] = [];

  for (const project of projects) {
    if (exclude.has(project.id)) {
      continue;
    }

    const metadata = extractProjectMetadata(project);
    const rationales: string[] = [];
    let score = 0;

    const labelScore = scoreLabels(email.labels, metadata);
    if (labelScore.score > 0) {
      score += labelScore.score;
      rationales.push(`Matches project labels: ${labelScore.matches.join(", ")}`);
    }

    const subjectScore = scoreSubject(email.subject, metadata);
    if (subjectScore.score > 0) {
      score += subjectScore.score;
      rationales.push(`Subject references ${subjectScore.matches.join(", ")}`);
    }

    const summaryScore = scoreSummary(email.summary ?? null, metadata);
    if (summaryScore.score > 0) {
      score += summaryScore.score;
      rationales.push(`Body mentions ${summaryScore.matches.join(", ")}`);
    }

    const domainScore = scoreDomain(email, metadata);
    if (domainScore.score > 0 && domainScore.match) {
      score += domainScore.score;
      rationales.push(`Sender domain aligns with ${domainScore.match}`);
    }

    const proximityScore = scoreTimelineProximity(email, project);
    if (proximityScore.score > 0 && proximityScore.note) {
      score += proximityScore.score;
      rationales.push(proximityScore.note);
    }

    if (project.status === "active") {
      score += 5;
      rationales.push("Project is active");
    }

    if (score > 0) {
      suggestions.push({
        project,
        score: Math.round(score * 100) / 100,
        rationales,
      });
    }
  }

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions.slice(0, limit);
}
