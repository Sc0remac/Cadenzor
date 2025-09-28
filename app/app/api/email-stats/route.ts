import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { EmailRecord } from "@cadenzor/shared";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  // Query unread messages and group by category
  const { data, error } = await supabase
    .from("emails")
    .select("category, count: count()")
    .eq("is_read", false)
    .group("category");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const result: Record<EmailRecord["category"], number> = {} as any;
  for (const row of data as any[]) {
    result[row.category as EmailRecord["category"]] = row.count;
  }
  return NextResponse.json(result);
}