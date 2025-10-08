import { describe, it, expect, vi } from "vitest";
import { applyApprovalAction } from "../approvalActions";
import { mapApprovalRow } from "../projectMappers";

vi.mock("../projectMappers", () => ({
  mapApprovalRow: vi.fn((row: any) => ({ id: row.id, status: row.status })),
}));

type ApprovalRow = {
  id: string;
  status: string;
  type: string;
  project_id?: string | null;
  payload?: Record<string, unknown>;
};

type SupabaseBuilderConfig = {
  approvalRow: ApprovalRow | null;
  approvalError?: any;
  updatedRow?: any;
  updateError?: any;
  emailLinkError?: any;
  timelineRow?: any;
  timelineError?: any;
};

function buildSupabase(config: SupabaseBuilderConfig) {
  const timelineInsertPayloads: any[] = [];

  const approvalsSelectMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: config.approvalRow, error: config.approvalError ?? null });
  const approvalsSelectEq = vi.fn(() => ({ maybeSingle: approvalsSelectMaybeSingle }));
  const approvalsSelect = vi.fn(() => ({ eq: approvalsSelectEq }));

  const approvalsUpdateMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: config.updatedRow ?? { id: "approval-1", status: "approved" }, error: config.updateError ?? null });
  const approvalsUpdateSelect = vi.fn(() => ({ maybeSingle: approvalsUpdateMaybeSingle }));
  const approvalsUpdateEq = vi.fn(() => ({ select: approvalsUpdateSelect }));
  const approvalsUpdate = vi.fn(() => ({ eq: approvalsUpdateEq }));

  const projectEmailLinkUpsert = vi
    .fn()
    .mockResolvedValue({ error: config.emailLinkError ?? null });

  const timelineInsertMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: config.timelineRow ?? { id: "timeline-1" }, error: config.timelineError ?? null });
  const timelineInsertSelect = vi.fn(() => ({ maybeSingle: timelineInsertMaybeSingle }));
  const timelineInsert = vi.fn((payload: any) => {
    timelineInsertPayloads.push(payload);
    return { select: timelineInsertSelect };
  });

  const timelineDependencyInsert = vi.fn().mockResolvedValue({ error: null });

  const supabase = {
    from: vi.fn((table: string) => {
      switch (table) {
        case "approvals":
          return { select: approvalsSelect, update: approvalsUpdate };
        case "project_email_links":
          return { upsert: projectEmailLinkUpsert };
        case "timeline_items":
          return { insert: timelineInsert };
        case "timeline_dependencies":
          return { insert: timelineDependencyInsert };
        default:
          throw new Error(`Unexpected table: ${table}`);
      }
    }),
  };

  return {
    supabase: supabase as any,
    projectEmailLinkUpsert,
    approvalsSelectMaybeSingle,
    approvalsUpdateMaybeSingle,
    approvalsUpdate,
    timelineInsert,
    timelineInsertMaybeSingle,
    timelineDependencyInsert,
    timelineInsertPayloads,
  };
}

