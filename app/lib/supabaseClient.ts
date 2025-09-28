import { createClient } from "@supabase/supabase-js";
import type { EmailCategory, EmailRecord } from "@cadenzor/shared";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase environment variables are not set. The frontend may not function correctly until NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are configured."
  );
}

export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export async function fetchEmailStats(): Promise<Record<EmailRecord["category"], number>> {
  const { data, error } = await supabaseClient
    .from("emails")
    .select("category, count: count()")
    .eq("is_read", false)
    .group("category");
  if (error) {
    console.error("Failed to fetch email stats:", error);
    return {} as any;
  }
  const result: Partial<Record<EmailRecord["category"], number>> = {};
  for (const row of data as any[]) {
    result[row.category as EmailRecord["category"]] = row.count;
  }
  return result as Record<EmailRecord["category"], number>;
}

interface EmailRow {
  id: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  received_at: string;
  category: EmailCategory;
  is_read: boolean;
  summary: string | null;
  labels: EmailCategory[] | string | null;
}

function normaliseLabels(value: EmailRow["labels"]): EmailCategory[] {
  if (Array.isArray(value)) {
    return value.filter((label): label is EmailCategory => typeof label === "string");
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value as EmailCategory];
  }
  return [];
}

function normaliseEmailRow(row: EmailRow): EmailRecord {
  return {
    id: row.id,
    fromName: row.from_name,
    fromEmail: row.from_email,
    subject: row.subject,
    receivedAt: row.received_at,
    category: row.category,
    isRead: row.is_read,
    summary: row.summary,
    labels: normaliseLabels(row.labels),
  };
}

export async function fetchRecentEmails(limit = 25): Promise<EmailRecord[]> {
  const { data, error } = await supabaseClient
    .from("emails")
    .select(
      "id, from_name, from_email, subject, received_at, category, is_read, summary, labels"
    )
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to fetch recent emails:", error);
    throw error;
  }

  if (!data) return [];

  return (data as EmailRow[]).map(normaliseEmailRow);
}
