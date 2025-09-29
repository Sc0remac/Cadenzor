import { NextResponse } from "next/server";
import { google, gmail_v1 } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { requireAuthenticatedUser } from "../../../lib/serverAuth";
import { analyzeEmail } from "@cadenzor/shared";
import type { EmailLabel } from "@cadenzor/shared";
import {
  normaliseLabels,
  ensureDefaultLabelCoverage,
  selectPrimaryCategory,
} from "@cadenzor/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
] as const;

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
      googleClientId: process.env.GOOGLE_CLIENT_ID!,
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
      gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN!,
    },
  };
}

const HEURISTIC_LABELS: Array<{ regex: RegExp; label: EmailLabel }> = [
  { regex: /\bbooking|gig|show|inquiry|enquiry\b/i, label: "booking" },
  { regex: /\bpromo time|interview|press request|press day\b/i, label: "promo_time" },
  { regex: /\bsubmission|submit demo|new promo\b/i, label: "promo_submission" },
  { regex: /\bflight|hotel|travel|itinerary|rider|logistics\b/i, label: "logistics" },
  { regex: /\basset request|press kit|photos|artwork|assets\b/i, label: "assets_request" },
  { regex: /\binvoice|payment|settlement|contract|finance\b/i, label: "finance" },
  { regex: /\bfan mail|love your music|love your work|big fan\b/i, label: "fan_mail" },
  { regex: /\blegal|license|agreement|copyright\b/i, label: "legal" },
];

function heuristicLabels(subject: string, body: string): EmailLabel[] {
  const labels: EmailLabel[] = [];
  for (const { regex, label } of HEURISTIC_LABELS) {
    if (regex.test(subject) || regex.test(body)) {
      labels.push(label);
    }
  }
  if (labels.length === 0) {
    const fallback = normaliseLabels(subject.split(/[:\-]/)[0])[0];
    if (fallback) {
      labels.push(fallback);
    }
  }
  return Array.from(new Set(labels));
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

  const {
    supabaseUrl,
    supabaseServiceKey,
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    gmailRefreshToken,
  } = env.values;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const oauth2Client = googleRedirectUri
    ? new google.auth.OAuth2(googleClientId, googleClientSecret, googleRedirectUri)
    : new google.auth.OAuth2(googleClientId, googleClientSecret);
  oauth2Client.setCredentials({ refresh_token: gmailRefreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const maxEmails = Number(process.env.MAX_EMAILS_TO_PROCESS || 10);

  try {
    const labelCache: Map<string, string> = new Map();
    let labelsLoaded = false;

    async function loadLabels() {
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
    }

    async function ensureLabelId(name: string): Promise<string> {
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
    }

    async function ensureCadenzorLabelIds(labels: EmailLabel[]): Promise<string[]> {
      const base = "Cadenzor";

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
    }

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

        if (labels.length === 0) {
          labels = heuristicLabels(subject, body);
        }

        labels = ensureDefaultLabelCoverage(labels);
        if (labels.length === 0) {
          labels = ["other"];
        }

        const category = selectPrimaryCategory(labels) ?? "other";

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
            },
            { onConflict: "id" }
          );

        if (emailError) {
          throw new Error(`Failed to upsert email: ${emailError.message}`);
        }

        // Apply labels back to Gmail
        try {
          const addLabelIds = await ensureCadenzorLabelIds(labels);
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
