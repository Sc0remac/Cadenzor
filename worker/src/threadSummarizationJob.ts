import type { SupabaseClient } from "@supabase/supabase-js";
import {
  analyzeThread,
  normaliseThreadRollingSummary,
  type EmailThreadRollingSummary,
  type ThreadAnalysisAttachmentInput,
  type ThreadAnalysisInput,
  type ThreadAnalysisMessageInput,
  type ThreadAnalysisResult,
  type ThreadAnalysisUsage,
} from "@kazador/shared";

type LogLevel = "info" | "warn" | "error";

interface Logger {
  (level: LogLevel, message: string, context?: Record<string, unknown>): void;
}

interface ThreadRow {
  id: string;
  user_id: string;
  message_count: number | null;
  rolling_summary: unknown;
  last_summarized_at: string | null;
  last_message_at: string | null;
  gmail_thread_id?: string | null;
  subject_canonical?: string | null;
}

interface EmailRow {
  id: string;
  user_id?: string | null;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  received_at: string | null;
  summary: string | null;
  message_index: number | null;
  gmail_message_id?: string | null;
}

interface AttachmentRow {
  id: string;
  email_id: string;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
}

interface ThreadSummaryUpdatePayload {
  rolling_summary: EmailThreadRollingSummary;
  last_summarized_at: string;
  updated_at: string;
}

interface ThreadSummarizationDeps {
  fetchThread: (threadId: string) => Promise<ThreadRow | null>;
  fetchThreadEmails: (threadId: string, userId: string) => Promise<EmailRow[]>;
  fetchAttachments: (emailIds: string[]) => Promise<AttachmentRow[]>;
  updateThreadSummary: (threadId: string, payload: ThreadSummaryUpdatePayload) => Promise<void>;
  analyzeThread: typeof analyzeThread;
  now: () => Date;
  logger: Logger;
}

export interface SummarizeThreadOptions {
  openaiApiKey?: string | null;
  /**
   * When true always generate a summary, even if there are no new messages.
   */
  force?: boolean;
  /**
   * Minimum number of messages required before a summary is attempted.
   * Defaults to 2.
   */
  minMessageCount?: number;
  /**
   * Warn when the token usage for a single summary exceeds this threshold.
   */
  tokenWarnThreshold?: number;
  /**
   * Warn when the estimated cost for a single summary exceeds this value (USD).
   */
  costWarnThreshold?: number;
  /**
   * Maximum number of attachments to include in the optional attachment context.
   * Defaults to 10.
   */
  attachmentContextLimit?: number;
}

export interface ThreadSummarizationResult {
  status: "summarized" | "skipped" | "not_found";
  threadId: string;
  reason?: "not_enough_messages" | "no_new_messages";
  summary?: EmailThreadRollingSummary;
  tokenUsage?: ThreadAnalysisUsage | null;
}

const DEFAULT_MIN_MESSAGE_COUNT =
  Number.parseInt(process.env.THREAD_SUMMARY_MIN_MESSAGES ?? "", 10) || 2;
const DEFAULT_TOKEN_WARN_THRESHOLD =
  Number.parseInt(process.env.THREAD_SUMMARY_TOKEN_WARN ?? "", 10) || 6000;
const DEFAULT_COST_WARN_THRESHOLD =
  Number.parseFloat(process.env.THREAD_SUMMARY_COST_WARN_USD ?? "") || 0;
const DEFAULT_ATTACHMENT_CONTEXT_LIMIT =
  Number.parseInt(process.env.THREAD_SUMMARY_ATTACHMENT_CONTEXT_LIMIT ?? "", 10) || 10;

function defaultLogger(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const payload = context && Object.keys(context).length > 0 ? context : undefined;
  if (level === "warn") {
    console.warn(`[ThreadSummaries] ${message}`, payload);
  } else if (level === "error") {
    console.error(`[ThreadSummaries] ${message}`, payload);
  } else {
    console.log(`[ThreadSummaries] ${message}`, payload);
  }
}

