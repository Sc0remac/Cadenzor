import type { EmailThreadDeadline, EmailThreadRollingSummary } from "./types";

function normaliseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is string => Boolean(entry));
}

function normaliseDeadlines(value: unknown): EmailThreadDeadline[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: EmailThreadDeadline[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const description =
      typeof record.description === "string"
        ? record.description.trim()
        : typeof record.title === "string"
        ? record.title.trim()
        : "";

    const dueAtSource =
      typeof record.dueAt === "string"
        ? record.dueAt
        : typeof record.due_at === "string"
        ? record.due_at
        : "";

    if (!description || !dueAtSource) {
      continue;
    }

    const parsed = new Date(dueAtSource);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }

    result.push({
      description,
      dueAt: parsed.toISOString(),
      source:
        typeof record.source === "string"
          ? (record.source as EmailThreadDeadline["source"])
          : undefined,
    });
  }

  return result;
}

export function normaliseThreadRollingSummary(
  value: unknown
): EmailThreadRollingSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const summary = typeof raw.summary === "string" ? raw.summary : "";
  const keyPoints = normaliseStringArray(raw.keyPoints ?? raw.key_points);
  const outstandingQuestions = normaliseStringArray(
    raw.outstandingQuestions ?? raw.outstanding_questions
  );
  const deadlines = normaliseDeadlines(raw.deadlines);
  const nextAction =
    typeof raw.nextAction === "string"
      ? raw.nextAction
      : typeof raw.next_action === "string"
      ? raw.next_action
      : null;
  const lastMessageIndexRaw =
    raw.lastMessageIndex ?? raw.last_message_index ?? raw.last_messageId ?? null;
  const lastMessageIndex =
    typeof lastMessageIndexRaw === "number"
      ? lastMessageIndexRaw
      : typeof lastMessageIndexRaw === "string"
      ? Number.parseInt(lastMessageIndexRaw, 10)
      : -1;

  const updatedAt =
    typeof raw.updatedAt === "string"
      ? raw.updatedAt
      : typeof raw.updated_at === "string"
      ? raw.updated_at
      : null;

  const attachmentsOfInterest = normaliseStringArray(
    raw.attachmentsOfInterest ?? raw.attachments_of_interest
  );

  const sentiment =
    raw.sentiment && typeof raw.sentiment === "object"
      ? (raw.sentiment as EmailThreadRollingSummary["sentiment"])
      : null;

  if (!summary && keyPoints.length === 0 && outstandingQuestions.length === 0) {
    return null;
  }

  return {
    summary,
    keyPoints,
    outstandingQuestions,
    deadlines,
    nextAction,
    lastMessageIndex,
    sentiment,
    updatedAt,
    attachmentsOfInterest,
  } satisfies EmailThreadRollingSummary;
}
