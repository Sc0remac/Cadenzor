import { config } from "dotenv";
config();

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  calculateEmailInboxPriority,
  DEFAULT_PRIORITY_CONFIG,
  normalizePriorityConfigInput,
  type EmailLabel,
  type EmailTriageState,
  type PriorityConfig,
  type PriorityConfigInput,
} from "@kazador/shared";

type ServiceClient = SupabaseClient<any, any, any>;

interface EmailRow {
  id: string;
  user_id: string | null;
  category: EmailLabel;
  labels: EmailLabel[] | null;
  received_at: string | null;
  is_read: boolean | null;
  triage_state: string | null;
  snoozed_until: string | null;
}

async function loadPriorityConfigs(client: ServiceClient): Promise<Map<string, PriorityConfig>> {
  const cache = new Map<string, PriorityConfig>();

  const { data, error } = await client
    .from("user_preferences")
    .select("user_id, priority_config");

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    const userId = typeof row.user_id === "string" ? row.user_id : null;
    if (!userId) continue;

    try {
      const config = normalizePriorityConfigInput(
        (row.priority_config as PriorityConfigInput | null) ?? null,
        DEFAULT_PRIORITY_CONFIG
      );
      cache.set(userId, config);
    } catch (err) {
      console.warn(`Failed to parse priority config for user ${userId}`, err);
    }
  }

  return cache;
}

function getPriorityConfigForUser(
  cache: Map<string, PriorityConfig>,
  userId: string | null
): PriorityConfig {
  if (!userId) {
    return DEFAULT_PRIORITY_CONFIG;
  }
  return cache.get(userId) ?? DEFAULT_PRIORITY_CONFIG;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    process.exit(1);
  }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let priorityConfigs: Map<string, PriorityConfig>;
  try {
    priorityConfigs = await loadPriorityConfigs(client);
  } catch (err) {
    console.error("Failed to load priority configs", err);
    process.exit(1);
  }

  const batchSize = Number(process.env.BACKFILL_BATCH_SIZE || 500);
  let offset = 0;
  let processed = 0;

  for (;;) {
    const { data, error } = await client
      .from("emails")
      .select(
        "id, user_id, category, labels, received_at, is_read, triage_state, snoozed_until"
      )
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("Failed to load emails", error);
      process.exit(1);
    }

    const rows = (data as EmailRow[] | null) ?? [];
    if (rows.length === 0) {
      break;
    }

    const updates = rows
      .map((row) => {
        const userId = row.user_id ?? null;
        if (!userId) {
          return null;
        }

        const priorityConfig = getPriorityConfigForUser(priorityConfigs, userId);
        const labels = Array.isArray(row.labels) ? (row.labels as EmailLabel[]) : [];
        const triageState = (row.triage_state as EmailTriageState | null) ?? "unassigned";
        const priorityScore = calculateEmailInboxPriority(
          {
            category: row.category,
            labels,
            receivedAt: row.received_at ?? new Date().toISOString(),
            isRead: Boolean(row.is_read),
            triageState,
            snoozedUntil: row.snoozed_until,
          },
          { config: priorityConfig }
        );

        return { id: row.id, priority_score: priorityScore };
      })
      .filter((update): update is { id: string; priority_score: number } => Boolean(update));

    for (const update of updates) {
      const { error: updateError } = await client
        .from("emails")
        .update({ priority_score: update.priority_score })
        .eq("id", update.id);

      if (updateError) {
        console.error("Failed to update priority scores", updateError);
        process.exit(1);
      }
    }

    processed += rows.length;
    offset += rows.length;
    console.log(`Processed ${processed} emails...`);
  }

  console.log(`Email priority backfill complete. Processed ${processed} records.`);
}

main().catch((err) => {
  console.error("Backfill failed", err);
  process.exit(1);
});
