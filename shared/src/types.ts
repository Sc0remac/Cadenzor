export const DEFAULT_EMAIL_LABELS = [
  "booking",
  "promo_time",
  "promo_submission",
  "logistics",
  "assets_request",
  "finance",
  "fan_mail",
  "legal",
  "other",
] as const;

export type EmailLabel = string;

/**
 * A simple shape representing an email stored in the database. It contains
 * minimal information used by the frontend and worker. Additional fields
 * can be added as needed (e.g. messageId, threadId, snippet, etc.).
 */
export interface EmailRecord {
  id: string;
  fromName: string | null;
  fromEmail: string;
  subject: string;
  receivedAt: string;
  category: EmailLabel;
  isRead: boolean;
  summary?: string | null;
  labels?: EmailLabel[];
}

/**
 * Definition of a contact record persisted in the Supabase database.
 */
export interface ContactRecord {
  id: string;
  name: string | null;
  email: string;
  lastEmailAt: string;
}
