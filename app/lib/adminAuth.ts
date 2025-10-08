import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireAuthenticatedUser } from "./serverAuth";

export interface AdminProfileRow {
  id: string;
  email: string | null;
  fullName: string | null;
  isAdmin: boolean;
}

export type RequireAdminResult =
  | { ok: true; supabase: SupabaseClient; user: User; profile: AdminProfileRow }
  | { ok: false; status: number; error: string };

export async function requireAdminUser(
  request: Request
): Promise<RequireAdminResult> {
  const authResult = await requireAuthenticatedUser(request);

  if (!authResult.ok) {
    return authResult;
  }

  const { supabase, user } = authResult;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      error: error.message ?? "Failed to verify admin permissions",
    };
  }

  const isAdmin = Boolean(data?.is_admin);

  if (!isAdmin) {
    return {
      ok: false,
      status: 403,
      error: "Administrator access required",
    };
  }

  return {
    ok: true,
    supabase,
    user,
    profile: {
      id: user.id,
      email: (data?.email as string | null) ?? user.email ?? null,
      fullName: (data?.full_name as string | null) ?? user.user_metadata?.full_name ?? null,
      isAdmin: true,
    },
  };
}
