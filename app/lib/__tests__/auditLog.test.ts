import { describe, it, expect, vi } from "vitest";
import { recordAuditLog } from "../auditLog";

describe("recordAuditLog", () => {
  it("inserts formatted payload", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn(() => ({ insert })),
    };

    await recordAuditLog(supabase as any, {
      projectId: "proj",
      userId: "user",
      action: "create",
      entity: "project",
      refId: "ref",
      metadata: { foo: "bar" },
    });

    expect(supabase.from).toHaveBeenCalledWith("audit_logs");
    expect(insert).toHaveBeenCalledWith({
      project_id: "proj",
      user_id: "user",
      action: "create",
      entity: "project",
      ref_id: "ref",
      metadata: { foo: "bar" },
    });
  });

  it("throws when insert fails", async () => {
    const insert = vi.fn().mockResolvedValue({ error: new Error("boom") });
    const supabase = {
      from: vi.fn(() => ({ insert })),
    };

    await expect(
      recordAuditLog(supabase as any, {
        projectId: null,
        userId: null,
        action: "create",
        entity: "project",
      })
    ).rejects.toThrow("boom");
  });
});
