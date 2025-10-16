import { describe, it, expect, vi, beforeEach } from "vitest";
import { indexDriveFolder, queueDerivedLabelApprovals } from "../driveIndexer";
import {
  listFolderTree,
  toAssetInsertPayload,
  suggestLabelsFromPath,
  mergeDerivedLabelSuggestions,
} from "../googleDriveClient";

vi.mock("../googleDriveClient", () => ({
  listFolderTree: vi.fn(),
  toAssetInsertPayload: vi.fn(),
  suggestLabelsFromPath: vi.fn(),
  mergeDerivedLabelSuggestions: vi.fn((existing: any[], next: any[]) => [...existing, ...next]),
}));

describe("indexDriveFolder", () => {
  beforeEach(() => {
    vi.mocked(listFolderTree).mockReset();
    vi.mocked(toAssetInsertPayload).mockReset();
    vi.mocked(suggestLabelsFromPath).mockReset();
    vi.mocked(mergeDerivedLabelSuggestions).mockClear();
  });

  it("indexes drive entries, batches assets, and updates metadata", async () => {
    const folderMime = "application/vnd.google-apps.folder";
    const entries = [
      { id: "root", name: "Root", mimeType: folderMime, parents: undefined },
      ...Array.from({ length: 501 }, (_, index) => ({
        id: `file-${index}`,
        name: `File ${index}`,
        mimeType: "text/plain",
        parents: ["root"],
      })),
    ];

    vi.mocked(listFolderTree).mockResolvedValue(entries as any);
    vi.mocked(toAssetInsertPayload).mockImplementation((args: any): any => {
      if (args.entry.mimeType === folderMime) {
        return null;
      }
      return {
        project_id: args.projectId,
        project_source_id: args.projectSourceId,
        external_id: args.entry.id,
        source: "drive",
        title: args.entry.name,
        path: `${args.pathSegments.join("/")}/${args.entry.name}`,
        mime_type: args.entry.mimeType,
      };
    });
    vi.mocked(suggestLabelsFromPath).mockImplementation((path: string | null): any => {
      if (path && path.includes("File 0")) {
        return [{ labelKey: "key", labelValue: "value", evidence: [path] }];
      }
      return [];
    });

    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const deleteFn = vi.fn(() => ({ eq: deleteEq }));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: updateEq }));

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "assets") {
          return { delete: deleteFn, upsert };
        }
        if (table === "project_sources") {
          return { update };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await indexDriveFolder(supabase as any, {
      projectId: "proj",
      projectSourceId: "source",
      rootFolderId: "root",
      rootFolderName: "Drive",
      drive: {} as any,
      accountEmail: "user@example.com",
      maxDepth: 2,
    });

    expect(listFolderTree).toHaveBeenCalledWith({}, "root", { maxDepth: 2 });
    expect(deleteFn).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("project_source_id", "source");
    // 501 files should be inserted across two batches.
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ last_indexed_at: expect.any(String) }));
    expect(updateEq).toHaveBeenCalledWith("id", "source");
    expect(result.assetCount).toBe(501);
    expect(result.derivedLabels).toEqual([{ labelKey: "key", labelValue: "value", evidence: [expect.any(String)] }]);
    expect(result.indexedAt).toMatch(/T/);
  });
});

describe("queueDerivedLabelApprovals", () => {
  beforeEach(() => {
    vi.mocked(mergeDerivedLabelSuggestions).mockClear();
  });

  it("skips work when no suggestions provided", async () => {
    const supabase = { from: vi.fn() };
    await queueDerivedLabelApprovals(supabase as any, {
      projectId: "proj",
      requestedBy: "user",
      suggestions: [],
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("filters existing labels and pending approvals before inserting", async () => {
    const projectMaybeSingle = vi.fn().mockResolvedValue({
      data: { labels: { existing: "keep" } },
      error: null,
    });
    const projectEq = vi.fn(() => ({ maybeSingle: projectMaybeSingle }));
    const projectSelect = vi.fn(() => ({ eq: projectEq }));

    const pendingRows = [
      { payload: { labelKey: "new", labelValue: "value" } },
    ];

    const approvalsQuery: any = {
      eq: vi.fn((field: string): any => {
        if (field === "status") {
          return Promise.resolve({ data: pendingRows, error: null });
        }
        return approvalsQuery;
      }),
    };
    const approvalsSelect = vi.fn((): any => approvalsQuery);
    const approvalsInsert = vi.fn().mockResolvedValue({ error: null });

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "projects") {
          return { select: projectSelect };
        }
        if (table === "approvals") {
          return { select: approvalsSelect, insert: approvalsInsert };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await queueDerivedLabelApprovals(supabase as any, {
      projectId: "proj",
      requestedBy: "user",
      suggestions: [
        { labelKey: "existing", labelValue: "keep", evidence: ["a"] } as any,
        { labelKey: "new", labelValue: "value", evidence: ["b", "c"] } as any,
        { labelKey: "fresh", labelValue: "v2", evidence: ["d"] } as any,
      ],
    });

    expect(projectSelect).toHaveBeenCalled();
    expect(approvalsSelect).toHaveBeenCalled();
    // Only "fresh" suggestion should be inserted (trim evidence to 10 items).
    expect(approvalsInsert).toHaveBeenCalledWith([
      {
        project_id: "proj",
        type: "project_label_suggestion",
        status: "pending",
        payload: {
          labelKey: "fresh",
          labelValue: "v2",
          evidence: ["d"],
          source: "drive_indexer",
        },
        requested_by: "user",
        created_by: "user",
      },
    ]);
  });
});