describe("applyApprovalAction", () => {
  it("throws when approval fetch fails", async () => {
    const { supabase } = buildSupabase({
      approvalRow: null,
      approvalError: { message: "boom" },
    });

    await expect(applyApprovalAction(supabase, "approval-1", "approve", "actor-1")).rejects.toThrow(
      "boom"
    );
  });

  it("throws when approval is missing", async () => {
    const { supabase } = buildSupabase({ approvalRow: null });

    await expect(applyApprovalAction(supabase, "approval-1", "approve", "actor-1")).rejects.toThrow(
      "Approval not found"
    );
  });

  it("returns existing approval when not pending", async () => {
    const approvalRow = { id: "approval-1", status: "approved", type: "project_email_link" };
    const { supabase, approvalsUpdate } = buildSupabase({ approvalRow });

    const result = await applyApprovalAction(supabase, "approval-1", "approve", "actor-1");

    expect(result).toEqual({ id: "approval-1", status: "approved" });
    expect(approvalsUpdate).not.toHaveBeenCalled();
  });

  it("applies project email link approvals and seeds timeline", async () => {
    const approvalRow: ApprovalRow = {
      id: "approval-1",
      status: "pending",
      type: "project_email_link",
      project_id: "proj-1",
      payload: {
        emailId: "email-1",
        confidence: 0.9,
        timelineSeed: {
          title: "Kickoff",
          type: "milestone",
          startsAt: "2023-01-01T00:00:00.000Z",
          endsAt: "2023-01-02T00:00:00.000Z",
          lane: "A",
          metadata: { foo: "bar" },
          dependencies: [{ itemId: "item-1", kind: "SS", note: "align" }],
        },
      },
    };

    const {
      supabase,
      projectEmailLinkUpsert,
      timelineInsert,
      timelineInsertMaybeSingle,
      timelineDependencyInsert,
      approvalsUpdateMaybeSingle,
    } = buildSupabase({ approvalRow, updatedRow: { id: "approval-1", status: "approved" } });

    const result = await applyApprovalAction(supabase, "approval-1", "approve", "actor-1", "Looks good");

    expect(projectEmailLinkUpsert).toHaveBeenCalledWith(
      {
        project_id: "proj-1",
        email_id: "email-1",
        confidence: 0.9,
        source: "ai",
      },
      { onConflict: "project_id,email_id" }
    );
    expect(timelineInsert).toHaveBeenCalledTimes(1);
    expect(timelineInsert).toHaveBeenCalledWith({
      project_id: "proj-1",
      title: "Kickoff",
      type: "milestone",
      starts_at: "2023-01-01T00:00:00.000Z",
      ends_at: "2023-01-02T00:00:00.000Z",
      lane: "A",
      territory: null,
      priority: 50,
      metadata: { foo: "bar" },
      ref_table: "emails",
      ref_id: "email-1",
      created_by: "actor-1",
    });
    expect(timelineInsertMaybeSingle).toHaveBeenCalled();
    expect(timelineDependencyInsert).toHaveBeenCalledWith([
      {
        project_id: "proj-1",
        from_item_id: "item-1",
        to_item_id: "timeline-1",
        kind: "SS",
        note: "align",
        created_by: "actor-1",
      },
    ]);
    expect(approvalsUpdateMaybeSingle).toHaveBeenCalled();
    expect(result).toEqual({ id: "approval-1", status: "approved" });
    expect(mapApprovalRow).toHaveBeenCalledWith({ id: "approval-1", status: "approved" });
  });

  it("throws when project email link payload missing emailId", async () => {
    const approvalRow: ApprovalRow = {
      id: "approval-1",
      status: "pending",
      type: "project_email_link",
      project_id: "proj-1",
      payload: {},
    };

    const { supabase, projectEmailLinkUpsert, approvalsUpdateMaybeSingle } = buildSupabase({ approvalRow });

    await expect(
      applyApprovalAction(supabase, "approval-1", "approve", "actor-1")
    ).rejects.toThrow("Approval payload missing emailId");

    expect(projectEmailLinkUpsert).not.toHaveBeenCalled();
    expect(approvalsUpdateMaybeSingle).not.toHaveBeenCalled();
  });

  it("declines approvals and sets declined timestamp", async () => {
    const approvalRow: ApprovalRow = {
      id: "approval-1",
      status: "pending",
      type: "timeline_item_from_email",
      project_id: "proj-1",
      payload: { projectId: "proj-1", title: "Kickoff" },
    };

    const { supabase, approvalsUpdateMaybeSingle, timelineInsert } = buildSupabase({
      approvalRow,
      updatedRow: { id: "approval-1", status: "declined" },
    });

    const result = await applyApprovalAction(supabase, "approval-1", "decline", "actor-1", "nope");

    expect(timelineInsert).not.toHaveBeenCalled();
    expect(approvalsUpdateMaybeSingle).toHaveBeenCalled();
    expect(result).toEqual({ id: "approval-1", status: "declined" });
  });

  it("propagates errors from update", async () => {
    const approvalRow: ApprovalRow = {
      id: "approval-1",
      status: "pending",
      type: "project_email_link",
      project_id: "proj-1",
      payload: { emailId: "email-1" },
    };

    const { supabase } = buildSupabase({
      approvalRow,
      updateError: new Error("update failed"),
    });

    await expect(applyApprovalAction(supabase, "approval-1", "approve", "actor-1")).rejects.toThrow(
      "update failed"
    );
  });
});
