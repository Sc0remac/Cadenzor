import { config } from "dotenv";
config();

import { google, gmail_v1 } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import {
  EmailCategory,
  EmailRecord,
  ContactRecord,
} from "@cadenzor/shared";

/**
 * Derive an email category using simple keyword-based heuristics. In a real
 * production environment this should be replaced with a machine-learning
 * classifier or more sophisticated rule-based engine. For now we rely on
 * fairly straightforward keywords present in the subject line.
 *
 * @param subject The email subject to classify.
 */
function classifySubject(subject: string): EmailCategory {
  const s = (subject || "").toLowerCase();
  if (/\bbooking|gig|show|inquiry|enquiry\b/.test(s)) return "booking";
  if (/\bpromo time|interview|press request|press day\b/.test(s))
    return "promo_time";
  if (/\bsubmission|submit demo|new promo\b/.test(s)) return "promo_submission";
  if (/\bflight|hotel|travel|itinerary|rider|logistics\b/.test(s))
    return "logistics";
  if (/\basset request|press kit|photos|artwork|assets\b/.test(s))
    return "assets_request";
  if (/\binvoice|payment|settlement|contract|finance\b/.test(s)) return "finance";
  if (/\bfan mail|love your music|love your work|big fan\b/.test(s)) return "fan_mail";
  if (/\blegal|license|agreement|copyright\b/.test(s)) return "legal";
  return "other";
}

/**
 * Extract the display name and email address from a standard RFC822 formatted
 * `From` header. Gmail API returns the `From` header as a single string like
 * `"John Doe" <john@example.com>`. This function splits that into name and
 * email components.
 */
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

  // Supabase client (service role for writes)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Gmail OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    // Fetch unread messages (adjust/remove maxResults as needed)
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread",
      maxResults: 50,
    });
    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      console.log("No unread messages.");
      return;
    }

    for (const msg of messages) {
      if (!msg.id) continue;

      // Get headers only (Subject, From, Date)
      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });

      const payload = msgRes.data.payload;
      const headers = (payload?.headers || []) as gmail_v1.Schema$MessagePartHeader[];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

      const subject = getHeader("Subject");
      const fromHeader = getHeader("From");
      const dateHeader = getHeader("Date");

      const { name: fromName, email: fromEmail } = parseFromHeader(fromHeader);
      const receivedAt = new Date(dateHeader || Date.now()).toISOString();
      const category = classifySubject(subject);

      // Upsert contact (keyed by email)
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

      // Upsert email (keyed by Gmail message ID)
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
          },
          { onConflict: "id" }
        );

      if (emailError) {
        console.error("Failed to upsert email:", emailError);
      }

      // Mark as read in Gmail after processing (optional):
      // await gmail.users.messages.modify({
      //   userId: "me",
      //   id: msg.id,
      //   requestBody: { removeLabelIds: ["UNREAD"] },
      // });

      console.log(`Processed message ${msg.id} -> ${category}`);
    }
  } catch (err) {
    console.error(err);
  }
}

main().catch((e) => console.error(e));
