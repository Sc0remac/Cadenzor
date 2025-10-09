import {
  EMAIL_FALLBACK_LABEL,
  type EmailAnalysisInput,
  type EmailAnalysisResult,
  type EmailLabel,
} from "@kazador/shared";

export interface ClassificationInput {
  subject: string;
  body: string;
  fromName: string | null;
  fromEmail: string;
  cachedSummary?: string | null;
  cachedLabels?: unknown;
}

export interface ClassificationDependencies {
  analyzeEmail(input: EmailAnalysisInput): Promise<EmailAnalysisResult>;
  heuristicLabels(subject: string, body: string): EmailLabel[];
  normaliseLabels(value: unknown): EmailLabel[];
  ensureDefaultLabelCoverage(labels: EmailLabel[]): EmailLabel[];
  selectPrimaryCategory(labels: EmailLabel[]): EmailLabel | null;
  onError?(error: Error): void;
}

export interface ClassificationResult {
  summary: string;
  labels: EmailLabel[];
  category: EmailLabel;
  usedCachedSummary: boolean;
  usedCachedLabels: boolean;
  usedAi: boolean;
  usedHeuristics: boolean;
}

export async function classifyEmail(
  input: ClassificationInput,
  deps: ClassificationDependencies
): Promise<ClassificationResult> {
  const cachedSummary = typeof input.cachedSummary === "string" ? input.cachedSummary.trim() : "";
  const cachedLabels = deps.normaliseLabels(input.cachedLabels);

  let summary = cachedSummary;
  let labels = [...cachedLabels];
  let usedCachedSummary = summary.length > 0;
  let usedCachedLabels = labels.length > 0;
  let usedAi = false;
  let usedHeuristics = false;

  if (!summary || labels.length === 0) {
    try {
      const aiResult = await deps.analyzeEmail({
        subject: input.subject,
        body: input.body,
        fromName: input.fromName,
        fromEmail: input.fromEmail,
      });
      usedAi = true;
      if (aiResult.summary && typeof aiResult.summary === "string") {
        summary = aiResult.summary.trim();
      }
      labels = deps.normaliseLabels(aiResult.labels);
      usedCachedSummary = false;
      usedCachedLabels = false;
    } catch (error) {
      deps.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (labels.length === 0) {
    labels = deps.heuristicLabels(input.subject, input.body);
    usedHeuristics = true;
  }

  labels = deps.ensureDefaultLabelCoverage(labels);
  if (labels.length === 0) {
    labels = [EMAIL_FALLBACK_LABEL];
  }

  const category = deps.selectPrimaryCategory(labels) ?? EMAIL_FALLBACK_LABEL;

  return {
    summary: summary.trim(),
    labels,
    category,
    usedCachedSummary,
    usedCachedLabels,
    usedAi,
    usedHeuristics,
  };
}
