import type { EmailRecord } from "@cadenzor/shared";

export async function fetchEmailStats(): Promise<Record<EmailRecord["category"], number>> {
  const response = await fetch("/api/email-stats", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch email statistics");
  }

  return payload as Record<EmailRecord["category"], number>;
}

export async function fetchRecentEmails(limit = 25): Promise<EmailRecord[]> {
  const query = new URLSearchParams();
  if (limit) {
    query.set("limit", String(limit));
  }

  const queryString = query.toString();
  const response = await fetch(queryString ? `/api/emails?${queryString}` : "/api/emails", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to fetch emails");
  }

  return Array.isArray(payload?.items) ? (payload.items as EmailRecord[]) : [];
}
