import { config } from "dotenv";
config();

import { google, gmail_v1 } from "googleapis";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EmailLabel,
  analyzeEmail,
  normaliseLabels,
  ensureDefaultLabelCoverage,
  selectPrimaryCategory,
  heuristicLabels,
  calculateEmailInboxPriority,
  DEFAULT_PRIORITY_CONFIG,
  normalizePriorityConfigInput,
  type EmailTriageState,
  type PriorityConfig,
  type PriorityConfigInput,
  type ProjectAssignmentRule,
} from "@kazador/shared";
import { classifyEmail } from "./classifyEmail.js";
import {
  applyProjectAssignmentRules,
  loadProjectAssignmentRulesForUser,
  loadProjectRuleOverridesForUser,
} from "./projectRuleEngine.js";

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  const parts: string[] = [];

  const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;

    if (part.body?.data && part.mimeType?.startsWith("text/")) {
      try {
        const decoded = decodeBase64Url(part.body.data);
        if (decoded.trim()) {
          parts.push(decoded.trim());
        }
      } catch (err) {
        console.error("Failed to decode message part", err);
      }
    }

    if (part.parts) {
      for (const child of part.parts) {
        walk(child);
      }
    } else if (part.body?.data && !part.mimeType) {
      try {
        const decoded = decodeBase64Url(part.body.data);
        if (decoded.trim()) {
          parts.push(decoded.trim());
        }
      } catch (err) {
        console.error("Failed to decode body fallback part", err);
      }
    }
  };

  walk(payload);

  if (parts.length === 0 && payload.body?.data) {
    try {
      const decoded = decodeBase64Url(payload.body.data);
      if (decoded.trim()) {
        parts.push(decoded.trim());
      }
    } catch (err) {
      console.error("Failed to decode root payload", err);
    }
  }

  return parts.join("\n\n");
}

function parseFromHeader(from: string): { name: string | null; email: string } {
  const emailMatch = from?.match(/<([^>]+)>/);
  const email = emailMatch ? emailMatch[1] : from;
  const nameMatch = from?.match(/^\s*"?([^<"]+)"?\s*<[^>]+>/);
  const name = nameMatch ? nameMatch[1].trim() : null;
  return { name, email };
}

const GMAIL_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
];

type SupabaseDb = SupabaseClient<any, any, any>;

interface GmailAccount {
  id: string;
  userId: string;
  email: string | null;
  refreshToken: string;
}

interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

function hasAllGmailScopes(scopes: unknown): boolean {
  if (!Array.isArray(scopes)) {
    return false;
  }
  return GMAIL_REQUIRED_SCOPES.every((scope) => scopes.includes(scope));
}

async function loadGmailAccounts(supabase: SupabaseDb): Promise<GmailAccount[]> {
  const { data, error } = await supabase
    .from("oauth_accounts")
    .select("id, user_id, account_email, refresh_token, scopes")
    .eq("provider", "google")
    .not("refresh_token", "is", null);

  if (error) {
    console.error("Failed to load Gmail OAuth accounts", error);
    return [];
  }

  const accounts: GmailAccount[] = [];
  for (const row of data ?? []) {
    const refreshToken = typeof row.refresh_token === "string" ? row.refresh_token : null;
    const userId = typeof row.user_id === "string" ? row.user_id : null;
    if (!refreshToken || !userId) {
      continue;
    }

    if (!hasAllGmailScopes(row.scopes)) {
      continue;
    }

    accounts.push({
      id: String(row.id),
      userId,
      email: typeof row.account_email === "string" ? row.account_email : null,
      refreshToken,
    });
  }

  return accounts;
}

