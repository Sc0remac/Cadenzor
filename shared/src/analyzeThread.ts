import {
  normaliseEmailSentiment,
} from "./analyzeEmail";
import type {
  EmailThreadDeadline,
  EmailThreadRollingSummary,
  ThreadAnalysisAttachmentInput,
  ThreadAnalysisInput,
  ThreadAnalysisMessageInput,
  ThreadAnalysisProjectContext,
  ThreadAnalysisResult,
  ThreadAnalysisUsage,
} from "./types";

type ThreadAnalysisMode = "full" | "incremental";

const THREAD_ANALYSIS_ENDPOINT =
  process.env.OPENAI_THREAD_ANALYSIS_ENDPOINT ?? "https://api.openai.com/v1/chat/completions";
const THREAD_ANALYSIS_MAX_MESSAGES =
  Number.parseInt(process.env.THREAD_ANALYSIS_MAX_MESSAGES ?? "", 10) || 10;
const THREAD_ANALYSIS_HEAVY_THRESHOLD =
  Number.parseInt(process.env.THREAD_ANALYSIS_HEAVY_THRESHOLD ?? "", 10) || 10;
const THREAD_ANALYSIS_FULL_MODEL = process.env.THREAD_ANALYSIS_FULL_MODEL ?? "gpt-4o-mini";
const THREAD_ANALYSIS_INCREMENTAL_MODEL =
  process.env.THREAD_ANALYSIS_INCREMENTAL_MODEL ?? THREAD_ANALYSIS_FULL_MODEL;
const THREAD_ANALYSIS_HEAVY_MODEL = process.env.THREAD_ANALYSIS_HEAVY_MODEL ?? "gpt-4o";
const THREAD_ANALYSIS_TEMPERATURE =
  Number.parseFloat(process.env.THREAD_ANALYSIS_TEMPERATURE ?? "") || 0.4;
const THREAD_ANALYSIS_TIMEOUT_MS =
  Number.parseInt(process.env.THREAD_ANALYSIS_TIMEOUT_MS ?? "", 10) || 45000;
const THREAD_ANALYSIS_PROMPT_COST_PER_1K =
  Number.parseFloat(process.env.THREAD_ANALYSIS_PROMPT_COST_PER_1K ?? "") || 0;
const THREAD_ANALYSIS_COMPLETION_COST_PER_1K =
  Number.parseFloat(process.env.THREAD_ANALYSIS_COMPLETION_COST_PER_1K ?? "") || 0;
const THREAD_ANALYSIS_BODY_CHAR_LIMIT =
  Number.parseInt(process.env.THREAD_ANALYSIS_BODY_CHAR_LIMIT ?? "", 10) || 6000;

interface ThreadAnalysisPayload {
  mode: ThreadAnalysisMode;
  threadId: string;
  messages: Array<{
    id: string;
    subject: string | null;
    from: { name: string | null; email: string };
    to: string[];
    cc: string[];
    bcc: string[];
    receivedAt: string;
    body: string;
    messageIndex: number;
    attachments?: Array<{
      filename: string;
      mimeType: string;
      size: number;
    }>;
  }>;
  priorSummary?: {
    summary: string;
    keyPoints: string[];
    outstandingQuestions: string[];
    deadlines: EmailThreadDeadline[];
    lastMessageIndex: number;
  } | null;
  projectContext?: ThreadAnalysisProjectContext | null;
  attachmentContext?: ThreadAnalysisAttachmentInput[] | null;
}

function ensureApiKey(explicitKey?: string | null): string {
  const key = explicitKey || process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("analyzeThread: OPENAI_API_KEY is not set");
  }
  return key;
}

function normaliseMessageTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function truncateBody(body: string): string {
  if (!body) return "";
  const cleaned = body.replace(/\r/g, "").trim();
  if (cleaned.length <= THREAD_ANALYSIS_BODY_CHAR_LIMIT) {
    return cleaned;
  }
  return `${cleaned.slice(0, THREAD_ANALYSIS_BODY_CHAR_LIMIT)}…`;
}

function normaliseMessage(message: ThreadAnalysisMessageInput) {
  return {
    id: message.id,
    subject: message.subject ?? null,
    from: {
      name: message.from?.name ?? null,
      email: message.from?.email ?? "",
    },
    to: (Array.isArray(message.to) ? message.to : []).map((entry) => entry.trim()).filter(Boolean),
    cc: (Array.isArray(message.cc) ? message.cc : []).map((entry) => entry.trim()).filter(Boolean),
    bcc: (Array.isArray(message.bcc) ? message.bcc : [])
      .map((entry) => entry.trim())
      .filter(Boolean),
    receivedAt: normaliseMessageTimestamp(message.receivedAt),
    body: truncateBody(message.body ?? ""),
    messageIndex: typeof message.messageIndex === "number" ? message.messageIndex : 0,
    attachments: Array.isArray(message.attachments)
      ? message.attachments
          .map((attachment) => ({
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: typeof attachment.size === "number" ? attachment.size : 0,
          }))
          .filter((attachment) => Boolean(attachment.filename))
      : undefined,
  };
}

