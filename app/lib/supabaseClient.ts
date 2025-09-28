import { createClient } from "@supabase/supabase-js";
import type { EmailRecord } from "@cadenzor/shared";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase environment variables are not set. The frontend may not function correctly until NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are configured."
  );
}

export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Fetch aggregated counts of unread emails by category from Supabase. This
 * helper calls Supabase via RPC to group messages. It returns an object
 * mapping category names to counts. If the query fails it returns an empty
 * object.
 */
export async function fetchEmailStats(): Promise<Record<EmailRecord["category"], number>> {
  // Query the emails table and group by category. We filter for unread
  // messages only. Supabase's query builder doesn't support group by
  // operations directly on the client; instead we leverage the Postgres
  // `rpc` call defined in the database or run an aggregated query via SQL.
  const { data, error } = await supabaseClient
    .from("emails")
    .select("category, count: count()")
    .eq("is_read", false)
    .group("category");
  if (error) {
    console.error("Failed to fetch email stats:", error);
    return {} as any;
  }
  const result: any = {};
  for (const row of data as any[]) {
    result[row.category as EmailRecord["category"]] = row.count;
  }
  return result;
}