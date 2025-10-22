import {
  DEFAULT_EMAIL_SENTIMENT,
  EMAIL_FALLBACK_LABEL,
  normaliseEmailSentiment,
  type EmailAnalysisInput,
  type EmailAnalysisResult,
  type EmailLabel,
  type EmailSentiment,
} from "@kazador/shared";

export interface ClassificationInput {
  subject: string;
  body: string;
  fromName: string | null;
  fromEmail: string;
  cachedSummary?: string | null;
  cachedLabels?: unknown;
  cachedSentiment?: unknown;
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
  sentiment: EmailSentiment;
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
  let sentiment =
    input.cachedSentiment != null ? normaliseEmailSentiment(input.cachedSentiment) : null;
  let usedCachedSummary = summary.length > 0;
  let usedCachedLabels = labels.length > 0;
  let usedAi = false;
  let usedHeuristics = false;

  const shouldCallAi = !summary || labels.length === 0 || sentiment == null;

  if (shouldCallAi) {
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
      sentiment = normaliseEmailSentiment(aiResult.sentiment);
      usedCachedSummary = false;
      usedCachedLabels = false;
    } catch (error) {
      deps.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (sentiment == null) {
    sentiment = { ...DEFAULT_EMAIL_SENTIMENT };
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
    sentiment,
    usedCachedSummary,
    usedCachedLabels,
    usedAi,
    usedHeuristics,
  };
}
