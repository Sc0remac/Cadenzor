import { config } from "dotenv";
config();

import { google, gmail_v1 } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import {
  EmailLabel,
  analyzeEmail,
  normaliseLabels,
  ensureDefaultLabelCoverage,
  selectPrimaryCategory,
  heuristicLabels,
  EMAIL_FALLBACK_LABEL,
} from "@cadenzor/shared";
import { classifyEmail } from "./classifyEmail.js";

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

async function main() {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    GMAIL_REFRESH_TOKEN,
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    console.error("Missing required environment variables");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const oauth2Client = GOOGLE_REDIRECT_URI
    ? new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
    : new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    const maxEmails = Number(process.env.MAX_EMAILS_TO_PROCESS || 5);
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread",
      maxResults: maxEmails,
    });
    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      console.log("No unread messages.");
      return;
    }

    // Cache Gmail label IDs to avoid repeated lookups/creates
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

      const classification = await classifyEmail(
        {
          subject,
          body,
          fromName,
          fromEmail,
          cachedSummary: existingEmail?.summary ?? null,
          cachedLabels: existingEmail?.labels ?? null,
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

      summary = classification.summary;
      labels = classification.labels;
      const category = classification.category;

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
        console.error("Failed to upsert email:", emailError);
      }

      // Apply labels back to Gmail so they are visible in the user's inbox
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

      console.log(
        `Processed message ${msg.id} -> ${category} (${labels.join(", ")}) summary length=${summary.length}`
      );
    }
  } catch (err) {
    console.error(err);
  }
}

main().catch((e) => console.error(e));
