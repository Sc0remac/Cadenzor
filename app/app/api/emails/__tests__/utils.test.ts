import { describe, expect, it } from "vitest";
import { DEFAULT_EMAIL_SENTIMENT } from "@kazador/shared";
import { EMAIL_SELECT_COLUMNS, mapEmailRow } from "../utils";

describe("emails utils", () => {
  const baseRow = {
    id: "email-1",
    user_id: "user-1",
    from_name: "Sender",
    from_email: "sender@example.com",
    subject: "Subject line",
    received_at: "2024-01-01T00:00:00.000Z",
    category: "BOOKING/Offer",
    is_read: false,
    summary: "Summary",
    labels: ["BOOKING/Offer"],
    source: "gmail",
    triage_state: "unassigned",
    triaged_at: null,
    snoozed_until: null,
    priority_score: 42,
  };

  it("selects sentiment column from Supabase", () => {
    expect(EMAIL_SELECT_COLUMNS.split(",").map((part) => part.trim())).toContain("sentiment");
  });

  it("maps sentiment payload when present", () => {
    const row = {
      ...baseRow,
      sentiment: { label: "positive", confidence: 0.65 },
    };

    const mapped = mapEmailRow(row);

    expect(mapped.sentiment).toEqual({ label: "positive", confidence: 0.65 });
  });

  it("returns neutral sentiment when value is missing", () => {
    const mapped = mapEmailRow({ ...baseRow, sentiment: null });

    expect(mapped.sentiment).toEqual(DEFAULT_EMAIL_SENTIMENT);
  });
});
