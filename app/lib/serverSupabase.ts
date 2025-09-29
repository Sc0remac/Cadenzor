import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ClientResult =
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; error: string };

const URL_ENV_VAR = "SUPABASE_URL" as const;
const SERVICE_KEY_ENV_VAR = "SUPABASE_SERVICE_ROLE_KEY" as const;
const ANON_KEY_ENV_VAR = "SUPABASE_ANON_KEY" as const;

export function createServerSupabaseClient(): ClientResult {
  const url = process.env[URL_ENV_VAR];
  const key = process.env[SERVICE_KEY_ENV_VAR] ?? process.env[ANON_KEY_ENV_VAR];

  if (!url || !key) {
    const missing: string[] = [];

    if (!url) {
      missing.push(URL_ENV_VAR);
    }

    if (!key) {
      missing.push(`${SERVICE_KEY_ENV_VAR} or ${ANON_KEY_ENV_VAR}`);
    }

    return {
      ok: false,
      error: `Missing required environment variables: ${missing.join(", ")}`,
    };
  }

  const supabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return { ok: true, supabase };
}
