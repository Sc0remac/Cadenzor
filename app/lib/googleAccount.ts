import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthAccountRecord } from "@kazador/shared";
import { createOAuthClient } from "./googleOAuth";

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export interface GoogleOAuthAccountRow {
  id: string;
  user_id: string;
  provider: string;
  account_email: string;
  scopes: string[];
  access_token: string;
  refresh_token: string;
  expires_at: string;
  token_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export function mapGoogleOAuthAccountRow(row: GoogleOAuthAccountRow): OAuthAccountRecord {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider as OAuthAccountRecord["provider"],
    accountEmail: row.account_email,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    tokenMetadata: (row.token_metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getGoogleAccount(
  supabase: SupabaseClient,
  options: { userId: string; accountId?: string }
): Promise<OAuthAccountRecord | null> {
  const { userId, accountId } = options;

  let query = supabase
    .from("oauth_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "google")
    .limit(1);

  if (accountId) {
    query = query.eq("id", accountId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  return mapGoogleOAuthAccountRow(data as unknown as GoogleOAuthAccountRow);
}

export async function getGoogleAccountById(
  supabase: SupabaseClient,
  accountId: string
): Promise<OAuthAccountRecord | null> {
  const { data, error } = await supabase
    .from("oauth_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return mapGoogleOAuthAccountRow(data as unknown as GoogleOAuthAccountRow);
}

export async function ensureGoogleOAuthClient(
  supabase: SupabaseClient,
  account: OAuthAccountRecord
) {
  const client = createOAuthClient();
  client.setCredentials({
    refresh_token: account.refreshToken,
    access_token: account.accessToken,
    expiry_date: Date.parse(account.expiresAt) || undefined,
    scope: account.scopes?.join(" ") ?? undefined,
  });

  const needsRefresh =
    !account.accessToken ||
    !account.expiresAt ||
    Date.parse(account.expiresAt) - TOKEN_EXPIRY_BUFFER_MS < Date.now();

  if (needsRefresh) {
    const refreshResponse = await client.refreshAccessToken();
    const credentials = refreshResponse.credentials;
    const updated: Record<string, unknown> = {};

    if (credentials.access_token) {
      updated.access_token = credentials.access_token;
      client.setCredentials({
        refresh_token: account.refreshToken,
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date,
        scope: credentials.scope,
      });
    }

    if (credentials.expiry_date) {
      updated.expires_at = new Date(credentials.expiry_date).toISOString();
    }

    if (credentials.scope) {
      updated.scopes = credentials.scope.split(/\s+/g);
    }

    if (Object.keys(updated).length > 0) {
      updated.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from("oauth_accounts")
        .update(updated)
        .eq("id", account.id);
      if (error) {
        throw error;
      }
    }
  }

  return client;
}

export async function deleteGoogleAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<void> {
  const { error } = await supabase.from("oauth_accounts").delete().eq("id", accountId);
  if (error) {
    throw error;
  }
}