function selectModel(mode: ThreadAnalysisMode, messageCount: number): string {
  if (messageCount > THREAD_ANALYSIS_HEAVY_THRESHOLD) {
    return THREAD_ANALYSIS_HEAVY_MODEL;
  }

  return mode === "incremental" ? THREAD_ANALYSIS_INCREMENTAL_MODEL : THREAD_ANALYSIS_FULL_MODEL;
}

function buildThreadAnalysisSystemPrompt(mode: ThreadAnalysisMode): string {
  if (mode === "incremental") {
    return [
      "You are Kazador's thread intelligence model.",
      "You will receive the prior summary and only the NEW emails in a thread.",
      "Update the summary and provide deltas without repeating prior information.",
      "Always respond with strict JSON.",
      "Fields:",
      '- summary: concise overview (2-3 sentences)',
      "- newKeyPoints: NEW decisions or facts (array of strings)",
      "- resolvedQuestions: questions from the prior summary that are now resolved",
      "- newQuestions: questions that still need answers",
      "- deadlines: array of { description, dueAt (ISO datetime) } for new/updated deadlines",
      '- sentiment: { label: "positive" | "neutral" | "negative", confidence: 0-1 }',
      "- nextAction: single recommended action or null",
      "- attachmentsOfInterest: filenames that the team should review",
    ].join("\n");
  }

  return [
    "You are Kazador's thread intelligence model.",
    "You will receive a list of email messages in chronological order.",
    "Summarise the thread for busy tour managers and identify actionable items.",
    "Always respond with strict JSON.",
    "Fields:",
    '- summary: concise overview (2-3 sentences)',
    "- keyPoints: array of key decisions, facts, or commitments",
    "- outstandingQuestions: questions that still need answers",
    "- deadlines: array of { description, dueAt (ISO datetime) }",
    '- sentiment: { label: \"positive\" | \"neutral\" | \"negative\", confidence: 0-1 }',
    "- nextAction: single recommended action or null",
    "- attachmentsOfInterest: filenames that the team should review",
  ].join("\n");
}

function buildThreadAnalysisPayload(
  input: ThreadAnalysisInput,
  mode: ThreadAnalysisMode
): ThreadAnalysisPayload {
  const normalisedMessages = input.messages.map(normaliseMessage);
  const limitedMessages =
    normalisedMessages.length > THREAD_ANALYSIS_MAX_MESSAGES
      ? normalisedMessages.slice(-THREAD_ANALYSIS_MAX_MESSAGES)
      : normalisedMessages;

  const payload: ThreadAnalysisPayload = {
    mode,
    threadId: input.threadId,
    messages: limitedMessages,
  };

  if (mode === "incremental" && input.priorSummary) {
    payload.priorSummary = {
      summary: input.priorSummary.summary ?? "",
      keyPoints: Array.isArray(input.priorSummary.keyPoints)
        ? input.priorSummary.keyPoints
        : [],
      outstandingQuestions: Array.isArray(input.priorSummary.outstandingQuestions)
        ? input.priorSummary.outstandingQuestions
        : [],
      deadlines: Array.isArray(input.priorSummary.deadlines)
        ? input.priorSummary.deadlines
        : [],
      lastMessageIndex:
        typeof input.priorSummary.lastMessageIndex === "number"
          ? input.priorSummary.lastMessageIndex
          : -1,
    };
  }

  if (input.projectContext) {
    payload.projectContext = input.projectContext;
  }

  if (input.attachmentContext) {
    payload.attachmentContext = input.attachmentContext;
  }

  return payload;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed) {
        result.push(trimmed);
      }
    }
  }
  return result;
}

function coerceDeadlines(value: unknown): EmailThreadDeadline[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: EmailThreadDeadline[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const description =
      typeof record.description === "string" ? record.description.trim() : "";
    const dueAt =
      typeof record.dueAt === "string"
        ? record.dueAt
        : typeof record.due_at === "string"
        ? record.due_at
        : "";
    if (!description || !dueAt) continue;
    const iso = toIsoOrNull(dueAt);
    if (!iso) continue;
    result.push({
      description,
      dueAt: iso,
      source:
        typeof record.source === "string"
          ? (record.source as EmailThreadDeadline["source"])
          : undefined,
    });
  }

  return result;
}

function mergeUnique(values: string[], additional: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }

  for (const value of additional) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }

  return merged;
}

