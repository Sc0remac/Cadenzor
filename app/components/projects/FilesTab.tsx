"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AssetRecord,
  AssetLinkRecord,
  ProjectRecord,
  ProjectSourceRecord,
} from "@cadenzor/shared";
import {
  fetchDriveAccountStatus,
  browseDriveItems,
  type DriveFolderSummaryDto,
  type DriveFileSummaryDto,
  connectDriveSource,
  type ConnectDriveSourcePayload,
  reindexDriveSource,
  fetchProjectAssets,
  type AssetListResponse,
  linkAssetToReference,
  unlinkAssetLink,
  markAssetCanonical,
} from "../../lib/supabaseClient";
import type { AssetCanonicalCategory } from "@cadenzor/shared";

interface ProjectFilesTabProps {
  project: ProjectRecord;
  sources: ProjectSourceRecord[];
  assets: AssetRecord[];
  assetLinks: AssetLinkRecord[];
  accessToken: string | null;
  onRefreshHub: () => Promise<void>;
}

interface AssetFilters {
  sourceId: string | null;
  type: string | null;
  updated: "last7" | "last30" | null;
  canonicalOnly: boolean;
  confidentialOnly: boolean;
  pathContains: string;
}

const DEFAULT_FILTERS: AssetFilters = {
  sourceId: null,
  type: null,
  updated: null,
  canonicalOnly: false,
  confidentialOnly: false,
  pathContains: "",
};

const TYPE_OPTIONS = [
  { value: null, label: "All types" },
  { value: "audio", label: "Audio" },
  { value: "artwork", label: "Artwork" },
  { value: "docs", label: "Docs" },
  { value: "video", label: "Video" },
];

