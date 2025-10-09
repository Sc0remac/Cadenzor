import { describe, expect, it, vi, beforeEach, beforeAll, afterEach } from "vitest";

let GET: typeof import("../route").GET;
let POST: typeof import("../route").POST;
let serverAuthModule: typeof import("../../../lib/serverAuth");
let projectMappersModule: typeof import("../../../lib/projectMappers");
let requireAuthenticatedUserSpy: ReturnType<typeof vi.spyOn>;
let mapProjectRowSpy: ReturnType<typeof vi.spyOn>;

type QueryResult = {
  data: any;
  error: { message: string } | null;
};

type QueryConfig = {
  queryResult?: QueryResult;
  maybeSingleResult?: QueryResult;
  insertResult?: QueryResult;
  insertReturnsBuilder?: boolean;
};

type QueryLog = {
  selects: any[];
  eq: Array<{ column: string; value: unknown }>;
  in: Array<{ column: string; values: unknown }>;
  ilike: Array<{ column: string; value: string }>;
  like: Array<{ column: string; value: string }>;
  insertPayloads: unknown[];
};

function createQueryBuilder(config: QueryConfig = {}) {
  const log: QueryLog = {
    selects: [],
    eq: [],
    in: [],
    ilike: [],
    like: [],
    insertPayloads: [],
  };

  const queryResult = config.queryResult ?? { data: null, error: null };
  const maybeSingleResult = config.maybeSingleResult ?? queryResult;
  const insertResult = config.insertResult ?? queryResult;

  const builder: any = {
    select: vi.fn((...args: any[]) => {
      log.selects.push(args);
      return builder;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      log.eq.push({ column, value });
      return builder;
    }),
    in: vi.fn((column: string, values: unknown) => {
      log.in.push({ column, values });
      return builder;
    }),
    ilike: vi.fn((column: string, value: string) => {
      log.ilike.push({ column, value });
      return builder;
    }),
    like: vi.fn((column: string, value: string) => {
      log.like.push({ column, value });
      return builder;
    }),
    insert: vi.fn((payload: unknown) => {
      log.insertPayloads.push(payload);
      if (config.insertReturnsBuilder === false) {
        const promise = Promise.resolve(insertResult);
        return {
          then: (onFulfilled?: any, onRejected?: any) => promise.then(onFulfilled, onRejected),
        };
      }
      return builder;
    }),
    maybeSingle: vi.fn(() => Promise.resolve(maybeSingleResult)),
    then: (onFulfilled?: any, onRejected?: any) =>
      Promise.resolve(queryResult).then(onFulfilled, onRejected),
  };

  return { builder, log };
}

function createSupabaseStub(configMap: Record<string, QueryConfig | QueryConfig[]> = {}) {
  const configs = new Map<string, QueryConfig[]>();
  for (const [table, config] of Object.entries(configMap)) {
    configs.set(table, Array.isArray(config) ? [...config] : [config]);
  }

  const logs: Record<string, QueryLog[]> = {};
  const supabase = {
    from: vi.fn((table: string) => {
      const existing = configs.get(table);
      const tableConfigs = existing ? existing : [];
      if (!existing) {
        configs.set(table, tableConfigs);
      }
      const config = tableConfigs.length > 0 ? tableConfigs.shift()! : {};
      const { builder, log } = createQueryBuilder(config);
      if (!logs[table]) {
        logs[table] = [];
      }
      logs[table].push(log);
      configs.set(table, tableConfigs);
      return builder;
    }),
  };

  return { supabase, logs };
}

function createRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

