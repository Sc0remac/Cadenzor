import type { SupabaseClient } from "@supabase/supabase-js";
import type { gmail_v1 } from "googleapis";
import {
  DEFAULT_THREAD_PRIORITY_CONFIG,
  calculateThreadPriority,
  type EmailLabel,
  type EmailThreadParticipant,
  type ThreadPriorityOptions,
  type ThreadPriorityResult,
} from "@kazador/shared";

const DEFAULT_SUBJECT_FALLBACK = "(no subject)";

interface ParsedAddress {
  name: string | null;
  email: string;
}

export interface UpsertEmailThreadParams {
  supabase: SupabaseClient<any, any, any>;
  userId: string;
  gmailThreadId: string;
  gmailThread: gmail_v1.Schema$Thread | null;
  accountEmail?: string | null;
  latestMessage: {
    subject: string;
    receivedAt: string;
    labels: EmailLabel[];
    category: string | null;
    isRead: boolean;
    hasAttachments: boolean;
  };
}

export interface UpsertEmailThreadResult {
  threadId: string;
  priority: ThreadPriorityResult;
  messageCount: number;
  lastMessageAt: string;
}

export function parseFromHeader(from: string): ParsedAddress {
  const trimmed = (from || "").trim();
  if (!trimmed) {
    return { name: null, email: "" };
  }

  const match = trimmed.match(/<([^>]+)>/);
  if (match) {
    const email = match[1]?.trim() ?? "";
    const namePart = trimmed.slice(0, match.index).replace(/['"]/g, "").trim();
    return { name: namePart || null, email };
  }

  return {
    name: null,
    email: trimmed,
  };
}

export function parseAddressList(raw: string): ParsedAddress[] {
  if (!raw) {
    return [];
  }

  const parts = raw
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => part.trim())
    .filter(Boolean);

  const entries: ParsedAddress[] = [];
  for (const part of parts) {
    const parsed = parseFromHeader(part);
    if (parsed.email) {
      entries.push(parsed);
    }
  }

  return entries;
}

export function parseReferencesHeader(raw: string): string[] {
  if (!raw) {
    return [];
  }

  const matches = raw.match(/<[^>]+>/g);
  if (matches && matches.length > 0) {
    return matches
      .map((entry) => entry.replace(/[<>]/g, "").trim())
      .filter(Boolean);
  }

  return raw
    .split(/\s+/)
    .map((entry) => entry.replace(/[<>]/g, "").trim())
    .filter(Boolean);
}

export function canonicalizeSubject(subject: string | null | undefined): string {
  if (!subject) {
    return DEFAULT_SUBJECT_FALLBACK;
  }

  let result = subject.trim();
  const prefixRegex = /^(re|fw|fwd|rv|sv|aw):\s*/i;
  while (prefixRegex.test(result)) {
    result = result.replace(prefixRegex, "").trim();
  }

  return result || DEFAULT_SUBJECT_FALLBACK;
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  if (!headers) return "";
  return (
    headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ??
    ""
  );
}

function extractInternalDate(message: gmail_v1.Schema$Message): number | null {
  if (!message.internalDate) return null;
  const parsed = Number(message.internalDate);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function calculateMessageIndex(
  thread: gmail_v1.Schema$Thread | null,
  messageId: string
): number | null {
  const messages = thread?.messages;
  if (!messages || messages.length === 0) {
    return null;
  }

  const sorted = [...messages].sort((a, b) => {
    const aDate = extractInternalDate(a) ?? 0;
    const bDate = extractInternalDate(b) ?? 0;
    if (aDate !== bDate) {
      return aDate - bDate;
    }
    return (a.id ?? "").localeCompare(b.id ?? "");
  });

  const index = sorted.findIndex((message) => message.id === messageId);
  return index >= 0 ? index : null;
}

function buildThreadParticipants(
  messages: gmail_v1.Schema$Message[],
  accountEmail?: string | null,
  existingParticipants?: EmailThreadParticipant[]
): EmailThreadParticipant[] {
  const participants: EmailThreadParticipant[] = [];
  const seen = new Set<string>();
  const userEmail = accountEmail?.toLowerCase() ?? null;

  const pushParticipant = (entry: ParsedAddress, role: EmailThreadParticipant["role"]) => {
    const email = entry.email.trim();
    if (!email) return;
    const key = `${role ?? "unknown"}:${email.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    participants.push({
      name: entry.name ?? null,
      email,
      role,
      isUser: userEmail ? email.toLowerCase() === userEmail : undefined,
    });
  };

  for (const message of messages) {
    const headers = message.payload?.headers as gmail_v1.Schema$MessagePartHeader[] | undefined;
    if (!headers) continue;

    const fromHeader = getHeader(headers, "From");
    if (fromHeader) {
      const parsed = parseFromHeader(fromHeader);
      if (parsed.email) {
        pushParticipant(parsed, "from");
      }
    }

    const toHeader = getHeader(headers, "To");
    if (toHeader) {
      for (const parsed of parseAddressList(toHeader)) {
        pushParticipant(parsed, "to");
      }
    }

    const ccHeader = getHeader(headers, "Cc");
    if (ccHeader) {
      for (const parsed of parseAddressList(ccHeader)) {
        pushParticipant(parsed, "cc");
      }
    }

    const bccHeader = getHeader(headers, "Bcc");
    if (bccHeader) {
      for (const parsed of parseAddressList(bccHeader)) {
        pushParticipant(parsed, "bcc");
      }
    }
  }

  if (existingParticipants && Array.isArray(existingParticipants)) {
    for (const participant of existingParticipants) {
      const email = participant.email?.trim();
      if (!email) continue;
      const key = `${participant.role ?? "unknown"}:${email.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      participants.push(participant);
    }
  }

  return participants;
}

function deriveThreadTimestamps(
  messages: gmail_v1.Schema$Message[],
  fallback: string
): { firstMessageAt: string; lastMessageAt: string } {
  const timestamps = messages
    .map((message) => extractInternalDate(message))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (timestamps.length === 0) {
    return {
      firstMessageAt: fallback,
      lastMessageAt: fallback,
    };
  }

  const first = new Date(Math.min(...timestamps)).toISOString();
  const last = new Date(Math.max(...timestamps)).toISOString();

  return {
    firstMessageAt: first,
    lastMessageAt: last,
  };
}

function calculateRecentMessageCount(
  messages: gmail_v1.Schema$Message[],
  now: Date,
  activityWindowDays: number
): number {
  if (messages.length === 0) {
    return 0;
  }
  const cutoff = now.getTime() - activityWindowDays * 24 * 60 * 60 * 1000;
  return messages.reduce((count, message) => {
    const internalDate = extractInternalDate(message);
    if (internalDate && internalDate >= cutoff) {
      return count + 1;
    }
    return count;
  }, 0);
}

function determineThreadSubject(
  messages: gmail_v1.Schema$Message[],
  latestSubject: string,
  existingSubject?: string | null
): string {
  const sorted = [...messages].sort((a, b) => {
    const aDate = extractInternalDate(a) ?? 0;
    const bDate = extractInternalDate(b) ?? 0;
    if (aDate !== bDate) return aDate - bDate;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });

  for (const message of sorted) {
    const headers = message.payload?.headers as gmail_v1.Schema$MessagePartHeader[] | undefined;
    if (!headers) continue;
    const subject = getHeader(headers, "Subject");
    if (subject) {
      return canonicalizeSubject(subject);
    }
  }

  if (existingSubject) {
    return canonicalizeSubject(existingSubject);
  }

  return canonicalizeSubject(latestSubject);
}

export async function upsertEmailThread(
  params: UpsertEmailThreadParams
): Promise<UpsertEmailThreadResult | null> {
  const { supabase, userId, gmailThreadId, gmailThread, accountEmail, latestMessage } = params;
  const now = new Date();
  const nowIso = now.toISOString();

  const messages = gmailThread?.messages ?? [];

  const { data: existingThread, error: existingThreadError } = await supabase
    .from("email_threads")
    .select(
      "id, message_count, last_message_at, unread_count, labels, primary_label, participants, subject_canonical, first_message_at, priority_score, priority_components"
    )
    .eq("user_id", userId)
    .eq("gmail_thread_id", gmailThreadId)
    .maybeSingle();

  if (existingThreadError) {
    console.error(`Failed to load existing thread ${gmailThreadId}`, existingThreadError);
  }

  const existingParticipants = (existingThread?.participants ?? null) as EmailThreadParticipant[] | null;

  const participants = buildThreadParticipants(
    messages,
    accountEmail,
    existingParticipants ?? undefined
  );

  const { firstMessageAt, lastMessageAt } = deriveThreadTimestamps(
    messages,
    latestMessage.receivedAt
  );

  const messageCount = Math.max(messages.length, existingThread?.message_count ?? 0, 1);
  const unreadCountFromThread = messages.reduce((count, message) => {
    return count + (message.labelIds?.includes("UNREAD") ? 1 : 0);
  }, 0);

  const unreadCount =
    unreadCountFromThread > 0
      ? unreadCountFromThread
      : existingThread?.unread_count ??
        (latestMessage.isRead ? 0 : 1);

  const config = DEFAULT_THREAD_PRIORITY_CONFIG;
  const recentMessageCount =
    calculateRecentMessageCount(messages, now, config.heat.activityWindowDays) ||
    (existingThread?.message_count ?? 0);

  const threadDefaults: ThreadPriorityOptions["thread"] = existingThread
    ? {
        lastMessageAt: existingThread.last_message_at ?? undefined,
        messageCount: existingThread.message_count ?? undefined,
        unreadCount: existingThread.unread_count ?? undefined,
      }
    : null;

  const priorityInput = {
    lastMessageAt,
    messageCount,
    recentMessageCount,
    unreadCount,
  };

  const priority = calculateThreadPriority(priorityInput, {
    now,
    config,
    thread: threadDefaults,
  });

  const existingLabels = Array.isArray(existingThread?.labels) ? existingThread?.labels : [];
  const labelSet = new Set<string>(existingLabels);
  for (const label of latestMessage.labels) {
    if (label) {
      labelSet.add(label);
    }
  }

  const primaryLabel = latestMessage.category ?? existingThread?.primary_label ?? null;
  const subjectCanonical = determineThreadSubject(
    messages,
    latestMessage.subject,
    existingThread?.subject_canonical
  );

  const payload = {
    subject_canonical: subjectCanonical,
    participants,
    message_count: messageCount,
    first_message_at: firstMessageAt,
    last_message_at: lastMessageAt,
    unread_count: unreadCount,
    primary_label: primaryLabel,
    labels: Array.from(labelSet),
    priority_score: Number(priority.score.toFixed(2)),
    priority_components: priority.components,
    updated_at: nowIso,
  };

  if (existingThread?.id) {
    const { data: updated, error: updateError } = await supabase
      .from("email_threads")
      .update(payload)
      .eq("id", existingThread.id)
      .select("id, priority_score, priority_components, message_count, last_message_at")
      .maybeSingle();

    if (updateError) {
      console.error(`Failed to update thread ${gmailThreadId}`, updateError);
      return null;
    }

    if (!updated) {
      return null;
    }

    return {
      threadId: updated.id,
      priority,
      messageCount: updated.message_count ?? messageCount,
      lastMessageAt: updated.last_message_at ?? lastMessageAt,
    };
  }

  const insertPayload = {
    user_id: userId,
    gmail_thread_id: gmailThreadId,
    ...payload,
    created_at: nowIso,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("email_threads")
    .insert(insertPayload)
    .select("id, priority_score, priority_components, message_count, last_message_at")
    .maybeSingle();

  if (insertError) {
    console.error(`Failed to insert thread ${gmailThreadId}`, insertError);
    return null;
  }

  if (!inserted) {
    return null;
  }

  return {
    threadId: inserted.id,
    priority,
    messageCount: inserted.message_count ?? messageCount,
    lastMessageAt: inserted.last_message_at ?? lastMessageAt,
  };
}
