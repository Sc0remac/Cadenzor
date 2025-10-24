import { NextResponse } from "next/server";
import { google, gmail_v1 } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import {
  analyzeEmail,
  normaliseLabels,
  ensureDefaultLabelCoverage,
  selectPrimaryCategory,
  heuristicLabels,
  calculateEmailInboxPriority,
  DEFAULT_PRIORITY_CONFIG,
  normalizePriorityConfigInput,
  EMAIL_FALLBACK_LABEL,
  normaliseEmailSentiment,
  DEFAULT_EMAIL_SENTIMENT,
  evaluateProjectAssignmentRule,
  confidenceLevelToScore,
  normalizeProjectAssignmentRuleInput,
  type PriorityConfig,
  type PriorityConfigInput,
  type EmailSentiment,
  type ProjectAssignmentRule,
  type EmailTriageState,
} from "@kazador/shared";
import type { EmailLabel } from "@kazador/shared";
import { getGmailAccount, ensureGmailOAuthClient } from "@/lib/googleGmailClient";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    return {
      ok: false as const,
      error: `Missing required environment variables: ${missing.join(", ")}`,
    };
  }

  return {
    ok: true as const,
    values: {
      supabaseUrl: process.env.SUPABASE_URL!,
      supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    },
  };
}


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

interface RuleRow {
  id: string;
  user_id: string;
  project_id: string;
  name: string | null;
  description: string | null;
  enabled: boolean | null;
  sort_order: number | null;
  conditions: unknown;
  actions: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch (err) {
    return null;
  }
}

async function loadProjectAssignmentRulesForUser(
  supabase: any,
  userId: string
): Promise<ProjectAssignmentRule[]> {
  const { data, error } = await supabase
    .from("project_assignment_rules")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to load project assignment rules", error);
    return [];
  }

  const rules: ProjectAssignmentRule[] = [];
  for (const row of data ?? []) {
    const record = row as RuleRow;
    const conditions = parseJson(record.conditions) ?? undefined;
    const actions = parseJson(record.actions) ?? undefined;
    const metadata = parseJson(record.metadata) ?? undefined;

    const normalized = normalizeProjectAssignmentRuleInput(
      {
        id: record.id,
        userId: record.user_id,
        projectId: record.project_id,
        name: record.name ?? undefined,
        description: record.description,
        enabled: record.enabled ?? undefined,
        sortOrder: record.sort_order ?? undefined,
        conditions: conditions as unknown,
        actions: actions as unknown,
        metadata: metadata as unknown,
      },
      {
        id: record.id,
        userId,
        projectId: record.project_id,
        name: record.name ?? undefined,
        description: record.description,
        enabled: record.enabled ?? true,
        sortOrder: record.sort_order ?? 0,
        conditions: conditions as any,
        actions: actions as any,
        metadata: (metadata as Record<string, unknown>) ?? {},
        createdAt: record.created_at,
        updatedAt: record.updated_at,
      }
    );

    rules.push(normalized);
  }

  return rules;
}

async function loadProjectRuleOverridesForUser(
  supabase: any,
  userId: string
): Promise<Set<string>> {
  const overrides = new Set<string>();
  const { data, error } = await supabase
    .from("project_email_link_overrides")
    .select("project_id, email_id")
    .eq("user_id", userId);

  if (error) {
    console.error("Failed to load project rule overrides", error);
    return overrides;
  }

  for (const row of data ?? []) {
    const projectId = (row as { project_id?: string }).project_id;
    const emailId = (row as { email_id?: string }).email_id;
    if (projectId && emailId) {
      overrides.add(`${projectId}:${emailId}`);
    }
  }

  return overrides;
}