describe("/api/projects route", () => {
  beforeAll(async () => {
    ({ GET, POST } = await import("../route"));
    serverAuthModule = await import("../../../../lib/serverAuth");
    projectMappersModule = await import("../../../../lib/projectMappers");
  });

  beforeEach(() => {
    requireAuthenticatedUserSpy = vi.spyOn(serverAuthModule, "requireAuthenticatedUser");
    mapProjectRowSpy = vi.spyOn(projectMappersModule, "mapProjectRow");
    mapProjectRowSpy.mockImplementation((row: any) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      startDate: row.start_date,
      mapped: true,
    }));
  });

  afterEach(() => {
    requireAuthenticatedUserSpy.mockRestore();
    mapProjectRowSpy.mockRestore();
  });

  it("returns auth error responses", async () => {
    requireAuthenticatedUserSpy.mockResolvedValue({ ok: false, status: 403, error: "forbidden" } as any);

    const response = await GET(createRequest("https://kazador.test/api/projects"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
    expect(requireAuthenticatedUserSpy).toHaveBeenCalled();
  });

  it("propagates membership query errors", async () => {
    const stub = createSupabaseStub({
      project_members: {
        queryResult: { data: null, error: { message: "fail" } },
      },
    });

    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: true,
      supabase: stub.supabase,
      user: { id: "user-1" },
    } as any);

    const response = await GET(createRequest("https://kazador.test/api/projects"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "fail" });
  });

  it("returns empty projects when user has no memberships", async () => {
    const stub = createSupabaseStub({
      project_members: {
        queryResult: { data: [], error: null },
      },
    });

    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: true,
      supabase: stub.supabase,
      user: { id: "user-1" },
    } as any);

    const response = await GET(createRequest("https://kazador.test/api/projects"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ projects: [] });
  });

  it("loads projects with filters applied", async () => {
    const memberships = [
      { project_id: "proj-1", role: "owner" },
      { project_id: "proj-2", role: "editor" },
    ];

    const projects = [
      { id: "proj-1", name: "Launch Tour", status: "paused" },
      { id: "proj-2", name: "Merch", status: "paused" },
    ];

    const stub = createSupabaseStub({
      project_members: {
        queryResult: { data: memberships, error: null },
      },
      projects: {
        queryResult: { data: projects, error: null },
      },
    });

    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: true,
      supabase: stub.supabase,
      user: { id: "user-1" },
    } as any);

    const response = await GET(
      createRequest("https://kazador.test/api/projects?status=paused&q=Launch")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      projects: projects.map((project) => ({
        project: {
          id: project.id,
          name: project.name,
          status: project.status,
          startDate: undefined,
          mapped: true,
        },
        role: memberships.find((member) => member.project_id === project.id)?.role,
      })),
    });

    const membershipLog = stub.logs.project_members[0];
    expect(membershipLog.eq).toEqual([{ column: "user_id", value: "user-1" }]);

    const projectLog = stub.logs.projects[0];
    expect(projectLog.in[0]).toEqual({ column: "id", values: ["proj-1", "proj-2"] });
    expect(projectLog.eq[0]).toEqual({ column: "status", value: "paused" });
    expect(projectLog.ilike[0]).toEqual({ column: "name", value: "%Launch%" });
  });

  it("rejects invalid JSON payloads", async () => {
    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: true,
      supabase: createSupabaseStub().supabase,
      user: { id: "user-1" },
    } as any);

    const response = await POST(
      createRequest("https://kazador.test/api/projects", {
        method: "POST",
        body: "{ invalid",
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON payload" });
  });

  it("requires project name", async () => {
    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: true,
      supabase: createSupabaseStub().supabase,
      user: { id: "user-1" },
    } as any);

    const response = await POST(
      createRequest("https://kazador.test/api/projects", {
        method: "POST",
        body: JSON.stringify({ description: "No name" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Project name is required" });
  });

  it("propagates insertion errors", async () => {
    const stub = createSupabaseStub({
      projects: {
        queryResult: { data: null, error: { message: "insert failed" } },
        maybeSingleResult: { data: null, error: { message: "insert failed" } },
      },
    });

    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: true,
      supabase: stub.supabase,
      user: { id: "user-1" },
    } as any);

    const response = await POST(
      createRequest("https://kazador.test/api/projects", {
        method: "POST",
        body: JSON.stringify({ name: "New project" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "insert failed" });
  });

  it("creates projects and seeds templates when provided", async () => {
    const insertedRow = {
      id: "proj-42",
      name: "Seeded",
      start_date: "2025-01-10T00:00:00.000Z",
    };

    const templateRow = {
      id: "tpl-1",
      slug: "tour",
      name: "Tour",
      payload: {},
    };

    const templateItems = [
      {
        item_type: "milestone",
        title: "Kick-off",
        lane: "timeline",
        offset_days: 2,
        duration_days: 3,
        metadata: { notes: "Important" },
      },
    ];

    const stub = createSupabaseStub({
      projects: {
        queryResult: { data: [insertedRow], error: null },
        maybeSingleResult: { data: insertedRow, error: null },
      },
      project_templates: {
        maybeSingleResult: { data: templateRow, error: null },
      },
      project_template_items: {
        queryResult: { data: templateItems, error: null },
      },
      timeline_items: {
        insertReturnsBuilder: false,
        insertResult: { data: null, error: null },
      },
    });

    requireAuthenticatedUserSpy.mockResolvedValue({
      ok: true,
      supabase: stub.supabase,
      user: { id: "user-1" },
    } as any);

    const response = await POST(
      createRequest("https://kazador.test/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: "Seeded",
          status: "active",
          templateSlug: "tour",
          startDate: "2025-01-10T00:00:00.000Z",
        }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      project: {
        id: insertedRow.id,
        name: insertedRow.name,
        status: insertedRow.status,
        startDate: insertedRow.start_date,
        mapped: true,
      },
    });

    const projectInsertLog = stub.logs.projects[0];
    expect(projectInsertLog.insertPayloads[0]).toMatchObject({
      name: "Seeded",
      status: "active",
      created_by: "user-1",
    });

    const templateQueryLog = stub.logs.project_templates[0];
    expect(templateQueryLog.selects[0][0]).toBe("id, name, slug, payload");
    expect(templateQueryLog.eq[0]).toEqual({ column: "slug", value: "tour" });

    const timelineInsertLog = stub.logs.timeline_items[0];
    const insertedTimeline = timelineInsertLog.insertPayloads[0] as any[];
    expect(insertedTimeline).toHaveLength(1);
    expect(insertedTimeline[0]).toMatchObject({
      project_id: "proj-42",
      type: "milestone",
      title: "Kick-off",
      lane: "timeline",
      metadata: { notes: "Important" },
    });
    expect(new Date(insertedTimeline[0].starts_at).toISOString()).toBe(
      "2025-01-12T00:00:00.000Z"
    );
    expect(new Date(insertedTimeline[0].ends_at).toISOString()).toBe(
      "2025-01-15T00:00:00.000Z"
    );

    expect(mapProjectRowSpy).toHaveBeenCalledWith(insertedRow);
  });
});
