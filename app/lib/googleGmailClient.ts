import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthAccountRecord } from "@kazador/shared";
import {
  ensureGoogleOAuthClient,
  getGoogleAccount,
  getGoogleAccountById,
  mapGoogleOAuthAccountRow,
  deleteGoogleAccount,
} from "./googleAccount";
import { GMAIL_SCOPES } from "./googleOAuth";

const REQUIRED_GMAIL_SCOPES = new Set(GMAIL_SCOPES);

export function hasGmailScopes(account: OAuthAccountRecord | null): account is OAuthAccountRecord {
  if (!account) return false;
  const scopes = Array.isArray(account.scopes) ? account.scopes : [];
  return Array.from(REQUIRED_GMAIL_SCOPES).every((scope) => scopes.includes(scope));
}

export async function getGmailAccount(
  supabase: SupabaseClient,
  options: { userId: string; accountId?: string }
): Promise<OAuthAccountRecord | null> {
  const account = await getGoogleAccount(supabase, options);
  if (!hasGmailScopes(account)) {
    return null;
  }
  return account;
}

export async function getGmailAccountById(
  supabase: SupabaseClient,
  accountId: string
): Promise<OAuthAccountRecord | null> {
  const account = await getGoogleAccountById(supabase, accountId);
  if (!hasGmailScopes(account)) {
    return null;
  }
  return account;
}

export async function ensureGmailOAuthClient(
  supabase: SupabaseClient,
  account: OAuthAccountRecord
) {
  if (!hasGmailScopes(account)) {
    throw new Error("Google account does not include Gmail scopes");
  }
  return ensureGoogleOAuthClient(supabase, account);
}

export async function disconnectGmailAccount(
  supabase: SupabaseClient,
  accountId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("oauth_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return;
  }

  const account = mapGoogleOAuthAccountRow(data as any);
  const remainingScopes = (account.scopes ?? []).filter((scope) => !REQUIRED_GMAIL_SCOPES.has(scope));

  if (remainingScopes.length === 0) {
    await deleteGoogleAccount(supabase, accountId);
    return;
  }

  const metadata = (account.tokenMetadata ?? {}) as Record<string, unknown>;
  const features = (metadata.features as Record<string, unknown> | undefined) ?? {};

  metadata.features = {
    ...features,
    gmail: false,
  };
  metadata.lastGmailDisconnectedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("oauth_accounts")
    .update({
      scopes: remainingScopes,
      token_metadata: metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);

  if (updateError) {
    throw updateError;
  }
}