function createDefaultDeps(supabase: SupabaseClient<any, any, any>): ThreadSummarizationDeps {
  return {
    fetchThread: async (threadId: string) => {
      const { data, error } = await supabase
        .from("email_threads")
        .select(
          "id, user_id, message_count, rolling_summary, last_summarized_at, last_message_at, gmail_thread_id, subject_canonical"
        )
        .eq("id", threadId)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to load thread ${threadId}: ${error.message}`);
      }

      return (data as ThreadRow | null) ?? null;
    },
    fetchThreadEmails: async (threadId: string, userId: string) => {
      const { data, error } = await supabase
        .from("emails")
        .select(
          "id, user_id, subject, from_name, from_email, received_at, summary, message_index, gmail_message_id"
        )
        .eq("thread_id", threadId)
        .eq("user_id", userId)
        .order("message_index", { ascending: true, nullsFirst: true })
        .order("received_at", { ascending: true, nullsFirst: true });

      if (error) {
        throw new Error(`Failed to load emails for thread ${threadId}: ${error.message}`);
      }

      return (data as EmailRow[]) ?? [];
    },
    fetchAttachments: async (emailIds: string[]) => {
      if (emailIds.length === 0) {
        return [];
      }

      const { data, error } = await supabase
        .from("email_attachments")
        .select("id, email_id, filename, mime_type, size")
        .in("email_id", emailIds);

      if (error) {
        throw new Error(`Failed to load attachments for thread: ${error.message}`);
      }

      return (data as AttachmentRow[]) ?? [];
    },
    updateThreadSummary: async (threadId: string, payload: ThreadSummaryUpdatePayload) => {
      const { error } = await supabase
        .from("email_threads")
        .update({
          rolling_summary: payload.rolling_summary,
          last_summarized_at: payload.last_summarized_at,
          updated_at: payload.updated_at,
        })
        .eq("id", threadId);

      if (error) {
        throw new Error(`Failed to update thread summary for ${threadId}: ${error.message}`);
      }
    },
    analyzeThread,
    now: () => new Date(),
    logger: defaultLogger,
  };
}

function deriveMessageBody(email: EmailRow): string {
  if (typeof email.summary === "string" && email.summary.trim()) {
    return email.summary.trim();
  }
  return "";
}

function buildMessages(
  emails: EmailRow[],
  attachments: AttachmentRow[],
  now: () => Date
): ThreadAnalysisMessageInput[] {
  const attachmentByEmail = new Map<string, ThreadAnalysisAttachmentInput[]>();
  for (const attachment of attachments) {
    if (!attachment.email_id) continue;
    if (!attachment.filename || !attachment.filename.trim()) continue;
    const list = attachmentByEmail.get(attachment.email_id) ?? [];
    const size =
      typeof attachment.size === "number"
        ? attachment.size
        : attachment.size != null
        ? Number(attachment.size)
        : 0;
    list.push({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mime_type ?? "application/octet-stream",
      size: Number.isFinite(size) ? size : 0,
    });
    attachmentByEmail.set(attachment.email_id, list);
  }

  const messages: ThreadAnalysisMessageInput[] = [];
  emails.forEach((email, index) => {
    const messageIndex =
      typeof email.message_index === "number"
        ? email.message_index
        : typeof email.message_index === "string"
        ? Number.parseInt(email.message_index, 10) || index
        : index;

    const receivedAt =
      typeof email.received_at === "string" && email.received_at
        ? new Date(email.received_at).toISOString()
        : now().toISOString();

    messages.push({
      id: email.id,
      subject: email.subject,
      from: {
        name: email.from_name,
        email: email.from_email ?? "",
      },
      to: [],
      cc: [],
      bcc: [],
      receivedAt,
      body: deriveMessageBody(email),
      messageIndex,
      attachments: attachmentByEmail.get(email.id),
    });
  });

  return messages.sort((a, b) => {
    if (a.messageIndex !== b.messageIndex) {
      return a.messageIndex - b.messageIndex;
    }
    return a.receivedAt.localeCompare(b.receivedAt);
  });
}

function buildAttachmentContext(
  attachments: AttachmentRow[],
  limit: number
): ThreadAnalysisAttachmentInput[] | null {
  if (attachments.length === 0 || limit <= 0) {
    return null;
  }

  const seen = new Set<string>();
  const result: ThreadAnalysisAttachmentInput[] = [];

  for (const attachment of attachments) {
    if (!attachment.filename) continue;
    const name = attachment.filename.trim();
    if (!name) continue;
    const key = `${name.toLowerCase()}::${attachment.mime_type ?? "unknown"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const size =
      typeof attachment.size === "number"
        ? attachment.size
        : attachment.size != null
        ? Number(attachment.size)
        : 0;

    result.push({
      id: attachment.id,
      filename: name,
      mimeType: attachment.mime_type ?? "application/octet-stream",
      size: Number.isFinite(size) ? size : 0,
    });

    if (result.length >= limit) {
      break;
    }
  }

  return result.length > 0 ? result : null;
}

function determineMessagesForAnalysis(
  messages: ThreadAnalysisMessageInput[],
  priorSummary: EmailThreadRollingSummary | null,
  force: boolean
) {
  const lastIndex = priorSummary?.lastMessageIndex ?? -1;
  const newMessages = messages.filter((message) => message.messageIndex > lastIndex);
  if (force || priorSummary == null) {
    return { mode: priorSummary ? "incremental" : "full", messagesForModel: messages, newMessages };
  }
  if (newMessages.length === 0) {
    return { mode: "incremental" as const, messagesForModel: newMessages, newMessages };
  }
  if (newMessages.length < messages.length && newMessages.length < 10) {
    return { mode: "incremental" as const, messagesForModel: messages, newMessages };
  }
  return { mode: "incremental" as const, messagesForModel: newMessages, newMessages };
}

function warnOnUsage(
  deps: ThreadSummarizationDeps,
  threadId: string,
  usage: ThreadAnalysisUsage | null | undefined,
  options: SummarizeThreadOptions
) {
  if (!usage) {
    return;
  }

  const tokenThreshold =
    options.tokenWarnThreshold ??
    (DEFAULT_TOKEN_WARN_THRESHOLD > 0 ? DEFAULT_TOKEN_WARN_THRESHOLD : null);
  const costThreshold =
    options.costWarnThreshold ??
    (DEFAULT_COST_WARN_THRESHOLD > 0 ? DEFAULT_COST_WARN_THRESHOLD : null);

  const context = {
    threadId,
    totalTokens: usage.totalTokens,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    model: usage.model,
    costUsd: usage.costUsd ?? undefined,
  };

  if (tokenThreshold != null && usage.totalTokens >= tokenThreshold) {
    deps.logger("warn", "Thread summary token usage exceeded threshold", context);
  }

  if (
    costThreshold != null &&
    usage.costUsd != null &&
    usage.costUsd >= costThreshold &&
    costThreshold > 0
  ) {
    deps.logger("warn", "Thread summary cost exceeded threshold", context);
  }
}

export async function summarizeThread(
  supabase: SupabaseClient<any, any, any>,
  threadId: string,
  options: SummarizeThreadOptions = {},
  overrides: Partial<ThreadSummarizationDeps> = {}
): Promise<ThreadSummarizationResult> {
  const deps = { ...createDefaultDeps(supabase), ...overrides };
  const minMessages = options.minMessageCount ?? DEFAULT_MIN_MESSAGE_COUNT;
  const force = options.force ?? false;

  const thread = await deps.fetchThread(threadId);
  if (!thread) {
    deps.logger("warn", "Thread not found for summarization", { threadId });
    return { status: "not_found", threadId };
  }

  const messagesNeeded = typeof thread.message_count === "number" ? thread.message_count : 0;
  if (!force && messagesNeeded < minMessages) {
    deps.logger("info", "Skipping thread summarization (not enough messages)", {
      threadId,
      messageCount: messagesNeeded,
    });
    return { status: "skipped", threadId, reason: "not_enough_messages" };
  }

  const emails = await deps.fetchThreadEmails(threadId, thread.user_id);
  if (!force && emails.length < minMessages) {
    deps.logger("info", "Skipping thread summarization (insufficient emails loaded)", {
      threadId,
      emailCount: emails.length,
    });
    return { status: "skipped", threadId, reason: "not_enough_messages" };
  }

  const attachments = await deps.fetchAttachments(emails.map((email) => email.id));
  const messages = buildMessages(emails, attachments, deps.now);
  const priorSummary = normaliseThreadRollingSummary(thread.rolling_summary);
  const { mode, messagesForModel, newMessages } = determineMessagesForAnalysis(
    messages,
    priorSummary,
    force
  );

  if (!force && priorSummary && newMessages.length === 0) {
    deps.logger("info", "Skipping thread summarization (no new messages)", {
      threadId,
      lastSummarizedIndex: priorSummary.lastMessageIndex,
    });
    return { status: "skipped", threadId, reason: "no_new_messages" };
  }

  if (messagesForModel.length === 0) {
    deps.logger("info", "Skipping thread summarization (no messages available)", {
      threadId,
    });
    return { status: "skipped", threadId, reason: "not_enough_messages" };
  }

  const attachmentContext = buildAttachmentContext(
    attachments,
    options.attachmentContextLimit ?? DEFAULT_ATTACHMENT_CONTEXT_LIMIT
  );

  const analysisInput: ThreadAnalysisInput = {
    threadId,
    messages: messagesForModel,
    priorSummary: priorSummary ?? undefined,
    attachmentContext: attachmentContext ?? undefined,
  };

  deps.logger("info", "Generating thread summary", {
    threadId,
    mode,
    messageCount: messagesForModel.length,
    totalMessages: messages.length,
  });

  let analysisResult: ThreadAnalysisResult;
  try {
    analysisResult = await deps.analyzeThread(analysisInput, options.openaiApiKey);
  } catch (error) {
    deps.logger("error", "Thread analysis failed", {
      threadId,
      error: (error as Error).message,
    });
    throw error;
  }

  const nowIso = deps.now().toISOString();
  const lastMessageIndex =
    analysisResult.lastMessageIndex ??
    Math.max(
      ...messages.map((message) => message.messageIndex),
      priorSummary?.lastMessageIndex ?? -1
    );

  const rollingSummary: EmailThreadRollingSummary = {
    summary: analysisResult.summary,
    keyPoints: analysisResult.keyPoints,
    outstandingQuestions: analysisResult.outstandingQuestions,
    deadlines: analysisResult.deadlines,
    nextAction: analysisResult.nextAction,
    lastMessageIndex,
    sentiment: analysisResult.sentiment,
    updatedAt: nowIso,
    attachmentsOfInterest: analysisResult.attachmentsOfInterest,
  };

  await deps.updateThreadSummary(threadId, {
    rolling_summary: rollingSummary,
    last_summarized_at: nowIso,
    updated_at: nowIso,
  });

  warnOnUsage(deps, threadId, analysisResult.tokenUsage, options);

  deps.logger("info", "Thread summary updated", {
    threadId,
    lastMessageIndex,
    keyPointCount: rollingSummary.keyPoints.length,
    outstandingQuestions: rollingSummary.outstandingQuestions.length,
  });

  return {
    status: "summarized",
    threadId,
    summary: rollingSummary,
    tokenUsage: analysisResult.tokenUsage ?? null,
  };
}

export interface SummarizePendingThreadsOptions extends SummarizeThreadOptions {
  userId?: string;
  limit?: number;
}

export async function summarizePendingThreads(
  supabase: SupabaseClient<any, any, any>,
  options: SummarizePendingThreadsOptions = {},
  overrides: Partial<ThreadSummarizationDeps> = {}
): Promise<ThreadSummarizationResult[]> {
  const minMessages = options.minMessageCount ?? DEFAULT_MIN_MESSAGE_COUNT;
  const limit = options.limit ?? 10;

  let query = supabase
    .from("email_threads")
    .select("id, user_id")
    .gte("message_count", minMessages)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (options.userId) {
    query = query.eq("user_id", options.userId);
  }

  query = query.or("last_summarized_at.is.null,last_message_at.gt.last_summarized_at");

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load threads needing summaries: ${error.message}`);
  }

  const rows = (data as { id: string }[]) ?? [];
  const results: ThreadSummarizationResult[] = [];
  for (const row of rows) {
    const result = await summarizeThread(supabase, row.id, options, overrides);
    results.push(result);
  }

  return results;
}
