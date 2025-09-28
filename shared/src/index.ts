export type EmailCategory =
  | "booking"
  | "promo_time"
  | "promo_submission"
  | "logistics"
  | "assets_request"
  | "finance"
  | "fan_mail"
  | "legal"
  | "other";

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
  category: EmailCategory;
  isRead: boolean;
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