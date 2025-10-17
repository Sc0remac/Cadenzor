import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createOAuthClient, GMAIL_SCOPES } from "@/lib/googleOAuth";
import { createServerSupabaseClient } from "@/lib/serverSupabase";
import { recordAuditLog } from "@/lib/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function renderMessage(script: string, message: string) {
  return new Response(
    `<!DOCTYPE html><html><head><title>Google Gmail</title></head><body><p>${message}</p><script>${script}</script></body></html>`,
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
      action: "gmail.oauth.denied",
      entity: "oauth_account",
      metadata: { error: errorParam },
    });

    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-gmail', status: 'error', message: '${errorParam}' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Google Gmail access was denied.");
  }

  if (!code) {
    return renderMessage("window.close();", "Missing authorization code.");
  }

  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/api/integrations/gmail/oauth/callback`;

  const oauthClient = createOAuthClient({ redirectUri });

  let tokenResponse;
  try {
    tokenResponse = await oauthClient.getToken(code);
  } catch (err: any) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-gmail', status: 'error', message: 'Token exchange failed' }, '*'); window.close();`
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
      ? `window.opener?.postMessage({ source: 'kazador-gmail', status: 'error', message: 'Failed to load account' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Failed to load Google account state.");
  }

  if (!tokens.refresh_token && existingAccount?.refresh_token) {
    tokens.refresh_token = existingAccount.refresh_token as string;
  }

  if (!tokens.refresh_token) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-gmail', status: 'error', message: 'Missing refresh token' }, '*'); window.close();`
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
      // Ignore errors and try Drive fallback below.
    }
  }

  if (!accountEmail) {
    try {
      const drive = google.drive({ version: "v3", auth: oauthClient });
      const { data } = await drive.about.get({ fields: "user(emailAddress)" });
      accountEmail = data.user?.emailAddress ?? accountEmail;
    } catch (err) {
      // Ignore Drive fallback errors.
    }
  }

  if (!accountEmail) {
    const script = redirectTo
      ? `window.opener?.postMessage({ source: 'kazador-gmail', status: 'error', message: 'Unable to determine account email' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Unable to determine the Google account email.");
  }

  const scopeString = tokens.scope ?? safeString(url.searchParams.get("scope"));
  const grantedScopes = scopeString ? scopeString.split(/\s+/g).filter(Boolean) : [];
  const combinedScopes = mergeScopes(existingAccount?.scopes as string[] | undefined, grantedScopes);

  // Ensure Gmail scopes are present even if Google omits them in the response string.
  for (const scope of GMAIL_SCOPES) {
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
    gmail: true,
  } as Record<string, unknown>;

  const tokenMetadata: Record<string, unknown> = {
    ...existingMetadata,
    ...tokens,
    features,
    lastGmailConnectedAt: new Date().toISOString(),
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
      ? `window.opener?.postMessage({ source: 'kazador-gmail', status: 'error', message: 'Failed to persist Gmail account' }, '*'); window.close();`
      : "window.close();";
    return renderMessage(script, "Failed to save Google Gmail credentials.");
  }

  await recordAuditLog(supabase, {
    projectId: null,
    userId,
    action: "gmail.oauth.connected",
    entity: "oauth_account",
    refId: upserted?.id ?? null,
    metadata: {
      accountEmail,
      scopes: combinedScopes,
    },
  });

  const payload = {
    source: "kazador-gmail",
    status: "success",
    accountEmail,
    scopes: combinedScopes,
    redirectTo,
  };

  const script = `window.opener?.postMessage(${JSON.stringify(payload)}, '*'); window.close();`;
  return renderMessage(script, "Google Gmail connected. You can close this window.");
}