async function fetchUserPriorityConfig(
  supabase: SupabaseDb,
  cache: Map<string, PriorityConfig>,
  userId: string
): Promise<PriorityConfig> {
  if (cache.has(userId)) {
    return cache.get(userId)!;
  }

  const { data, error } = await supabase
    .from("user_preferences")
    .select("priority_config")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to load priority config for user ${userId}`, error);
    cache.set(userId, DEFAULT_PRIORITY_CONFIG);
    return DEFAULT_PRIORITY_CONFIG;
  }

  try {
    const stored = (data?.priority_config as PriorityConfigInput | null) ?? null;
    const config = normalizePriorityConfigInput(stored, DEFAULT_PRIORITY_CONFIG);
    cache.set(userId, config);
    return config;
  } catch (err) {
    console.error(`Failed to parse priority config for user ${userId}`, err);
    cache.set(userId, DEFAULT_PRIORITY_CONFIG);
    return DEFAULT_PRIORITY_CONFIG;
  }
}

function createGmailClient(account: GmailAccount, credentials: GmailCredentials) {
  const oauth2Client = credentials.redirectUri
    ? new google.auth.OAuth2(credentials.clientId, credentials.clientSecret, credentials.redirectUri)
    : new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);

  oauth2Client.setCredentials({ refresh_token: account.refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

async function main() {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error("Missing required environment variables");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const credentials: GmailCredentials = {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI || undefined,
  };

  const accounts = await loadGmailAccounts(supabase);

  if (accounts.length === 0) {
    console.warn("No Gmail accounts connected; skipping email ingestion.");
    return;
  }

  const maxEmails = Number(process.env.MAX_EMAILS_TO_PROCESS || 5);
  const priorityConfigCache = new Map<string, PriorityConfig>();
  const projectRuleCache = new Map<string, { rules: ProjectAssignmentRule[]; overrides: Set<string> }>();

  try {
    for (const account of accounts) {
      try {
        await processGmailAccount({
          account,
          credentials,
          supabase,
          maxEmails,
          priorityConfigCache,
          projectRuleCache,
        });
      } catch (accountError) {
        console.error(
          `Failed to process Gmail account ${account.email ?? account.userId}`,
          accountError
        );
      }
    }
  } catch (err) {
    console.error(err);
  }
}

main().catch((e) => console.error(e));

interface ProcessGmailAccountOptions {
  account: GmailAccount;
  credentials: GmailCredentials;
  supabase: SupabaseDb;
  maxEmails: number;
  priorityConfigCache: Map<string, PriorityConfig>;
  projectRuleCache: Map<string, { rules: ProjectAssignmentRule[]; overrides: Set<string> }>;
}

async function processGmailAccount(options: ProcessGmailAccountOptions): Promise<void> {
  const { account, credentials, supabase, maxEmails, priorityConfigCache, projectRuleCache } = options;
  const gmail = createGmailClient(account, credentials);

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread",
    maxResults: maxEmails,
  });

  const messages = listRes.data.messages || [];
  if (messages.length === 0) {
    console.log(`No unread messages for ${account.email ?? account.userId}.`);
    return;
  }

  let ruleBundle = projectRuleCache.get(account.userId);
  if (!ruleBundle) {
    const [rules, overrides] = await Promise.all([
      loadProjectAssignmentRulesForUser(supabase, account.userId),
      loadProjectRuleOverridesForUser(supabase, account.userId),
    ]);
    ruleBundle = { rules, overrides };
    projectRuleCache.set(account.userId, ruleBundle);
  }

  const labelCache: Map<string, string> = new Map();
  let labelsLoaded = false;

  const loadLabels = async () => {
    if (labelsLoaded) return;
    try {
      const existing = await gmail.users.labels.list({ userId: "me" });
      for (const label of existing.data.labels || []) {
        if (label.name && label.id) {
          labelCache.set(label.name, label.id);
        }
      }
    } finally {
      labelsLoaded = true;
    }
  };

  const ensureLabelId = async (name: string): Promise<string> => {
    await loadLabels();
    const cached = labelCache.get(name);
    if (cached) return cached;

    const created = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });

    const id = created.data.id;
    if (!id) {
      throw new Error(`Label creation returned no id for ${name}`);
    }

    labelCache.set(name, id);
    return id;
  };

  const ensureKazadorLabelIds = async (labels: EmailLabel[]): Promise<string[]> => {
    const base = "Kazador";

    try {
      await ensureLabelId(base);
    } catch (err) {
      console.error(`Failed to ensure base Gmail label for ${account.email ?? account.userId}`, err);
    }

    const ids: string[] = [];
    const unique = Array.from(new Set(labels));
    for (const label of unique) {
      try {
        const id = await ensureLabelId(`${base}/${label}`);
        if (id) {
          ids.push(id);
        }
      } catch (err) {
        console.error(`Failed to ensure Gmail label for ${label}`, err);
      }
    }

    return ids;
  };

  for (const msg of messages.slice(0, maxEmails)) {
    if (!msg.id) continue;

    const msgRes = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const payload = msgRes.data.payload;
    const headers = (payload?.headers || []) as gmail_v1.Schema$MessagePartHeader[];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    const subject = getHeader("Subject");
    const fromHeader = getHeader("From");
    const dateHeader = getHeader("Date");
    const body = extractBody(payload) || msgRes.data.snippet || "";
    const hasAttachments = Array.isArray(payload?.parts)
      ? payload.parts.some((part) => Boolean(part?.filename))
      : false;

    const { name: fromName, email: fromEmail } = parseFromHeader(fromHeader);
    const receivedAt = new Date(dateHeader || Date.now()).toISOString();
    const labelIds = msgRes.data.labelIds || [];
    const isUnread = labelIds.includes("UNREAD");
    const isRead = !isUnread;

    const { data: existingEmail, error: existingEmailError } = await supabase
      .from("emails")
      .select("summary, labels, sentiment, triage_state, snoozed_until, is_read")
      .eq("id", msg.id)
      .eq("user_id", account.userId)
      .maybeSingle();

    if (existingEmailError) {
      console.error(`Failed to read existing email ${msg.id}`, existingEmailError);
    }

    const classification = await classifyEmail(
      {
        subject,
        body,
        fromName,
        fromEmail,
        cachedSummary: existingEmail?.summary ?? null,
        cachedLabels: existingEmail?.labels ?? null,
        cachedSentiment: existingEmail?.sentiment ?? null,
      },
      {
        analyzeEmail,
        heuristicLabels,
        normaliseLabels,
        ensureDefaultLabelCoverage,
        selectPrimaryCategory,
        onError: (error) => {
          console.error(`AI classification failed for message ${msg.id}`, error);
        },
      }
    );

    const summary = classification.summary;
    const labels = classification.labels;
    const category = classification.category;
    const sentiment = classification.sentiment;

    const { error: contactError } = await supabase
      .from("contacts")
      .upsert(
        {
          email: fromEmail,
          name: fromName,
          last_email_at: receivedAt,
        },
        { onConflict: "email" }
      );

    if (contactError) {
      console.error("Failed to upsert contact:", contactError);
    }

    const priorityConfig = await fetchUserPriorityConfig(supabase, priorityConfigCache, account.userId);

    const triageState = (existingEmail?.triage_state as EmailTriageState | null) ?? "unassigned";
    const snoozedUntil = (existingEmail?.snoozed_until as string | null) ?? null;

    const priorityScore = calculateEmailInboxPriority(
      {
        category,
        labels,
        receivedAt,
        isRead,
        triageState,
        snoozedUntil,
        fromEmail,
        fromName,
        subject,
        hasAttachments,
      },
      { now: new Date(), config: priorityConfig }
    );

    const payloadToUpsert: Record<string, any> = {
      id: msg.id,
      user_id: account.userId,
      from_name: fromName,
      from_email: fromEmail,
      subject,
      received_at: receivedAt,
      category,
      is_read: isRead,
      summary,
      labels,
      sentiment,
      source: "gmail",
      priority_score: priorityScore,
    };

    payloadToUpsert.triage_state = triageState;

    const { error: emailError } = await supabase
      .from("emails")
      .upsert(payloadToUpsert, { onConflict: "id" });

    if (emailError) {
      console.error("Failed to upsert email:", emailError);
    }

    try {
      const addLabelIds = await ensureKazadorLabelIds(labels);
      if (addLabelIds.length > 0) {
        await gmail.users.messages.modify({
          userId: "me",
          id: msg.id,
          requestBody: { addLabelIds },
        });
      }
    } catch (err) {
      console.error(`Failed to apply Gmail labels for message ${msg.id}`, err);
    }

    try {
      await applyProjectAssignmentRules(
        supabase,
        account.userId,
        {
          id: msg.id,
          subject,
          fromName,
          fromEmail,
          body,
          summary,
          category,
          labels,
          priorityScore,
          triageState,
          receivedAt,
          hasAttachments,
          sentiment,
        },
        ruleBundle.rules,
        ruleBundle.overrides
      );
    } catch (err) {
      console.error("Failed to apply project assignment rules", err);
    }

    console.log(
      `Processed message ${msg.id} for ${account.email ?? account.userId} -> ${category} (${labels.join(", ")}) priority=${priorityScore}`
    );
  }
}
