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
  EMAIL_FALLBACK_LABEL,
} from "@kazador/shared";
import type { EmailLabel } from "@kazador/shared";
import { getGmailAccount, ensureGmailOAuthClient } from "@/lib/googleGmailClient";

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
      q: "is:unread",
      maxResults: maxEmails,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      return NextResponse.json({ processed: 0, message: "No unread messages" });
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

        let labels: EmailLabel[] = [];
        let summary = "";

        const { data: existingEmail, error: existingEmailError } = await supabase
          .from("emails")
          .select("summary, labels")
          .eq("id", msg.id)
          .maybeSingle();

        if (existingEmailError) {
          console.error(`Failed to read existing email ${msg.id}`, existingEmailError);
        }

        if (existingEmail) {
          if (typeof existingEmail.summary === "string" && existingEmail.summary.trim()) {
            summary = existingEmail.summary.trim();
          }
          labels = normaliseLabels(existingEmail.labels);
        }

        if (!summary || labels.length === 0) {
          try {
            const aiResult = await analyzeEmail({
              subject,
              body,
              fromName,
              fromEmail,
            });
            summary = aiResult.summary;
            labels = normaliseLabels(aiResult.labels);
          } catch (err) {
            console.error(`AI classification failed for message ${msg.id}`, err);
            labels = heuristicLabels(subject, body);
          }
        }

      if (labels.length === 0) {
        labels = heuristicLabels(subject, body);
      }

      labels = ensureDefaultLabelCoverage(labels);
      if (labels.length === 0) {
        labels = [EMAIL_FALLBACK_LABEL];
      }

      const category = selectPrimaryCategory(labels) ?? EMAIL_FALLBACK_LABEL;

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
              from_name: fromName,
              from_email: fromEmail,
              subject,
              received_at: receivedAt,
              category,
              is_read: false,
              summary,
              labels,
              source: "gmail",
            },
            { onConflict: "id" }
          );

        if (emailError) {
          throw new Error(`Failed to upsert email: ${emailError.message}`);
        }

        // Apply labels back to Gmail
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
