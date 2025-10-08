import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchEmailStats,
  fetchRecentEmails,
  fetchProjects,
  createProject,
  fetchProjectHub,
  searchProfiles,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  fetchDriveAccountStatus,
  disconnectDriveAccount,
  startDriveOAuth,
  browseDriveItems,
  connectDriveSource,
  reindexDriveSource,
  fetchProjectAssets,
  fetchEmailAttachments,
  fileEmailAttachmentsToDrive,
  linkAssetToReference,
  unlinkAssetLink,
  markAssetCanonical,
  updateProject,
  fetchProjectTemplates,
  fetchProjectSuggestionsForEmail,
  createTimelineItem,
  deleteTimelineItem,
  fetchApprovals,
  respondToApproval,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  linkEmailToProject,
  unlinkEmailFromProject,
  fetchTodayDigest,
  fetchDigestHistory,
} from "../supabaseClient";

const fetchMock = vi.fn();

describe("supabaseClient", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    (globalThis as any).fetch = fetchMock;
  });

  function mockResponse(status: number, body: any) {
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  }

  it("fetches email stats with query params", async () => {
    mockResponse(200, { important: 5 });

    const stats = await fetchEmailStats({ accessToken: "token", scope: "unread", source: "seeded" });

    expect(stats).toEqual({ important: 5 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/email-stats?scope=unread&source=seeded",
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json", Authorization: "Bearer token" },
        cache: "no-store",
      })
    );
  });

  it("throws when email stats request fails", async () => {
    mockResponse(500, { error: "fail" });

    await expect(fetchEmailStats()).rejects.toThrow("fail");
  });

  it("parses recent emails with fallback pagination", async () => {
    mockResponse(200, {
      items: [{ id: "email-1" }],
      pagination: { total: 100, hasMore: true },
    });

    const result = await fetchRecentEmails({ page: 0, perPage: 0 });

    expect(result.items).toEqual([{ id: "email-1" }]);
    expect(result.pagination).toEqual({
      page: 1,
      perPage: 10,
      total: 100,
      totalPages: 1,
      hasMore: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/emails?page=0&perPage=0",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("fetches projects with filters", async () => {
    mockResponse(200, { projects: [{ project: { id: "proj" } }] });

    const projects = await fetchProjects({ accessToken: "token", status: "active", query: "launch" });

    expect(projects).toEqual([{ project: { id: "proj" } }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects?status=active&q=launch",
      expect.objectContaining({ headers: { Accept: "application/json", Authorization: "Bearer token" } })
    );
  });

  it("throws when create project fails", async () => {
    mockResponse(400, { error: "bad" });
    await expect(createProject({ name: "Test" }, "token")).rejects.toThrow("bad");
  });

  it("creates project and returns payload", async () => {
    mockResponse(200, { project: { id: "proj" } });
    const project = await createProject({ name: "Test" }, "token");
    expect(project).toEqual({ id: "proj" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json", Authorization: "Bearer token" }),
      })
    );
  });

  it("fetches project hub", async () => {
    mockResponse(200, { project: { id: "proj" } });
    const hub = await fetchProjectHub("proj", "token");
    expect(hub).toEqual({ project: { id: "proj" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/proj",
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ Authorization: "Bearer token" }) })
    );
  });

  it("searches profiles", async () => {
    mockResponse(200, { profiles: [{ id: "user" }] });
    const results = await searchProfiles({ query: "ann", limit: 5, accessToken: "token" });
    expect(results).toEqual([{ id: "user" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/profiles/search?q=ann&limit=5",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("adds project member", async () => {
    mockResponse(200, { member: { id: "member-1" } });
    const member = await addProjectMember("proj", { userId: "user", role: "viewer" }, "token");
    expect(member).toEqual({ id: "member-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/proj/members",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("updates member role and throws on failure", async () => {
    mockResponse(200, {});
    await expect(updateProjectMemberRole("proj", "mem", "editor", "token")).resolves.toBeUndefined();

    mockResponse(400, { error: "nope" });
    await expect(updateProjectMemberRole("proj", "mem", "editor", "token")).rejects.toThrow("nope");
  });

  it("removes member and handles errors", async () => {
    mockResponse(200, {});
    await expect(removeProjectMember("proj", "mem", "token")).resolves.toBeUndefined();

    mockResponse(500, { error: "fail" });
    await expect(removeProjectMember("proj", "mem", "token")).rejects.toThrow("fail");
  });

  it("returns disconnected drive status on 404", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) });
    const status = await fetchDriveAccountStatus("token");
    expect(status).toEqual({ connected: false });
  });

  it("fetches drive account status", async () => {
    mockResponse(200, { connected: true });
    const status = await fetchDriveAccountStatus();
    expect(status).toEqual({ connected: true });
  });

  it("errors when disconnecting drive fails", async () => {
    mockResponse(400, { error: "bad" });
    await expect(disconnectDriveAccount()).rejects.toThrow("bad");
  });

  it("starts drive oauth", async () => {
    mockResponse(200, { authUrl: "url", state: "state" });
    const payload = await startDriveOAuth({ redirectTo: "/projects" }, "token");
    expect(payload).toEqual({ authUrl: "url", state: "state" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/google-drive/oauth/start",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("browses drive items", async () => {
    mockResponse(200, {
      mode: "search",
      query: "beat",
      current: { id: "1" },
      folders: [{ id: "2" }],
      files: [{ id: "3" }],
    });
    const response = await browseDriveItems({ parent: "root", search: "beat" }, "token");
    expect(response).toMatchObject({ mode: "search", query: "beat" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/google-drive/folders?parent=root&search=beat",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("connects drive source", async () => {
    mockResponse(200, { results: [] });
    const response = await connectDriveSource("proj", { selections: [] }, "token");
    expect(response).toEqual({ results: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/proj/drive/connect",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("reindexes drive source", async () => {
    mockResponse(200, { assetCount: 1, indexedAt: "now" });
    const summary = await reindexDriveSource("proj", "source", "token");
    expect(summary).toEqual({ assetCount: 1, indexedAt: "now" });
  });

  it("fetches project assets", async () => {
    mockResponse(200, { items: [], pagination: { page: 1, perPage: 10, total: 0, totalPages: 0, hasMore: false } });
    const assets = await fetchProjectAssets("proj", { canonical: true }, "token");
    expect(assets.items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/proj/assets?canonical=true",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("fetches email attachments", async () => {
    mockResponse(200, { attachments: [{ id: "att" }] });
    const attachments = await fetchEmailAttachments("email", "token");
    expect(attachments).toEqual([{ id: "att" }]);
  });

  it("files email attachments to drive", async () => {
    mockResponse(200, { assets: [{ id: "asset" }] });
    const assets = await fileEmailAttachmentsToDrive(
      "proj",
      "email",
      { projectSourceId: "source", attachmentIds: ["att"] },
      "token"
    );
    expect(assets).toEqual([{ id: "asset" }]);
  });

  it("links and unlinks assets", async () => {
    mockResponse(200, { link: { id: "link" } });
    const link = await linkAssetToReference("proj", "asset", { refTable: "emails", refId: "email" }, "token");
    expect(link).toEqual({ id: "link" });

    mockResponse(200, {});
    await expect(unlinkAssetLink("proj", "asset", "link", "token")).resolves.toBeUndefined();

    mockResponse(400, { error: "nope" });
    await expect(unlinkAssetLink("proj", "asset", "link", "token")).rejects.toThrow("nope");
  });

  it("marks asset canonical", async () => {
    mockResponse(200, { asset: { id: "asset" } });
    const asset = await markAssetCanonical("proj", "asset", { isCanonical: true }, "token");
    expect(asset).toEqual({ id: "asset" });
  });

  it("updates project", async () => {
    mockResponse(200, { project: { id: "proj" } });
    const project = await updateProject("proj", { name: "New" }, "token");
    expect(project).toEqual({ id: "proj" });
  });

  it("fetches project templates", async () => {
    mockResponse(200, { templates: [{ template: { id: "tpl" }, items: [] }] });
    const templates = await fetchProjectTemplates("token");
    expect(templates).toEqual([{ template: { id: "tpl" }, items: [] }]);
  });

  it("fetches project suggestions for email", async () => {
    mockResponse(200, { suggestions: [{ project: { id: "proj" } }] });
    const suggestions = await fetchProjectSuggestionsForEmail("email", "token");
    expect(suggestions).toEqual([{ project: { id: "proj" } }]);
  });

  it("creates and deletes timeline items", async () => {
    mockResponse(200, { item: { id: "timeline" } });
    const item = await createTimelineItem("proj", { title: "Kickoff", type: "event" }, "token");
    expect(item).toEqual({ id: "timeline" });

    mockResponse(200, {});
    await expect(deleteTimelineItem("proj", "timeline", "token")).resolves.toBeUndefined();

    mockResponse(400, { error: "fail" });
    await expect(deleteTimelineItem("proj", "timeline", "token")).rejects.toThrow("fail");
  });

  it("fetches approvals and responds to approval", async () => {
    mockResponse(200, { approvals: [{ id: "approval" }] });
    const approvals = await fetchApprovals("proj", "token", { status: "pending" });
    expect(approvals).toEqual([{ id: "approval" }]);

    mockResponse(200, { approval: { id: "approval" } });
    const approval = await respondToApproval("approval", "approve", { note: "ok", accessToken: "token" });
    expect(approval).toEqual({ id: "approval" });
  });

  it("manages project tasks", async () => {
    mockResponse(200, { task: { id: "task" } });
    const task = await createProjectTask("proj", { title: "Task" }, "token");
    expect(task).toEqual({ id: "task" });

    mockResponse(200, { task: { id: "task" } });
    const updated = await updateProjectTask("proj", "task", { status: "done" }, "token");
    expect(updated).toEqual({ id: "task" });

    mockResponse(200, {});
    await expect(deleteProjectTask("proj", "task", "token")).resolves.toBeUndefined();

    mockResponse(400, { error: "fail" });
    await expect(deleteProjectTask("proj", "task", "token")).rejects.toThrow("fail");
  });

  it("links and unlinks emails", async () => {
    mockResponse(200, {});
    await expect(linkEmailToProject("proj", "email", "token")).resolves.toBeUndefined();

    mockResponse(200, {});
    await expect(unlinkEmailFromProject("proj", "link", "token")).resolves.toBeUndefined();

    mockResponse(400, { error: "fail" });
    await expect(unlinkEmailFromProject("proj", "link", "token")).rejects.toThrow("fail");
  });

  it("fetches today digest and history", async () => {
    mockResponse(200, { digest: { entries: [] }, generatedFor: "2023-01-01" });
    const digest = await fetchTodayDigest({ accessToken: "token" });
    expect(digest).toEqual({ digest: { entries: [] }, preferences: null, generatedFor: "2023-01-01" });

    mockResponse(200, { digests: [{ id: "dig" }] });
    const history = await fetchDigestHistory({ accessToken: "token" });
    expect(history).toEqual([{ id: "dig" }]);
  });
});