async function applyProjectAssignmentRules(
  supabase: any,
  userId: string,
  email: {
    id: string;
    subject: string;
    fromName: string | null;
    fromEmail: string;
    body: string;
    summary: string;
    category: string;
    labels: string[];
    priorityScore: number | null;
    triageState: string | null;
    receivedAt: string;
    hasAttachments: boolean;
    sentiment: EmailSentiment;
  },
  rules: ProjectAssignmentRule[],
  overrides: Set<string>
): Promise<void> {
  if (rules.length === 0) {
    return;
  }

  const projectKey = (projectId: string) => `${projectId}:${email.id}`;
  const existingLinks = new Set<string>();

  try {
    const { data: linkRows, error: linkError } = await supabase
      .from("project_email_links")
      .select("project_id")
      .eq("email_id", email.id)
      .in(
        "project_id",
        rules.map((rule) => rule.projectId)
      );

    if (linkError) {
      console.error("Failed to load existing project email links", linkError);
    } else {
      for (const row of linkRows ?? []) {
        const projectId = (row as { project_id?: string }).project_id;
        if (projectId) {
          existingLinks.add(projectKey(projectId));
        }
      }
    }
  } catch (err) {
    console.error("Unexpected error loading existing project email links", err);
  }

  const sortedRules = [...rules].sort((a, b) => a.sortOrder - b.sortOrder);
  const nowIso = new Date().toISOString();

  for (const rule of sortedRules) {
    if (!rule.enabled) continue;

    const evaluation = evaluateProjectAssignmentRule(rule, {
      email: {
        id: email.id,
        subject: email.subject,
        fromName: email.fromName,
        fromEmail: email.fromEmail,
        category: email.category,
        labels: email.labels,
        priorityScore: email.priorityScore ?? null,
        triageState: (email.triageState as EmailTriageState) ?? undefined,
        receivedAt: email.receivedAt,
        attachments: email.hasAttachments ? [{ id: "placeholder", emailId: email.id, filename: "", mimeType: null, size: null, storageBucket: null, storagePath: null, sha256: null, metadata: {}, createdAt: nowIso }] : [],
        summary: email.summary,
        body: email.body,
        sentiment: email.sentiment,
      },
    });

    if (!evaluation.matched) {
      continue;
    }

    const key = projectKey(rule.projectId);
    if (overrides.has(key) || existingLinks.has(key)) {
      continue;
    }

    const confidenceScore = confidenceLevelToScore(rule.actions.confidence ?? "high") ?? 1;
    const metadata: Record<string, unknown> = {
      rule_id: rule.id,
      rule_name: rule.name,
      confidence_level: rule.actions.confidence ?? "high",
      note: rule.actions.note ?? null,
      linked_by: userId,
      linked_at: nowIso,
      source: "rule",
    };

    try {
      await supabase.from("project_email_links").insert({
        id: randomUUID(),
        project_id: rule.projectId,
        email_id: email.id,
        confidence: confidenceScore,
        source: "rule",
        metadata,
        created_at: nowIso,
      });
      existingLinks.add(key);
    } catch (err) {
      console.error("Failed to insert project email link for rule", rule.id, err);
    }
  }
}

