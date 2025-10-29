import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ClientResult =
  | { ok: true; supabase: SupabaseClient }
  | { ok: false; error: string };

const URL_ENV_VAR = "SUPABASE_URL" as const;
const SERVICE_KEY_ENV_VAR = "SUPABASE_SERVICE_ROLE_KEY" as const;
const ANON_KEY_ENV_VAR = "SUPABASE_ANON_KEY" as const;

export function createServerSupabaseClient(accessToken?: string): ClientResult {
  const url =
    process.env[URL_ENV_VAR] ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;

  // Use SERVICE_ROLE_KEY for server-side operations
  // RLS policies are designed to work with service role + created_by checks
  const key =
    process.env[SERVICE_KEY_ENV_VAR] ??
    process.env[ANON_KEY_ENV_VAR] ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    null;

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

  const options: Parameters<typeof createClient>[2] = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        // Increase timeout to 30 seconds for better reliability
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
          // If there's already a signal, we need to handle both
          if (init?.signal) {
            const existingSignal = init.signal;
            existingSignal.addEventListener("abort", () => controller.abort());
          }

          return await fetch(input, {
            ...init,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
      },
    },
  };

  if (accessToken) {
    options.global = {
      ...options.global,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };
  }

  const supabase = createClient(url, key, options);

  return { ok: true, supabase };
}
