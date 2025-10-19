import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createOAuthClient, CALENDAR_SCOPES } from "@/lib/googleOAuth";
import { createServerSupabaseClient } from "@/lib/serverSupabase";
import { recordAuditLog } from "@/lib/auditLog";
import { listCalendars, upsertUserCalendarSources } from "@/lib/googleCalendarClient";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function renderMessage(script: string, message: string) {
  return new Response(
    `<!DOCTYPE html><html><head><title>Google Calendar</title></head><body><p>${message}</p><script>${script}</script></body></html>`,
    {
      headers: { "Content-Type": "text/html" },
    }
  );
}

function safeString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function mergeScopes(existingScopes: string[] | null | undefined, newScopes: string[]): string[] {
  const merged = new Set<string>();
  for (const scope of existingScopes ?? []) {
    if (scope) merged.add(scope);
  }
  for (const scope of newScopes) {
    if (scope) merged.add(scope);
  }
  return Array.from(merged);
}

async function resolveUserEmail(
  params: {
    oauthClient: ReturnType<typeof createOAuthClient>;
    tokens: Record<string, any>;
    existingEmail?: string | null;
    supabase: SupabaseClient;
    userId: string;
  }
): Promise<string | null> {
  const { oauthClient, tokens, existingEmail, supabase, userId } = params;

  if (existingEmail) {
    return existingEmail;
  }

  try {
    if (tokens.access_token) {
      const info = await oauthClient.getTokenInfo(tokens.access_token);
      if (info.email) {
        return info.email;
      }
    }
  } catch (err) {
    // ignore
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: oauthClient });
    const { data } = await calendar.calendarList.get({ calendarId: "primary" });
    if (data.id && data.id.includes("@")) {
      return data.id;
    }
  } catch (err) {
    // ignore calendar fallback errors
  }

  try {
    const oauth2 = google.oauth2({ version: "v2", auth: oauthClient });
    const { data } = await oauth2.userinfo.get();
    if (data.email) {
      return data.email;
    }
  } catch (err) {
    // ignore
  }

  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (!error && data?.user?.email) {
      return data.user.email;
    }
  } catch (err) {
    // ignore admin fallback errors
  }

  return null;
}