function buildTokenUsage(
  usage: Record<string, unknown> | null | undefined,
  model: string
): ThreadAnalysisUsage | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const promptTokens =
    typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const completionTokens =
    typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
  const totalTokens =
    typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;

  if (
    typeof promptTokens !== "number" ||
    typeof completionTokens !== "number" ||
    typeof totalTokens !== "number"
  ) {
    return null;
  }

  let costUsd: number | null = null;
  if (THREAD_ANALYSIS_PROMPT_COST_PER_1K > 0 || THREAD_ANALYSIS_COMPLETION_COST_PER_1K > 0) {
    const promptCost = (promptTokens / 1000) * THREAD_ANALYSIS_PROMPT_COST_PER_1K;
    const completionCost = (completionTokens / 1000) * THREAD_ANALYSIS_COMPLETION_COST_PER_1K;
    costUsd = Number((promptCost + completionCost).toFixed(6));
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    model,
    costUsd,
  };
}

export async function analyzeThread(
  input: ThreadAnalysisInput,
  explicitApiKey?: string | null
): Promise<ThreadAnalysisResult> {
  if (!input?.messages || input.messages.length === 0) {
    throw new Error("analyzeThread: thread messages are required");
  }

  const mode: ThreadAnalysisMode =
    input.priorSummary && input.priorSummary.lastMessageIndex != null
      ? "incremental"
      : input.priorSummary
      ? "incremental"
      : "full";

  const payload = buildThreadAnalysisPayload(input, mode);
  const model = selectModel(mode, payload.messages.length);
  const apiKey = ensureApiKey(explicitApiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), THREAD_ANALYSIS_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(THREAD_ANALYSIS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: THREAD_ANALYSIS_TEMPERATURE,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildThreadAnalysisSystemPrompt(mode) },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(`analyzeThread: failed to call OpenAI (${(error as Error).message})`);
  }

  clearTimeout(timeout);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `analyzeThread: OpenAI request failed (${response.status} ${response.statusText}) ${body}`
    );
  }

  const data = (await response.json()) as Record<string, any>;
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("analyzeThread: OpenAI response did not include content");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`analyzeThread: failed to parse JSON response (${(error as Error).message})`);
  }

  const summary =
    typeof parsed.summary === "string"
      ? parsed.summary.trim()
      : input.priorSummary?.summary ?? "";

  const deadlines = coerceDeadlines(parsed.deadlines);
  const sentiment = normaliseEmailSentiment(parsed.sentiment);
  const attachmentsOfInterest = coerceStringArray(parsed.attachmentsOfInterest);
  const nextAction =
    typeof parsed.nextAction === "string" && parsed.nextAction.trim()
      ? parsed.nextAction.trim()
      : null;

  const priorKeyPoints =
    mode === "incremental" && input.priorSummary?.keyPoints
      ? [...input.priorSummary.keyPoints]
      : [];
  const priorQuestions =
    mode === "incremental" && input.priorSummary?.outstandingQuestions
      ? [...input.priorSummary.outstandingQuestions]
      : [];

  const newKeyPoints =
    mode === "incremental" ? coerceStringArray(parsed.newKeyPoints) : coerceStringArray(parsed.keyPoints);
  const resolvedQuestions =
    mode === "incremental" ? coerceStringArray(parsed.resolvedQuestions) : [];
  const newQuestions =
    mode === "incremental" ? coerceStringArray(parsed.newQuestions) : coerceStringArray(parsed.outstandingQuestions);

  const mergedKeyPoints =
    mode === "incremental" ? mergeUnique(priorKeyPoints, newKeyPoints) : newKeyPoints;

  const outstandingQuestions =
    mode === "incremental"
      ? mergeUnique(
          priorQuestions.filter(
            (question) =>
              !resolvedQuestions.some(
                (resolved) => resolved.toLowerCase() === question.toLowerCase()
              )
          ),
          newQuestions
        )
      : newQuestions;

  const lastMessageIndex = Math.max(
    ...input.messages.map((message) =>
      typeof message.messageIndex === "number" ? message.messageIndex : 0
    ),
    input.priorSummary?.lastMessageIndex ?? 0
  );

  const tokenUsage = buildTokenUsage(data?.usage, data?.model ?? model);

  const result: ThreadAnalysisResult = {
    summary,
    keyPoints: mergedKeyPoints,
    outstandingQuestions,
    deadlines,
    sentiment,
    nextAction,
    attachmentsOfInterest,
    lastMessageIndex,
    tokenUsage,
  };

  if (mode === "incremental") {
    result.newKeyPoints = newKeyPoints;
    result.resolvedQuestions = resolvedQuestions;
    result.newQuestions = newQuestions;
  }

  return result;
}
