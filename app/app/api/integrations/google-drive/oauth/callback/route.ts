import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createOAuthClient } from "@/lib/googleOAuth";
import { createServerSupabaseClient } from "@/lib/serverSupabase";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function renderMessage(script: string, message: string) {
  return new Response(
    `<!DOCTYPE html><html><head><title>Google Drive</title></head><body><p>${message}</p><script>${script}</script></body></html>`,
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

  // Clean up session immediately to prevent replay attacks
  await supabase.from("oauth_sessions").delete().eq("state", state);

  if (new Date(expiresAt).getTime() < Date.now()) {
    return renderMessage("window.close();", "OAuth attempt expired. Please try again.");
  }

  if (errorParam) {
    await recordAuditLog(supabase, {
      projectId: null,
      userId,
      action: "drive.oauth.denied",
      entity: "oauth_account",
      metadata: { error: errorParam },
    });

    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'cadenzor-drive', status: 'error', message: '${errorParam}' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Google Drive access was denied.");
  }

  if (!code) {
    return renderMessage("window.close();", "Missing authorization code.");
  }

  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/api/integrations/google-drive/oauth/callback`;

  const oauthClient = createOAuthClient({ redirectUri });

  let tokenResponse;
  try {
    tokenResponse = await oauthClient.getToken(code);
  } catch (err: any) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'cadenzor-drive', status: 'error', message: 'Token exchange failed' }, '*'); window.close();`
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
      ? `window.opener?.postMessage({ source: 'cadenzor-drive', status: 'error', message: 'Failed to load Drive account' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Failed to load existing Drive account state.");
  }

  if (!tokens.refresh_token && existingAccount?.refresh_token) {
    tokens.refresh_token = existingAccount.refresh_token as string;
  }

  if (!tokens.refresh_token) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'cadenzor-drive', status: 'error', message: 'Missing refresh token' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Google did not return a refresh token. Ensure you allow offline access and try again.");
  }

  let tokenInfo: Awaited<ReturnType<typeof oauthClient.getTokenInfo>> | null = null;
  try {
    if (tokens.access_token) {
      tokenInfo = await oauthClient.getTokenInfo(tokens.access_token);
    }
  } catch (err) {
    tokenInfo = null;
  }

  let accountEmail = tokenInfo?.email ?? (existingAccount?.account_email as string | undefined) ?? "";

  if (!accountEmail) {
    try {
      const gmail = google.gmail({ version: "v1", auth: oauthClient });
      const { data } = await gmail.users.getProfile({ userId: "me" });
      accountEmail = data.emailAddress ?? accountEmail;
    } catch (err) {
      // Ignore Gmail fallback errors and try Drive API below.
    }
  }

  if (!accountEmail) {
    try {
      const drive = google.drive({ version: "v3", auth: oauthClient });
      const { data } = await drive.about.get({ fields: "user(emailAddress)" });
      accountEmail = data.user?.emailAddress ?? accountEmail;
    } catch (err) {
      // Ignore Drive fallback errors and handle missing email later.
    }
  }

  if (!accountEmail) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'cadenzor-drive', status: 'error', message: 'Unable to determine account email' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Unable to determine the Google account email.");
  }

  const scopeString = tokens.scope ?? safeString(url.searchParams.get("scope"));
  const scopes = scopeString ? scopeString.split(/\s+/g).filter(Boolean) : [];
  const expiresAtIso = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : new Date(Date.now() + 55 * 60 * 1000).toISOString();

  const upsertPayload = {
    user_id: userId,
    provider: "google",
    account_email: accountEmail,
    scopes,
    access_token: tokens.access_token ?? existingAccount?.access_token ?? "",
    refresh_token: tokens.refresh_token,
    expires_at: expiresAtIso,
    token_metadata: tokens,
  };

  const { error: upsertError, data: upserted } = await supabase
    .from("oauth_accounts")
    .upsert(upsertPayload, { onConflict: "user_id,provider" })
    .select("*")
    .maybeSingle();

  if (upsertError) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'cadenzor-drive', status: 'error', message: 'Failed to persist Drive account' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Failed to save Google Drive credentials.");
  }

  await recordAuditLog(supabase, {
    projectId: null,
    userId,
    action: "drive.oauth.connected",
    entity: "oauth_account",
    refId: upserted?.id ?? null,
    metadata: {
      accountEmail,
      scopes,
    },
  });

  const payload = {
    source: "cadenzor-drive",
    status: "success",
    accountEmail,
    scopes,
    redirectTo,
  };

  const script = `window.opener?.postMessage(${JSON.stringify(payload)}, '*'); window.close();`;
  return renderMessage(script, "Google Drive connected. You can close this window.");
}
