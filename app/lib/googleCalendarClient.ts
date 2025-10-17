import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthAccountRecord } from "@kazador/shared";
import {
  ensureGoogleOAuthClient,
  getGoogleAccount,
  getGoogleAccountById,
  mapGoogleOAuthAccountRow,
  deleteGoogleAccount,
} from "./googleAccount";
import { CALENDAR_SCOPES } from "./googleOAuth";

const REQUIRED_CALENDAR_SCOPES = new Set(CALENDAR_SCOPES);

export function hasCalendarScopes(account: OAuthAccountRecord | null): account is OAuthAccountRecord {
  if (!account) return false;
  const scopes = Array.isArray(account.scopes) ? account.scopes : [];
  return Array.from(REQUIRED_CALENDAR_SCOPES).every((scope) => scopes.includes(scope));
}

export async function getCalendarAccount(
  supabase: SupabaseClient,
  options: { userId: string; accountId?: string }
): Promise<OAuthAccountRecord | null> {
  const account = await getGoogleAccount(supabase, options);
  if (!hasCalendarScopes(account)) {
    return null;
  }
  return account;
}

export async function getCalendarAccountById(
  supabase: SupabaseClient,
  accountId: string
): Promise<OAuthAccountRecord | null> {
  const account = await getGoogleAccountById(supabase, accountId);
  if (!hasCalendarScopes(account)) {
    return null;
  }
  return account;
}

export async function ensureCalendarOAuthClient(
  supabase: SupabaseClient,
  account: OAuthAccountRecord
) {
  if (!hasCalendarScopes(account)) {
    throw new Error("Google account does not include Calendar scopes");
  }
  return ensureGoogleOAuthClient(supabase, account);
}

export async function disconnectCalendarAccount(
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
  const remainingScopes = (account.scopes ?? []).filter((scope) => !REQUIRED_CALENDAR_SCOPES.has(scope));

  if (remainingScopes.length === 0) {
    await deleteGoogleAccount(supabase, accountId);
    return;
  }

  const metadata = (account.tokenMetadata ?? {}) as Record<string, unknown>;
  const features = (metadata.features as Record<string, unknown> | undefined) ?? {};

  metadata.features = {
    ...features,
    calendar: false,
  };
  metadata.lastCalendarDisconnectedAt = new Date().toISOString();

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
