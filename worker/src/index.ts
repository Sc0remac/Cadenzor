import { config } from "dotenv";
config();

import { google, gmail_v1 } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import {
  EmailLabel,
  EmailRecord,
  ContactRecord,
  analyzeEmail,
} from "@cadenzor/shared";

function slugifyLabel(value: string | null | undefined): EmailLabel {
  if (!value) return "general";
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .trim();
  return slug || "general";
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
    const fallback = slugifyLabel(subject.split(/[:\-]/)[0]);
    labels.push(fallback);
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

async function main() {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    GMAIL_REFRESH_TOKEN,
  } = process.env;

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !GOOGLE_CLIENT_ID ||
    !GOOGLE_CLIENT_SECRET ||
    !GOOGLE_REDIRECT_URI ||
    !GMAIL_REFRESH_TOKEN
  ) {
    console.error("Missing required environment variables");
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
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

      try {
        const aiResult = await analyzeEmail({
          subject,
          body,
          fromName,
          fromEmail,
        });
        summary = aiResult.summary;
        labels = aiResult.labels.map((label) => slugifyLabel(label));
      } catch (err) {
        console.error(`AI classification failed for message ${msg.id}`, err);
        labels = heuristicLabels(subject, body);
      }

      if (labels.length === 0) {
        labels = heuristicLabels(subject, body);
      }

      const category = labels[0] || "general";

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

      console.log(
        `Processed message ${msg.id} -> ${category} (${labels.join(", ")}) summary length=${summary.length}`
      );
    }
  } catch (err) {
    console.error(err);
  }
}

main().catch((e) => console.error(e));