export async function GET(request: Request) {
  const clientResult = createServerSupabaseClient();
  if (!clientResult.ok) {
    return NextResponse.json({ error: clientResult.error }, { status: 500 });
  }

  const supabase = clientResult.supabase;

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  if (!state) {
    return renderMessage("window.close();", "Missing OAuth state.");
  }

  const { data: sessionRow, error: sessionError } = await supabase
    .from("oauth_sessions")
    .select("*")
    .eq("state", state)
    .maybeSingle();

  if (sessionError || !sessionRow) {
    return renderMessage("window.close();", "Session expired or not found. Please restart the connection.");
  }

  const { user_id: userId, redirect_to: redirectTo, expires_at: expiresAt } = sessionRow as {
    user_id: string;
    redirect_to: string | null;
    expires_at: string;
  };

  await supabase.from("oauth_sessions").delete().eq("state", state);

  if (new Date(expiresAt).getTime() < Date.now()) {
    return renderMessage("window.close();", "OAuth attempt expired. Please try again.");
  }

  if (errorParam) {
    await recordAuditLog(supabase, {
      projectId: null,
      userId,
      action: "calendar.oauth.denied",
      entity: "oauth_account",
      metadata: { error: errorParam },
    });

    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-calendar', status: 'error', message: '${errorParam}' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Google Calendar access was denied.");
  }

  if (!code) {
    return renderMessage("window.close();", "Missing authorization code.");
  }

  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/api/integrations/google-calendar/oauth/callback`;

  const oauthClient = createOAuthClient({ redirectUri });

  let tokenResponse;
  try {
    tokenResponse = await oauthClient.getToken(code);
  } catch (err: any) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-calendar', status: 'error', message: 'Token exchange failed' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Failed to exchange authorization code.");
  }

  const tokens = tokenResponse.tokens;
  oauthClient.setCredentials(tokens);

  const { data: existingAccount, error: fetchAccountError } = await supabase
    .from("oauth_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();

  if (fetchAccountError) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-calendar', status: 'error', message: 'Failed to load account' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Failed to load Google account state.");
  }

  if (!tokens.refresh_token && existingAccount?.refresh_token) {
    tokens.refresh_token = existingAccount.refresh_token as string;
  }

  if (!tokens.refresh_token) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-calendar', status: 'error', message: 'Missing refresh token' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Google did not return a refresh token. Ensure you allow offline access and try again.");
  }

  const accountEmail = await resolveUserEmail({
    oauthClient,
    tokens,
    existingEmail: existingAccount?.account_email as string | undefined,
    supabase,
    userId,
  });

  if (!accountEmail) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-calendar', status: 'error', message: 'Unable to determine account email' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Unable to determine the Google account email.");
  }

  const scopeString = tokens.scope ?? safeString(url.searchParams.get("scope"));
  const grantedScopes = scopeString ? scopeString.split(/\s+/g).filter(Boolean) : [];
  const combinedScopes = mergeScopes(existingAccount?.scopes as string[] | undefined, grantedScopes);

  for (const scope of CALENDAR_SCOPES) {
    if (!combinedScopes.includes(scope)) {
      combinedScopes.push(scope);
    }
  }

  const expiresAtIso = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : new Date(Date.now() + 55 * 60 * 1000).toISOString();

  const existingMetadata = (existingAccount?.token_metadata as Record<string, unknown> | null) ?? {};
  const existingFeatures = (existingMetadata.features as Record<string, unknown> | undefined) ?? {};
  const features = {
    ...existingFeatures,
    calendar: true,
  } as Record<string, unknown>;

  const tokenMetadata: Record<string, unknown> = {
    ...existingMetadata,
    ...tokens,
    features,
    lastCalendarConnectedAt: new Date().toISOString(),
  };

  const upsertPayload = {
    user_id: userId,
    provider: "google",
    account_email: accountEmail,
    scopes: combinedScopes,
    access_token: tokens.access_token ?? (existingAccount?.access_token as string | undefined) ?? "",
    refresh_token: tokens.refresh_token,
    expires_at: expiresAtIso,
    token_metadata: tokenMetadata,
  };

  const { error: upsertError, data: upserted } = await supabase
    .from("oauth_accounts")
    .upsert(upsertPayload, { onConflict: "user_id,provider" })
    .select("*")
    .maybeSingle();

  if (upsertError) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-calendar', status: 'error', message: 'Failed to persist Calendar account' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Failed to save Google Calendar credentials.");
  }

  let accountId: string | undefined = typeof upserted?.id === "string" ? upserted.id : undefined;
  if (!accountId && typeof existingAccount?.id === "string") {
    accountId = existingAccount.id as string;
  }

  if (!accountId) {
    try {
      const { data: fallbackAccount } = await supabase
        .from("oauth_accounts")
        .select("id")
        .eq("user_id", userId)
        .eq("provider", "google")
        .maybeSingle();
      if (fallbackAccount?.id) {
        accountId = fallbackAccount.id as string;
      }
    } catch (err) {
      console.error("Failed to locate Google account id after OAuth", err);
    }
  }

  await recordAuditLog(supabase, {
    projectId: null,
    userId,
    action: "calendar.oauth.connected",
    entity: "oauth_account",
    refId: accountId ?? null,
    metadata: {
      accountEmail,
      scopes: combinedScopes,
    },
  });

  // Auto-connect user calendars after OAuth
  if (!accountId) {
    console.error("Skipping calendar auto-connect; missing Google account id", { userId });
  } else {
    try {
      const calendar = google.calendar({ version: "v3", auth: oauthClient });
      const summaries = await listCalendars(calendar);
      if (summaries.length > 0) {
        await upsertUserCalendarSources({
          supabase,
          userId,
          accountId,
          calendars: summaries,
        });
      }
    } catch (err) {
      // Log but don't fail - user can manually connect calendars later
      console.error("Failed to auto-connect calendars:", err);
    }
  }

  const payload = {
    source: "kazador-calendar",
    status: "success",
    accountEmail,
    scopes: combinedScopes,
    redirectTo,
  };

  const script = `window.opener?.postMessage(${JSON.stringify(payload)}, '*'); window.close();`;
  return renderMessage(script, "Google Calendar connected! Your calendars are now syncing. You can close this window.");
}