const UPDATED_OPTIONS: Array<{ value: "last7" | "last30" | null; label: string }> = [
  { value: null, label: "Any time" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
];

function formatRelativeDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatSize(size: number | null): string {
  if (!size || size <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let index = 0;
  let current = size;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[index]}`;
}

function canonicalLabel(category: AssetCanonicalCategory | null): string {
  if (!category) return "Canonical";
  switch (category) {
    case "logo":
      return "Canonical • Logo";
    case "epk":
      return "Canonical • EPK";
    case "cover":
      return "Canonical • Cover";
    case "press":
      return "Canonical • Press";
    case "audio":
      return "Canonical • Audio";
    case "video":
      return "Canonical • Video";
    default:
      return "Canonical";
  }
}

export default function ProjectFilesTab(props: ProjectFilesTabProps) {
  const { project, accessToken, sources, assets: initialAssets, assetLinks, onRefreshHub } = props;
  const router = useRouter();
  const [driveAccount, setDriveAccount] = useState<{ email: string; scopes: string[]; expiresAt: string } | null>(
    null
  );
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);

  const [folderHistory, setFolderHistory] = useState<DriveFolderSummaryDto[]>([]);
  const [folderChildren, setFolderChildren] = useState<DriveFolderSummaryDto[]>([]);
  const [fileChildren, setFileChildren] = useState<DriveFileSummaryDto[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<DriveFolderSummaryDto | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFileSummaryDto | null>(null);
  const [driveBrowserMode, setDriveBrowserMode] = useState<"browse" | "search">("browse");
  const [driveActiveQuery, setDriveActiveQuery] = useState<string | null>(null);
  const [driveSearchInput, setDriveSearchInput] = useState("");

  const [assetFilters, setAssetFilters] = useState<AssetFilters>(DEFAULT_FILTERS);
  const [assetList, setAssetList] = useState<AssetRecord[]>(initialAssets);
  const [assetPagination, setAssetPagination] = useState<AssetListResponse["pagination"]>({
    page: 1,
    perPage: 50,
    total: initialAssets.length,
    totalPages: 1,
    hasMore: false,
  });
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetError, setAssetError] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const assetLinksByAssetId = useMemo(() => {
    return assetLinks.reduce<Map<string, AssetLinkRecord[]>>((acc, link) => {
      const list = acc.get(link.assetId) ?? [];
      list.push(link);
      acc.set(link.assetId, list);
      return acc;
    }, new Map());
  }, [assetLinks]);

  useEffect(() => {
    setAssetList(initialAssets);
    setAssetPagination((prev) => ({ ...prev, total: initialAssets.length, totalPages: 1, page: 1 }));
  }, [initialAssets]);

  async function refreshDriveAccountStatus() {
    setDriveLoading(true);
    setDriveError(null);
    try {
      const status = await fetchDriveAccountStatus(accessToken ?? undefined);
      if (status.connected && status.account) {
        setDriveAccount(status.account);
      } else {
        setDriveAccount(null);
      }
    } catch (err: any) {
      setDriveError(err?.message || "Failed to load Drive status");
    } finally {
      setDriveLoading(false);
    }
  }

  useEffect(() => {
    void refreshDriveAccountStatus();
  }, [accessToken]);

  useEffect(() => {
    if (!driveAccount) {
      setFolderModalOpen(false);
      setSelectedFolder(null);
      setFolderChildren([]);
      setFolderHistory([]);
      setFileChildren([]);
      setSelectedFile(null);
      setDriveBrowserMode("browse");
      setDriveActiveQuery(null);
      setDriveSearchInput("");
    }
  }, [driveAccount]);

  const selectedFolderPath = useMemo(() => {
    if (!selectedFolder) {
      return "";
    }

    if (folderHistory.length === 0) {
      return selectedFolder.name;
    }

    const historyNames = folderHistory.map((entry) => entry.name);
    const lastHistory = folderHistory[folderHistory.length - 1];

    if (lastHistory && selectedFolder.id === lastHistory.id) {
      return historyNames.join(" / ");
    }

    return [...historyNames, selectedFolder.name].join(" / ");
  }, [selectedFolder, folderHistory]);

  const selectedFilePath = useMemo(() => {
    if (!selectedFile) {
      return "";
    }

    if (selectedFile.path && selectedFile.path.trim()) {
      return selectedFile.path;
    }

    if (folderHistory.length === 0) {
      return selectedFile.name;
    }

    const names = folderHistory.map((entry) => entry.name);
    return [...names, selectedFile.name].join(" / ");
  }, [selectedFile, folderHistory]);

  const selectedEntryType = selectedFolder ? "folder" : selectedFile ? "file" : null;
  const selectedEntryId = selectedFolder ? selectedFolder.id : selectedFile ? selectedFile.id : null;
  const connectPendingKey = selectedEntryType && selectedEntryId ? `connect:${selectedEntryType}:${selectedEntryId}` : null;
  const isConnectingSelection = connectPendingKey != null && pendingAction === connectPendingKey;
  const driveSources = useMemo(
    () => sources.filter((source) => source.kind === "drive_folder" || source.kind === "drive_file"),
    [sources]
  );

  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent) {
      if (!event?.data || typeof event.data !== "object") return;
      if (event.data.source !== "cadenzor-drive") return;

      if (event.data.status === "success") {
        setDriveAccount({
          email: event.data.accountEmail,
          scopes: event.data.scopes ?? [],
          expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
        });
        void onRefreshHub();
        setFolderHistory([]);
        setFolderChildren([]);
        setFileChildren([]);
        setSelectedFolder(null);
        setSelectedFile(null);
        setDriveBrowserMode("browse");
        setDriveActiveQuery(null);
        setDriveSearchInput("");
      } else if (event.data.status === "error") {
        setDriveError(event.data.message ?? "Drive connection failed");
      }
    }

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [onRefreshHub]);

  async function loadDriveEntries(options: { parent?: string; search?: string } = {}) {
    if (!driveAccount) return;
    setFolderLoading(true);
    setFolderError(null);

    const hasSearch = Object.prototype.hasOwnProperty.call(options, "search");
    const rawSearch = options.search ?? "";
    const searchQuery = rawSearch.trim();

    const requestOptions: { parent?: string; search?: string } = {};
    if (hasSearch && searchQuery) {
      requestOptions.search = searchQuery;
    } else if (!hasSearch && options.parent) {
      requestOptions.parent = options.parent;
    }

    try {
      const data = await browseDriveItems(requestOptions, accessToken ?? undefined);
      setDriveBrowserMode(data.mode);
      setDriveActiveQuery(data.mode === "search" ? data.query ?? searchQuery : null);
      setFolderChildren(data.folders);
      setFileChildren(data.files);
      setSelectedFolder(null);
      setSelectedFile(null);

      if (data.mode === "browse") {
        if (!requestOptions.parent || !data.current) {
          setFolderHistory(data.current ? [data.current] : []);
        } else if (data.current) {
          setFolderHistory((prev) => {
            const next = [...prev];
            const existingIndex = next.findIndex((entry) => entry.id === data.current!.id);
            if (existingIndex >= 0) {
              return next.slice(0, existingIndex + 1);
            }
            next.push(data.current!);
            return next;
          });
        }
      } else {
        setFolderHistory(data.current ? [data.current] : []);
      }

      if (data.mode === "search") {
        setDriveSearchInput(data.query ?? searchQuery);
      } else if (hasSearch) {
        setDriveSearchInput(searchQuery);
      } else if (!hasSearch) {
        setDriveSearchInput("");
      }
    } catch (err: any) {
      setFolderError(err?.message || "Failed to browse Drive");
    } finally {
      setFolderLoading(false);
    }
  }

  async function handleConnectSelected() {
    const selection = selectedFolder
      ? { type: "folder" as const, id: selectedFolder.id, title: selectedFolder.path ?? selectedFolder.name }
      : selectedFile
      ? { type: "file" as const, id: selectedFile.id, title: selectedFile.name }
      : null;

    if (!selection) {
      return;
    }

    const pendingKey = `connect:${selection.type}:${selection.id}`;
    setPendingAction(pendingKey);
    try {
      const payload: ConnectDriveSourcePayload = {
        driveId: selection.id,
        kind: selection.type,
      };

      if (typeof selection.title === "string") {
        payload.title = selection.title;
      }

      if (selection.type === "folder") {
        payload.autoIndex = true;
        payload.maxDepth = 8;
      }

      await connectDriveSource(project.id, payload, accessToken ?? undefined);
      await onRefreshHub();
      setFolderChildren([]);
      setFileChildren([]);
      setFolderHistory([]);
      setSelectedFolder(null);
      setSelectedFile(null);
      setFolderModalOpen(false);
      setDriveBrowserMode("browse");
      setDriveActiveQuery(null);
      setDriveSearchInput("");
    } catch (err: any) {
      setDriveError(err?.message || "Failed to connect Drive selection");
    } finally {
      setPendingAction(null);
    }
  }

  function handleOpenFolderModal() {
    if (!driveAccount) return;
    setFolderModalOpen(true);
    setSelectedFolder(null);
    setSelectedFile(null);
    setDriveActiveQuery(null);
    setDriveSearchInput("");
    void loadDriveEntries();
  }

  function handleCloseFolderModal() {
    setFolderModalOpen(false);
    setSelectedFolder(null);
    setFolderChildren([]);
    setFolderHistory([]);
    setFolderError(null);
    setFileChildren([]);
    setSelectedFile(null);
    setDriveBrowserMode("browse");
    setDriveActiveQuery(null);
    setDriveSearchInput("");
  }

  function handleDriveSearchInput(event: ChangeEvent<HTMLInputElement>) {
    setDriveSearchInput(event.target.value);
  }

  function handleDriveSearchReset() {
    setDriveActiveQuery(null);
    setDriveBrowserMode("browse");
    setDriveSearchInput("");
    void loadDriveEntries();
  }

  function handleDriveSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadDriveEntries({ search: driveSearchInput });
  }

  function handleGoToProfile() {
    router.push("/profile");
  }

  function handleFilterChange<K extends keyof AssetFilters>(key: K, value: AssetFilters[K]) {
    setAssetFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function loadAssets(page = 1) {
    setAssetLoading(true);
    setAssetError(null);
    try {
      const response = await fetchProjectAssets(
        project.id,
        {
          sourceId: assetFilters.sourceId,
          type: assetFilters.type,
          updated: assetFilters.updated,
          canonical: assetFilters.canonicalOnly,
          confidential: assetFilters.confidentialOnly,
          pathContains: assetFilters.pathContains || null,
          page,
          perPage: assetPagination.perPage,
        },
        accessToken ?? undefined
      );
      setAssetList(response.items);
      setAssetPagination(response.pagination);
    } catch (err: any) {
      setAssetError(err?.message || "Failed to load assets");
    } finally {
      setAssetLoading(false);
    }
  }

  async function handleApplyFilters() {
    await loadAssets(1);
  }

  async function handlePageChange(delta: number) {
    const nextPage = Math.max(assetPagination.page + delta, 1);
    if (nextPage === assetPagination.page) return;
    await loadAssets(nextPage);
  }

  async function handleReindex(sourceId: string) {
    setPendingAction(`reindex:${sourceId}`);
    try {
      await reindexDriveSource(project.id, sourceId, accessToken ?? undefined);
      await onRefreshHub();
      await loadAssets(assetPagination.page);
    } catch (err: any) {
      setDriveError(err?.message || "Failed to reindex Drive source");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCanonicalToggle(asset: AssetRecord) {
    setPendingAction(`canonical:${asset.id}`);
    try {
      const next = await markAssetCanonical(
        project.id,
        asset.id,
        {
          isCanonical: !asset.isCanonical,
          category: asset.canonicalCategory ?? null,
        },
        accessToken ?? undefined
      );
      setAssetList((prev) => prev.map((item) => (item.id === asset.id ? next : item)));
      await onRefreshHub();
    } catch (err: any) {
      setAssetError(err?.message || "Failed to update canonical flag");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleLinkAsset(asset: AssetRecord) {
    const refId = window.prompt("Enter email ID to link this asset to:");
    if (!refId) return;
    setPendingAction(`link:${asset.id}`);
    try {
      await linkAssetToReference(
        project.id,
        asset.id,
        {
          refTable: "emails",
          refId,
          source: "manual",
        },
        accessToken ?? undefined
      );
      await onRefreshHub();
    } catch (err: any) {
      setAssetError(err?.message || "Failed to link asset");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUnlinkAsset(asset: AssetRecord) {
    const links = assetLinksByAssetId.get(asset.id);
    if (!links || links.length === 0) return;
    const link = links[0];
    setPendingAction(`unlink:${asset.id}`);
    try {
      await unlinkAssetLink(project.id, asset.id, link.id, accessToken ?? undefined);
      await onRefreshHub();
    } catch (err: any) {
      setAssetError(err?.message || "Failed to unlink asset");
    } finally {
      setPendingAction(null);
    }
  }

  function handleCopyLink(url: string | null) {
    if (!url) return;
    void navigator.clipboard.writeText(url).catch(() => {
      setAssetError("Failed to copy link to clipboard");
    });
  }

  const canonicalAssets = useMemo(() => assetList.filter((asset) => asset.isCanonical), [assetList]);

  const folderModal = !folderModalOpen
    ? null
    : (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
            <header className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Add Drive folders or files</h2>
                <p className="text-sm text-gray-600">
                  Search your Drive or browse folders to attach relevant references to this project.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseFolderModal}
                className="rounded-md bg-gray-100 px-3 py-1 text-sm text-gray-600 hover:bg-gray-200"
              >
                Close
              </button>
            </header>

            <div className="flex flex-col gap-4 p-4 md:flex-row">
              <div className="flex-1 md:pr-4">
                <form onSubmit={handleDriveSearchSubmit} className="mb-3 flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={driveSearchInput}
                    onChange={handleDriveSearchInput}
                    placeholder="Search your Drive"
                    className="w-full flex-1 rounded border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      disabled={folderLoading}
                    >
                      Search
                    </button>
                    {driveBrowserMode === "search" ? (
                      <button
                        type="button"
                        onClick={handleDriveSearchReset}
                        className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </form>

                <div className="mb-3 flex flex-wrap items-center gap-1 text-xs text-gray-600">
                  {driveBrowserMode === "search" ? (
                    <span>
                      Search results for
                      <span className="font-medium text-gray-900"> “{driveActiveQuery ?? driveSearchInput}”</span>
                    </span>
                  ) : folderHistory.length === 0 ? (
                    <span>Loading path…</span>
                  ) : (
                    folderHistory.map((entry, index) => {
                      const isLast = index === folderHistory.length - 1;
                      return (
                        <span key={entry.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              void loadDriveEntries({ parent: index === 0 ? undefined : entry.id })
                            }
                            className={`text-xs ${isLast ? "text-gray-900" : "text-blue-600 hover:underline"}`}
                          >
                            {index === 0 ? "Root" : entry.name}
                          </button>
                          {isLast ? null : <span className="text-gray-400">/</span>}
                        </span>
                      );
                    })
                  )}
                </div>

                <div className="rounded border border-gray-200">
                  {folderLoading ? (
                    <div className="p-4 text-sm text-gray-600">Loading Drive content…</div>
                  ) : folderChildren.length === 0 && fileChildren.length === 0 ? (
                    <div className="p-4 text-sm text-gray-600">
                      {driveBrowserMode === "search"
                        ? "No files or folders matched your search."
                        : "This folder does not contain any files or folders yet."}
                    </div>
                  ) : (
                    <div className="max-h-96 overflow-y-auto">
                      <div className="bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Folders
                      </div>
                      {folderChildren.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-600">No folders here.</div>
                      ) : (
                        folderChildren.map((folder) => {
                          const isSelected = selectedFolder?.id === folder.id;
                          const breadcrumb =
                            driveBrowserMode === "search"
                              ? folder.path
                              : folderHistory.length > 0
                              ? [...folderHistory.map((entry) => entry.name), folder.name].join(" / ")
                              : folder.name;

                          return (
                            <button
                              key={folder.id}
                              type="button"
                              onClick={() => {
                                setSelectedFolder(folder);
                                setSelectedFile(null);
                              }}
                              onDoubleClick={() => void loadDriveEntries({ parent: folder.id })}
                              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${
                                isSelected ? "bg-blue-50" : "hover:bg-gray-50"
                              }`}
                              title="Double-click to open this folder"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-gray-900">{folder.name}</div>
                                <div className="truncate text-xs text-gray-500">{breadcrumb}</div>
                              </div>
                              <span className="text-xs text-gray-400">›</span>
                            </button>
                          );
                        })
                      )}

                      <div className="bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Files
                      </div>
                      {fileChildren.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-600">No files here.</div>
                      ) : (
                        fileChildren.map((file) => {
                          const isSelected = selectedFile?.id === file.id;
                          const displayPath =
                            driveBrowserMode === "search" && file.path
                              ? file.path
                              : folderHistory.length > 0
                              ? [...folderHistory.map((entry) => entry.name), file.name].join(" / ")
                              : file.name;

                          return (
                            <button
                              key={file.id}
                              type="button"
                              onClick={() => {
                                setSelectedFile(file);
                                setSelectedFolder(null);
                              }}
                              onDoubleClick={() => {
                                if (file.webViewLink) {
                                  window.open(file.webViewLink, "_blank", "noopener");
                                }
                              }}
                              className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left ${
                                isSelected ? "bg-blue-50" : "hover:bg-gray-50"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-gray-900">{file.name}</div>
                                <div className="truncate text-xs text-gray-500">{displayPath}</div>
                                <div className="mt-1 text-xs text-gray-400">
                                  {file.mimeType || "Unknown"}
                                  {file.modifiedTime ? ` · Updated ${formatRelativeDate(file.modifiedTime)}` : null}
                                  {file.size ? ` · ${formatSize(file.size)}` : null}
                                </div>
                              </div>
                              {file.iconLink ? (
                                <img src={file.iconLink} alt="" className="h-5 w-5 flex-shrink-0" />
                              ) : (
                                <span className="text-xs text-gray-400">📄</span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {folderError ? <p className="mt-2 text-sm text-red-600">{folderError}</p> : null}
              </div>

              <aside className="w-full md:w-72 md:flex-shrink-0">
                <div className="rounded border border-gray-200 bg-gray-50 p-4">
                  {selectedEntryType === "folder" && selectedFolder ? (
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{selectedFolder.name}</h3>
                        <p className="mt-1 break-words text-xs text-gray-600">
                          {selectedFolderPath || selectedFolder.path}
                        </p>
                      </div>
                      {selectedFolder.webViewLink ? (
                        <a
                          href={selectedFolder.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center text-xs font-medium text-blue-600 hover:underline"
                        >
                          Open in Drive
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleConnectSelected}
                        disabled={!selectedEntryType || isConnectingSelection}
                        className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        {isConnectingSelection ? "Connecting…" : "Connect this folder"}
                      </button>
                    </div>
                  ) : selectedEntryType === "file" && selectedFile ? (
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{selectedFile.name}</h3>
                        <p className="mt-1 break-words text-xs text-gray-600">{selectedFilePath}</p>
                      </div>
                      <dl className="space-y-1 text-xs text-gray-500">
                        <div>
                          <dt className="font-medium text-gray-700">Type</dt>
                          <dd>{selectedFile.mimeType || "Unknown"}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-gray-700">Updated</dt>
                          <dd>{formatRelativeDate(selectedFile.modifiedTime ?? null)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-gray-700">Size</dt>
                          <dd>{selectedFile.size ? formatSize(selectedFile.size) : "—"}</dd>
                        </div>
                      </dl>
                      {selectedFile.webViewLink ? (
                        <a
                          href={selectedFile.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center text-xs font-medium text-blue-600 hover:underline"
                        >
                          Open in Drive
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleConnectSelected}
                        disabled={!selectedEntryType || isConnectingSelection}
                        className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        {isConnectingSelection ? "Connecting…" : "Connect this file"}
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">
                      Select a folder or file to view its details and connect it to the project.
                    </p>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </div>
      );

  return (
    <>
      {folderModal}

      <div className="flex flex-col gap-6">
      <section className="rounded-md border border-gray-200 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Google Drive connection</h3>
            {driveAccount ? (
              <p className="text-sm text-gray-600">
                Connected as <span className="font-medium">{driveAccount.email}</span>. Manage this integration from your
                profile.
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                Connect Google Drive from your profile to browse folders and attach files to this project.
              </p>
            )}
            {driveError ? <p className="mt-2 text-sm text-red-600">{driveError}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshDriveAccountStatus()}
              disabled={driveLoading}
              className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              {driveLoading ? "Refreshing…" : "Refresh status"}
            </button>
            <button
              type="button"
              onClick={handleGoToProfile}
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
            >
              Open profile
            </button>
          </div>
        </div>
      </section>

      {driveAccount ? (
        <section className="rounded-md border border-gray-200 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Connected folders</h3>
              <p className="text-sm text-gray-600">Attach additional Drive folders or reindex metadata.</p>
            </div>
            <button
              className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100"
              onClick={handleOpenFolderModal}
              disabled={folderLoading || pendingAction === "connect"}
            >
              Add Drive content
            </button>
          </div>

          <div className="space-y-3">
            {driveSources.length === 0 ? (
              <p className="text-sm text-gray-600">No Drive sources connected yet.</p>
            ) : (
              driveSources.map((source) => {
                  const metadata = (source.metadata ?? {}) as Record<string, unknown>;
                  const accountEmail = typeof metadata.accountEmail === "string" ? (metadata.accountEmail as string) : undefined;
                  const assetCount = initialAssets.filter((asset) => asset.projectSourceId === source.id).length;
                  const isFolder = source.kind === "drive_folder";
                  const title = source.title
                    ?? (isFolder
                      ? (typeof metadata.folderName === "string" ? (metadata.folderName as string) : "Drive Folder")
                      : (typeof metadata.fileName === "string" ? (metadata.fileName as string) : "Drive File"));
                  const path = isFolder
                    ? (typeof metadata.folderPath === "string" ? (metadata.folderPath as string) : source.externalId)
                    : (typeof metadata.path === "string" ? (metadata.path as string) : source.externalId);
                  const mimeType = !isFolder && typeof metadata.mimeType === "string" ? (metadata.mimeType as string) : null;

                  return (
                    <div key={source.id} className="rounded border border-gray-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">
                            {title}
                            <span className="ml-2 rounded-full border border-gray-300 px-2 py-0.5 text-xs font-normal text-gray-600">
                              {isFolder ? "Folder" : "File"}
                            </span>
                          </div>
                          <div className="break-words text-xs text-gray-600">
                            {path} · Connected as {accountEmail ?? "Unknown"}
                            {mimeType ? ` · ${mimeType}` : ""}
                          </div>
                          <div className="text-xs text-gray-500">
                            Last indexed {source.lastIndexedAt ? formatRelativeDate(source.lastIndexedAt) : "never"} · {assetCount} assets
                          </div>
                        </div>
                        <button
                          className="rounded border border-blue-600 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50"
                          onClick={() => handleReindex(source.id)}
                          disabled={pendingAction === `reindex:${source.id}`}
                        >
                          {pendingAction === `reindex:${source.id}` ? "Reindexing…" : "Reindex"}
                        </button>
                      </div>
                    </div>
                  );
                })
            )}
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-gray-200 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Files & Assets</h3>
            <p className="text-sm text-gray-600">Browse indexed Drive files, mark canonical assets, and attach context.</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Assets: {assetPagination.total}</span>
            <button
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-100"
              onClick={() => loadAssets(assetPagination.page)}
              disabled={assetLoading}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={assetFilters.sourceId ?? ""}
            onChange={(event) => handleFilterChange("sourceId", event.target.value || null)}
          >
            <option value="">All sources</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.title ?? source.externalId}
              </option>
            ))}
          </select>

          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={assetFilters.type ?? ""}
            onChange={(event) => handleFilterChange("type", (event.target.value || null) as AssetFilters["type"])}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.label} value={option.value ?? ""}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            value={assetFilters.updated ?? ""}
            onChange={(event) => handleFilterChange("updated", (event.target.value || null) as AssetFilters["updated"])}
          >
            {UPDATED_OPTIONS.map((option) => (
              <option key={option.label} value={option.value ?? ""}>
                {option.label}
              </option>
            ))}
          </select>

          <input
            type="text"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder="Path contains…"
            value={assetFilters.pathContains}
            onChange={(event) => handleFilterChange("pathContains", event.target.value)}
          />

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={assetFilters.canonicalOnly}
              onChange={(event) => handleFilterChange("canonicalOnly", event.target.checked)}
            />
            Canonical only
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={assetFilters.confidentialOnly}
              onChange={(event) => handleFilterChange("confidentialOnly", event.target.checked)}
            />
            Confidential only
          </label>

          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
            onClick={handleApplyFilters}
            disabled={assetLoading}
          >
            Apply filters
          </button>
        </div>

        {assetError ? <p className="mb-3 text-sm text-red-600">{assetError}</p> : null}

        {canonicalAssets.length > 0 ? (
          <div className="mb-4 rounded border border-yellow-200 bg-yellow-50 p-3">
            <h4 className="mb-2 text-sm font-semibold text-yellow-800">Pinned canonical assets</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {canonicalAssets.map((asset) => (
                <div key={asset.id} className="rounded border border-yellow-300 bg-white p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{asset.title}</div>
                      <div className="text-xs text-gray-500">{asset.path}</div>
                      <div className="text-xs text-gray-600">
                        {canonicalLabel(asset.canonicalCategory)} · Last updated {formatRelativeDate(asset.modifiedAt)}
                      </div>
                    </div>
                    <button
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => handleCopyLink(asset.driveWebViewLink ?? asset.driveUrl)}
                    >
                      Copy link
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Size</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Modified</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Path</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assetList.map((asset) => (
                <tr key={asset.id} className={asset.confidential ? "bg-red-50" : undefined}>
                  <td className="max-w-[220px] truncate px-3 py-2 font-medium text-gray-900">
                    {asset.title}
                    {asset.confidential ? <span className="ml-2 rounded bg-red-100 px-1 text-xs text-red-700">Confidential</span> : null}
                    {asset.isCanonical ? (
                      <span className="ml-2 rounded bg-yellow-100 px-1 text-xs text-yellow-700">Canonical</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{asset.mimeType ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{formatSize(asset.size)}</td>
                  <td className="px-3 py-2 text-gray-600">{formatRelativeDate(asset.modifiedAt)}</td>
                  <td className="max-w-[280px] truncate px-3 py-2 text-gray-600">{asset.path ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={() => window.open(asset.driveWebViewLink ?? asset.driveUrl ?? "", "_blank")}
                      >
                        Open
                      </button>
                      <button className="text-blue-600 hover:underline" onClick={() => handleCopyLink(asset.driveWebViewLink ?? asset.driveUrl)}>
                        Copy link
                      </button>
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={() => handleCanonicalToggle(asset)}
                        disabled={pendingAction === `canonical:${asset.id}`}
                      >
                        {asset.isCanonical ? "Unmark canonical" : "Mark canonical"}
                      </button>
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={() => handleLinkAsset(asset)}
                        disabled={pendingAction === `link:${asset.id}`}
                      >
                        Link to email
                      </button>
                      {assetLinksByAssetId.get(asset.id)?.length ? (
                        <button
                          className="text-blue-600 hover:underline"
                          onClick={() => handleUnlinkAsset(asset)}
                          disabled={pendingAction === `unlink:${asset.id}`}
                        >
                          Unlink
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {assetList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-500">
                    {assetLoading ? "Loading assets…" : "No assets match the current filters."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>
            Page {assetPagination.page} of {Math.max(assetPagination.totalPages, 1)}
          </span>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-100"
              onClick={() => handlePageChange(-1)}
              disabled={assetPagination.page <= 1 || assetLoading}
            >
              Previous
            </button>
            <button
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-100"
              onClick={() => handlePageChange(1)}
              disabled={!assetPagination.hasMore || assetLoading}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  </>
  );
}
