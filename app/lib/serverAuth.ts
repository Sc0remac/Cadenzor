import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "./serverSupabase";

type RequireUserSuccess = {
  ok: true;
  supabase: SupabaseClient;
  user: User;
};

type RequireUserError = {
  ok: false;
  status: number;
  error: string;
};

export type RequireUserResult = RequireUserSuccess | RequireUserError;

export async function requireAuthenticatedUser(
  request: Request
): Promise<RequireUserResult> {
  const authHeader =
    request.headers.get("authorization") ?? request.headers.get("Authorization");

  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "Missing bearer token" };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { ok: false, status: 401, error: "Missing access token" };
  }

  const clientResult = createServerSupabaseClient();
  if (!clientResult.ok) {
    return { ok: false, status: 500, error: clientResult.error };
  }

  const { supabase } = clientResult;
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return {
      ok: false,
      status: 401,
      error: error?.message || "Invalid or expired access token",
    };
  }

  return { ok: true, supabase, user: data.user };
}