export async function POST(request: Request) {
  const authResult = await requireAuthenticatedUser(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }

  const requester = authResult.user;

  const env = validateEnv();
  if (!env.ok) {
    return NextResponse.json({ error: env.error }, { status: 500 });
  }

  const { supabaseUrl, supabaseServiceKey } = env.values;

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let gmailAccount;
  let priorityConfig: PriorityConfig = DEFAULT_PRIORITY_CONFIG;
  {
    const { data: prefRow, error: prefError } = await supabase
      .from("user_preferences")
      .select("priority_config")
      .eq("user_id", requester.id)
      .maybeSingle();

    if (prefError) {
      console.error("Failed to load priority config", prefError);
    } else if (prefRow?.priority_config) {
      try {
        priorityConfig = normalizePriorityConfigInput(
          prefRow.priority_config as PriorityConfigInput,
          DEFAULT_PRIORITY_CONFIG
        );
      } catch (err) {
        console.error("Failed to parse priority config", err);
        priorityConfig = DEFAULT_PRIORITY_CONFIG;
      }
    }
  }

  try {
    gmailAccount = await getGmailAccount(supabase, { userId: requester.id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to load Gmail connection" }, { status: 500 });
  }

  if (!gmailAccount) {
    return NextResponse.json(
      { error: "Connect Gmail in settings before running classification." },
      { status: 409 }
    );
  }

  let oauth2Client;
  try {
    oauth2Client = await ensureGmailOAuthClient(supabase, gmailAccount);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to prepare Gmail client" }, { status: 500 });
  }

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const maxEmails = Number(process.env.MAX_EMAILS_TO_PROCESS || 10);

  // Load project assignment rules
  const [projectRules, projectRuleOverrides] = await Promise.all([
    loadProjectAssignmentRulesForUser(supabase, requester.id),
    loadProjectRuleOverridesForUser(supabase, requester.id),
  ]);

  try {
    const labelCache: Map<string, string> = new Map();
    let labelsLoaded = false;

    const loadLabels = async (): Promise<void> => {
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
        console.error("Failed to ensure base Gmail label", err);
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

    const listRes = await gmail.users.messages.list({
      userId: "me",
      maxResults: maxEmails,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      return NextResponse.json({ processed: 0, message: "No messages found" });
    }

    const processed: Array<{ id: string; category: EmailLabel; labels: EmailLabel[] }> = [];
    const failures: Array<{ id: string; error: string }> = [];

    for (const msg of messages) {
      if (!msg.id) continue;
      try {
        const msgRes = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full",
        });

        const labelIds = msgRes.data.labelIds ?? [];
        const payload = msgRes.data.payload;
        const headers = (payload?.headers || []) as gmail_v1.Schema$MessagePartHeader[];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

        const subject = getHeader("Subject");
        const fromHeader = getHeader("From");
        const dateHeader = getHeader("Date");
        const body = extractBody(payload) || msgRes.data.snippet || "";

        const { name: fromName, email: fromEmail } = parseFromHeader(fromHeader);
        const receivedAt = new Date(dateHeader || Date.now()).toISOString();
        const isUnread = labelIds.includes("UNREAD");
        const isRead = !isUnread;

        const { data: existingEmail, error: existingEmailError } = await supabase
          .from("emails")
          .select("summary, labels, sentiment, triage_state, snoozed_until")
          .eq("id", msg.id)
          .eq("user_id", requester.id)
          .maybeSingle();

        if (existingEmailError) {
          console.error(`Failed to read existing email ${msg.id}`, existingEmailError);
        }

        let summary = typeof existingEmail?.summary === "string" ? existingEmail.summary.trim() : "";
        let labels = normaliseLabels(existingEmail?.labels ?? []);
        let sentiment: EmailSentiment = normaliseEmailSentiment(existingEmail?.sentiment ?? null);

        if (!summary || labels.length === 0 || !sentiment || sentiment.confidence === 0) {
          try {
            const aiResult = await analyzeEmail({
              subject,
              body,
              fromName,
              fromEmail,
            });
            summary = aiResult.summary;
            labels = normaliseLabels(aiResult.labels);
            sentiment = aiResult.sentiment;
          } catch (err) {
            console.error(`AI classification failed for message ${msg.id}`, err);
            labels = heuristicLabels(subject, body);
          }
        }

        if (!sentiment || sentiment.confidence === 0) {
          sentiment = { ...DEFAULT_EMAIL_SENTIMENT };
        }

        if (labels.length === 0) {
          labels = heuristicLabels(subject, body);
        }

        labels = ensureDefaultLabelCoverage(labels);
        if (labels.length === 0) {
          labels = [EMAIL_FALLBACK_LABEL];
        }

        const category = selectPrimaryCategory(labels) ?? EMAIL_FALLBACK_LABEL;
        const triageState = (existingEmail?.triage_state as string | null) ?? (isRead ? "acknowledged" : "unassigned");
        const snoozedUntil = (existingEmail?.snoozed_until as string | null) ?? null;
        const hasAttachments = Array.isArray(payload?.parts)
          ? payload.parts.some((part) => Boolean(part?.filename))
          : false;

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
          throw new Error(`Failed to upsert contact: ${contactError.message}`);
        }

        const { error: emailError } = await supabase
          .from("emails")
          .upsert(
            {
              id: msg.id,
              user_id: requester.id,
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
              triage_state: triageState,
            },
            { onConflict: "id" }
          );

        if (emailError) {
          throw new Error(`Failed to upsert email: ${emailError.message}`);
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

        // Apply project assignment rules
        try {
          await applyProjectAssignmentRules(
            supabase,
            requester.id,
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
            projectRules,
            projectRuleOverrides
          );
        } catch (err) {
          console.error(`Failed to apply project assignment rules for message ${msg.id}`, err);
        }

        processed.push({ id: msg.id, category, labels });
      } catch (err: any) {
        console.error(`Failed processing message ${msg.id}`, err);
        failures.push({ id: msg.id, error: err?.message || "Unknown error" });
      }
    }

    return NextResponse.json({
      processed: processed.length,
      failures,
      processedIds: processed.map((item) => item.id),
      requestedBy: requester.email ?? requester.id,
    });
  } catch (err: any) {
    console.error("Classification run failed", err);
    return NextResponse.json(
      { error: err?.message || "Failed to classify emails" },
      { status: 500 }
    );
  }
}
