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

function decodeJwtPayload(token: string): Record<string, any> | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const decoded = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (err) {
    return null;
  }
}

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

  const clientResult = createServerSupabaseClient(token);
  if (!clientResult.ok) {
    return { ok: false, status: 500, error: clientResult.error };
  }

  const { supabase } = clientResult;
  let data: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"] | null = null;
  let error: Awaited<ReturnType<typeof supabase.auth.getUser>>["error"] | null = null;
  let networkFailure: Error | null = null;

  try {
    const response = await supabase.auth.getUser(token);
    data = response.data;
    error = response.error;
  } catch (err) {
    networkFailure = err instanceof Error ? err : new Error("Auth request failed");
    console.error("Supabase auth network error:", {
      message: networkFailure.message,
      name: networkFailure.name,
      code: (err as any)?.code,
    });
  }

  if (data?.user) {
    return { ok: true, supabase, user: data.user };
  }

  if (!networkFailure) {
    return {
      ok: false,
      status: 401,
      error: error?.message || "Invalid or expired access token",
    };
  }

  // Network failure occurred - use JWT fallback
  const decoded = decodeJwtPayload(token);
  if (!decoded?.sub || typeof decoded.sub !== "string") {
    console.error("JWT fallback failed - invalid token payload", {
      hasDecoded: !!decoded,
      hasSub: !!decoded?.sub,
      subType: typeof decoded?.sub,
    });
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired access token",
    };
  }

  const issuedAt = typeof decoded.iat === "number" ? new Date(decoded.iat * 1000).toISOString() : new Date().toISOString();
  const lastSignIn = typeof decoded.exp === "number" ? new Date(decoded.exp * 1000).toISOString() : undefined;

  const fallbackUser: User = {
    id: decoded.sub,
    app_metadata: typeof decoded.app_metadata === "object" && decoded.app_metadata !== null ? decoded.app_metadata : {},
    user_metadata: typeof decoded.user_metadata === "object" && decoded.user_metadata !== null ? decoded.user_metadata : {},
    aud: typeof decoded.aud === "string" ? decoded.aud : "authenticated",
    email: typeof decoded.email === "string" ? decoded.email : undefined,
    phone: typeof decoded.phone === "string" ? decoded.phone : undefined,
    role: typeof decoded.role === "string" ? decoded.role : undefined,
    created_at: issuedAt,
    confirmed_at: undefined,
    email_confirmed_at: undefined,
    phone_confirmed_at: undefined,
    last_sign_in_at: lastSignIn,
    updated_at: undefined,
    confirmation_sent_at: undefined,
    recovery_sent_at: undefined,
    email_change_sent_at: undefined,
    invited_at: undefined,
    action_link: undefined,
    new_email: undefined,
    new_phone: undefined,
    identities: [],
    is_anonymous: false,
    is_sso_user: false,
    factors: [],
    deleted_at: undefined,
  };

  console.warn("Supabase auth lookup failed; using decoded JWT payload", {
    message: networkFailure.message,
  });

  return { ok: true, supabase, user: fallbackUser };
}
