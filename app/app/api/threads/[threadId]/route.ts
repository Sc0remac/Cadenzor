import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/serverAuth";
import { enrichEmailRecords } from "../../emails/utils";
import {
  THREAD_EMAIL_SELECT_COLUMNS,
  THREAD_SELECT_COLUMNS,
  mapThreadEmailRow,
  mapThreadRow,
  mergeThreadEmailMetadata,
} from "../utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  threadId: string;
}

export async function GET(
  request: Request,
  { params }: { params: RouteParams }
) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const { supabase, user } = authResult;
  const { threadId } = params;

  const { data: threadRow, error: threadError } = await supabase
    .from("email_threads")
    .select(THREAD_SELECT_COLUMNS)
    .eq("id", threadId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (threadError) {
    console.error("Failed to load email thread", { threadId, userId: user.id, error: threadError });
    return NextResponse.json({ error: threadError.message }, { status: 500 });
  }

  if (!threadRow) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const { data: emailRows, error: emailError } = await supabase
    .from("emails")
    .select(THREAD_EMAIL_SELECT_COLUMNS)
    .eq("thread_id", threadId)
    .eq("user_id", user.id)
    .order("message_index", { ascending: true, nullsFirst: true })
    .order("received_at", { ascending: true, nullsFirst: true });

  if (emailError) {
    console.error("Failed to load thread emails", { threadId, userId: user.id, error: emailError });
    return NextResponse.json({ error: emailError.message }, { status: 500 });
  }

  const emailRowById = new Map<string, any>();
  const baseEmailRecords = Array.isArray(emailRows)
    ? emailRows.map((row) => {
        emailRowById.set(row.id as string, row);
        return mapThreadEmailRow(row);
      })
    : [];

  const enrichedEmails = await enrichEmailRecords(supabase, user.id, baseEmailRecords);

  const threadEmails = enrichedEmails
    .map((email) => {
      const raw = emailRowById.get(email.id) ?? {};
      const attachments = email.attachments ?? null;
      return mergeThreadEmailMetadata(email, raw, attachments ?? undefined);
    })
    .sort((a, b) => {
      const aIndex = a.messageIndex ?? Number.MAX_SAFE_INTEGER;
      const bIndex = b.messageIndex ?? Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }
      return a.receivedAt.localeCompare(b.receivedAt);
    });

  const thread = mapThreadRow(threadRow);

  return NextResponse.json({
    thread: {
      ...thread,
      emails: threadEmails,
    },
  });
}
