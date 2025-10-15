import { describe, it, expect } from "vitest";
import {
  mapProjectRow,
  mapProjectMemberRow,
  mapProjectSourceRow,
  mapAssetRow,
  mapAssetLinkRow,
  mapOAuthAccountRow,
  mapEmailAttachmentRow,
  mapProjectItemLinkRow,
  mapProjectEmailLinkRow,
  mapTimelineDependencyRow,
  mapTimelineItemRow,
  mapApprovalRow,
  mapProjectTaskRow,
  mapProjectTemplateRow,
  mapProjectTemplateItemRow,
} from "../projectMappers";

describe("projectMappers", () => {
  it("maps project rows with defaults and parsed fields", () => {
    const row = {
      id: "proj-1",
      artist_id: null,
      name: "Test Project",
      slug: "test-project",
      description: null,
      status: "active",
      start_date: "2023-01-01T00:00:00.000Z",
      end_date: null,
      color: null,
      labels: '{"priority": "high"}',
      priority_profile: { tier: "gold" },
      created_by: "user-1",
      created_at: "2023-01-01T00:00:00.000Z",
      updated_at: "2023-01-02T00:00:00.000Z",
    };

    const mapped = mapProjectRow(row);

    expect(mapped).toEqual({
      id: "proj-1",
      artistId: null,
      name: "Test Project",
      slug: "test-project",
      description: null,
      status: "active",
      startDate: "2023-01-01T00:00:00.000Z",
      endDate: null,
      color: null,
      labels: { priority: "high" },
      priorityProfile: { tier: "gold" },
      createdBy: "user-1",
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-02T00:00:00.000Z",
    });
  });

  it("maps project member rows", () => {
    const mapped = mapProjectMemberRow({
      id: "member-1",
      project_id: "proj-1",
      user_id: "user-1",
      role: "owner",
      created_at: "2023-01-01T00:00:00.000Z",
    });

    expect(mapped).toEqual({
      id: "member-1",
      projectId: "proj-1",
      userId: "user-1",
      role: "owner",
      createdAt: "2023-01-01T00:00:00.000Z",
    });
  });

  it("maps project source rows with boolean coercion", () => {
    const mapped = mapProjectSourceRow({
      id: "source-1",
      project_id: "proj-1",
      kind: "drive",
      external_id: "drive-1",
      title: null,
      watch: 1,
      scope: null,
      metadata: { foo: "bar" },
      last_indexed_at: "2023-01-03T00:00:00.000Z",
      created_at: "2023-01-01T00:00:00.000Z",
      updated_at: "2023-01-02T00:00:00.000Z",
    });

    expect(mapped).toEqual({
      id: "source-1",
      projectId: "proj-1",
      kind: "drive",
      externalId: "drive-1",
      title: null,
      watch: true,
      scope: null,
      metadata: { foo: "bar" },
      lastIndexedAt: "2023-01-03T00:00:00.000Z",
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-02T00:00:00.000Z",
    });
  });

  it("maps asset rows with numeric coercion and metadata parsing", () => {
    const mapped = mapAssetRow({
      id: "asset-1",
      project_id: "proj-1",
      project_source_id: "source-1",
      source: "drive",
      external_id: "file-1",
      title: "File",
      mime_type: "text/plain",
      size: "123",
      path: null,
      owner: "user@example.com",
      modified_at: "2023-01-01T00:00:00.000Z",
      confidential: 0,
      metadata: '{"foo": "bar"}',
      created_at: "2023-01-01T00:00:00.000Z",
      updated_at: "2023-01-02T00:00:00.000Z",
      is_canonical: 1,
      canonical_category: "mix",
      drive_url: "https://drive.google.com",
      drive_web_view_link: null,
    });

    expect(mapped).toEqual({
      id: "asset-1",
      projectId: "proj-1",
      projectSourceId: "source-1",
      source: "drive",
      externalId: "file-1",
      title: "File",
      mimeType: "text/plain",
      size: 123,
      path: null,
      owner: "user@example.com",
      modifiedAt: "2023-01-01T00:00:00.000Z",
      confidential: false,
      metadata: { foo: "bar" },
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-02T00:00:00.000Z",
      isCanonical: true,
      canonicalCategory: "mix",
      driveUrl: "https://drive.google.com",
      driveWebViewLink: null,
    });
  });

  it("maps asset link rows", () => {
    expect(
      mapAssetLinkRow({
        id: "link-1",
        project_id: "proj-1",
        asset_id: "asset-1",
        ref_table: "timeline_items",
        ref_id: "timeline-1",
        source: "manual",
        created_at: "2023-01-01T00:00:00.000Z",
      })
    ).toEqual({
      id: "link-1",
      projectId: "proj-1",
      assetId: "asset-1",
      refTable: "timeline_items",
      refId: "timeline-1",
      source: "manual",
      createdAt: "2023-01-01T00:00:00.000Z",
    });
  });

  it("maps OAuth account rows with defaults", () => {
    expect(
      mapOAuthAccountRow({
        id: "acct-1",
        user_id: "user-1",
        provider: "google",
        account_email: "user@example.com",
        scopes: null,
        access_token: "token",
        refresh_token: "refresh",
        expires_at: "2023-01-02T00:00:00.000Z",
        token_metadata: '{"foo": "bar"}',
        created_at: "2023-01-01T00:00:00.000Z",
        updated_at: "2023-01-02T00:00:00.000Z",
      })
    ).toEqual({
      id: "acct-1",
      userId: "user-1",
      provider: "google",
      accountEmail: "user@example.com",
      scopes: [],
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: "2023-01-02T00:00:00.000Z",
      tokenMetadata: { foo: "bar" },
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-02T00:00:00.000Z",
    });
  });

  it("maps email attachment rows", () => {
    expect(
      mapEmailAttachmentRow({
        id: "att-1",
        email_id: "email-1",
        filename: "file.txt",
        mime_type: null,
        size: "10",
        storage_bucket: "bucket",
        storage_path: "path",
        sha256: "hash",
        metadata: '{"foo": "bar"}',
        created_at: "2023-01-01T00:00:00.000Z",
      })
    ).toEqual({
      id: "att-1",
      emailId: "email-1",
      filename: "file.txt",
      mimeType: null,
      size: 10,
      storageBucket: "bucket",
      storagePath: "path",
      sha256: "hash",
      metadata: { foo: "bar" },
      createdAt: "2023-01-01T00:00:00.000Z",
    });
  });

  it("maps project item link rows", () => {
    expect(
      mapProjectItemLinkRow({
        id: "plink-1",
        project_id: "proj-1",
        ref_table: "tasks",
        ref_id: "task-1",
        confidence: "0.8",
        source: "ai",
        metadata: { foo: "bar" },
        created_at: "2023-01-01T00:00:00.000Z",
      })
    ).toEqual({
      id: "plink-1",
      projectId: "proj-1",
      refTable: "tasks",
      refId: "task-1",
      confidence: 0.8,
      source: "ai",
      metadata: { foo: "bar" },
      createdAt: "2023-01-01T00:00:00.000Z",
    });
  });

  it("maps project email link rows", () => {
    expect(
      mapProjectEmailLinkRow({
        id: "elink-1",
        project_id: "proj-1",
        email_id: "email-1",
        confidence: null,
        source: "ai",
        created_at: "2023-01-01T00:00:00.000Z",
      })
    ).toEqual({
      id: "elink-1",
      projectId: "proj-1",
      emailId: "email-1",
      confidence: null,
      source: "ai",
      createdAt: "2023-01-01T00:00:00.000Z",
    });
  });

  it("maps timeline dependency rows", () => {
    expect(
      mapTimelineDependencyRow({
        id: "dep-1",
        project_id: "proj-1",
        from_item_id: "from",
        to_item_id: "to",
        kind: "FS",
        note: null,
        created_at: "2023-01-01T00:00:00.000Z",
        updated_at: "2023-01-02T00:00:00.000Z",
      })
    ).toEqual({
      id: "dep-1",
      projectId: "proj-1",
      fromItemId: "from",
      toItemId: "to",
      kind: "FS",
      note: null,
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-02T00:00:00.000Z",
    });
  });

  it("maps timeline item rows and parses metadata", () => {
    const mapped = mapTimelineItemRow({
      id: "timeline-1",
      project_id: "proj-1",
      type: "event",
      title: "Launch",
      start_at: "2023-01-01T00:00:00.000Z",
      end_at: null,
      due_at: null,
      tz: null,
      lane: null,
      territory: null,
      status: "scheduled",
      priority_score: "5",
      labels: '{"foo": "bar"}',
      links: '{"refTable": "emails", "refId": "email-1"}',
      created_by: "user-1",
      created_at: "2023-01-01T00:00:00.000Z",
      updated_at: "2023-01-02T00:00:00.000Z",
    });

    expect(mapped).toEqual({
      id: "timeline-1",
      projectId: "proj-1",
      type: "event",
      lane: "PROMO",
      kind: null,
      title: "Launch",
      description: null,
      startsAt: "2023-01-01T00:00:00.000Z",
      endsAt: null,
      dueAt: null,
      timezone: null,
      status: "scheduled",
      priorityScore: 5,
      priorityComponents: null,
      labels: { foo: "bar" },
      links: { refTable: "emails", refId: "email-1" },
      createdBy: "user-1",
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-02T00:00:00.000Z",
      conflictFlags: null,
      layoutRow: null,
      territory: null,
    });
  });

  it("maps approval rows and handles invalid payload JSON", () => {
    const mapped = mapApprovalRow({
      id: "approval-1",
      project_id: "proj-1",
      type: "project_email_link",
      status: "pending",
      payload: "not-json",
      requested_by: "user-1",
      created_by: "user-2",
      approver_id: null,
      approved_at: null,
      declined_at: null,
      resolution_note: null,
      created_at: "2023-01-01T00:00:00.000Z",
      updated_at: "2023-01-02T00:00:00.000Z",
    });

    expect(mapped.payload).toEqual({});
    expect(mapped).toMatchObject({
      id: "approval-1",
      projectId: "proj-1",
      status: "pending",
      requestedBy: "user-1",
      createdBy: "user-2",
      approverId: null,
      approvedAt: null,
      declinedAt: null,
      resolutionNote: null,
    });
  });

  it("maps project task rows", () => {
    expect(
      mapProjectTaskRow({
        id: "task-1",
        project_id: "proj-1",
        title: "Task",
        description: null,
        status: "open",
        due_at: "2023-01-10T00:00:00.000Z",
        priority: "3",
        assignee_id: null,
        created_by: "user-1",
        created_at: "2023-01-01T00:00:00.000Z",
        updated_at: "2023-01-02T00:00:00.000Z",
      })
    ).toEqual({
      id: "task-1",
      projectId: "proj-1",
      title: "Task",
      description: null,
      status: "open",
      dueAt: "2023-01-10T00:00:00.000Z",
      priority: 3,
      assigneeId: null,
      laneId: null,
      laneSlug: null,
      laneName: null,
      laneColor: null,
      laneIcon: null,
      createdBy: "user-1",
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-02T00:00:00.000Z",
    });
  });

  it("maps project template rows", () => {
    expect(
      mapProjectTemplateRow({
        id: "tpl-1",
        name: "Template",
        slug: "template",
        description: null,
        payload: '{"foo": "bar"}',
        created_at: "2023-01-01T00:00:00.000Z",
        updated_at: "2023-01-02T00:00:00.000Z",
      })
    ).toEqual({
      id: "tpl-1",
      name: "Template",
      slug: "template",
      description: null,
      payload: { foo: "bar" },
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-02T00:00:00.000Z",
    });
  });

  it("maps project template item rows", () => {
    expect(
      mapProjectTemplateItemRow({
        id: "item-1",
        template_id: "tpl-1",
        item_type: "event",
        title: "Kickoff",
        lane: null,
        offset_days: "5",
        duration_days: "2",
        metadata: '{"foo": "bar"}',
        created_at: "2023-01-01T00:00:00.000Z",
      })
    ).toEqual({
      id: "item-1",
      templateId: "tpl-1",
      itemType: "event",
      title: "Kickoff",
      lane: null,
      offsetDays: 5,
      durationDays: 2,
      metadata: { foo: "bar" },
      createdAt: "2023-01-01T00:00:00.000Z",
    });
  });
});
