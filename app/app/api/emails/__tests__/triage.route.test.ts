import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/serverAuth", () => ({
  requireAuthenticatedUser: vi.fn(),
}));

const { requireAuthenticatedUser } = await import("../../../../lib/serverAuth");

async function importRoute() {
  return await import("../[emailId]/route");
}

type SupabaseStub = ReturnType<typeof createSupabaseStub>;

function createSupabaseStub() {
  const baseTimestamp = "2024-01-01T10:00:00.000Z";

  const existingRow = {
    id: "email-1",
    user_id: "user-1",
    from_name: "Agent",
    from_email: "agent@example.com",
    subject: "Offer",
    received_at: baseTimestamp,
    category: "BOOKING/Offer",
    is_read: false,
    summary: "Summary",
    labels: ["BOOKING/Offer"],
    source: "gmail",
    triage_state: "unassigned",
    triaged_at: null,
    snoozed_until: null,
    priority_score: 60,
  } as Record<string, unknown>;

  const updatedRow = { ...existingRow } as Record<string, unknown>;

  let selectCallCount = 0;
  let lastUpdatePayload: Record<string, unknown> | undefined;

  const emailsTable = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => {
            selectCallCount += 1;
            if (selectCallCount === 1) {
              return { data: existingRow, error: null };
            }
            return { data: updatedRow, error: null };
          }),
        })),
      })),
    })),
    update: vi.fn((payload: Record<string, unknown>) => {
      lastUpdatePayload = payload;
      if (payload.priority_score != null) {
        updatedRow.priority_score = payload.priority_score;
      }
      if (payload.triage_state != null) {
        updatedRow.triage_state = payload.triage_state;
      }
      if (payload.is_read != null) {
        updatedRow.is_read = payload.is_read;
      }
      if (payload.snoozed_until !== undefined) {
        updatedRow.snoozed_until = payload.snoozed_until;
      }
      if (payload.triaged_at != null) {
        updatedRow.triaged_at = payload.triaged_at;
      }

      return {
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: updatedRow, error: null })),
            })),
          })),
        })),
      };
    }),
  };

  const userPreferencesTable = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: { priority_config: null }, error: null })),
      })),
    })),
  };

  const attachmentsTable = {
    select: vi.fn(() => ({
      in: vi.fn(async () => ({ data: [], error: null })),
      eq: vi.fn(async () => ({ count: 0, error: null })),
    })),
  };

  const projectMembersTable = {
    select: vi.fn(() => ({
      eq: vi.fn(async () => ({ data: [], error: null })),
    })),
  };

  const projectEmailLinksTable = {
    select: vi.fn(() => ({
      in: vi.fn(() => ({
        in: vi.fn(async () => ({ data: [], error: null })),
      })),
    })),
  };

  const tableMap: Record<string, any> = {
    emails: emailsTable,
    user_preferences: userPreferencesTable,
    email_attachments: attachmentsTable,
    project_members: projectMembersTable,
    project_email_links: projectEmailLinksTable,
  };

  const supabase = {
    from: vi.fn((table: string) => {
      const handler = tableMap[table];
      if (!handler) {
        throw new Error(`Unexpected table ${table}`);
      }
      return handler;
    }),
  };

  return {
    supabase,
    existingRow,
    updatedRow,
    emailsTable,
    getLastUpdatePayload: () => lastUpdatePayload,
  };
}

describe("PATCH /api/emails/[emailId]", () => {
  let supabaseStub: SupabaseStub;

  beforeAll(() => {
    vi.useFakeTimers({ now: new Date("2024-01-02T08:00:00Z") });
  });

  beforeEach(() => {
    supabaseStub = createSupabaseStub();
    (requireAuthenticatedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      supabase: supabaseStub.supabase,
      user: { id: "user-1" },
    });
  });

  it("updates triage state and recalculates priority", async () => {
    const { PATCH } = await importRoute();

    const request = new Request("https://kazador.test/api/emails/email-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triageState: "acknowledged" }),
    });

    const response = await PATCH(request, { params: { emailId: "email-1" } });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.email).toBeDefined();
    expect(payload.email.triageState).toBe("acknowledged");
    expect(payload.email.isRead).toBe(true);

    const updatePayload = supabaseStub.getLastUpdatePayload();
    expect(updatePayload).toBeDefined();
    expect(updatePayload?.triage_state).toBe("acknowledged");
    expect(updatePayload?.is_read).toBe(true);
    expect(updatePayload?.priority_score).toBeTypeOf("number");
  });

  it("rejects invalid payloads", async () => {
    const { PATCH } = await importRoute();

    const request = new Request("https://kazador.test/api/emails/email-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triageState: "invalid" }),
    });

    const response = await PATCH(request, { params: { emailId: "email-1" } });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBeDefined();
  });
});
