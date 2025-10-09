"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useParams, useRouter } from "next/navigation";
import type {
  EmailRecord,
  EmailAttachmentRecord,
  ProjectRecord,
  ProjectTaskRecord,
  TimelineItemRecord,
  TimelineDependencyRecord,
  TimelineDependencyKind,
  ApprovalRecord,
  ProjectTopAction,
  ProjectMemberRecord,
  ProjectMemberRole,
} from "@kazador/shared";
import {
  createProjectTask,
  createTimelineItem,
  deleteProjectTask,
  deleteTimelineItem,
  fetchProjectHub,
  linkEmailToProject,
  unlinkEmailFromProject,
  updateProject,
  updateProjectTask,
  respondToApproval,
  type ProjectHubResponse,
  fetchEmailAttachments,
  fileEmailAttachmentsToDrive,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember,
  searchProfiles,
  type ProfileSummary,
} from "../../../../lib/supabaseClient";
import { useAuth } from "../../../../components/AuthProvider";
import { TimelineStudio } from "../../../../components/projects/TimelineStudio";
import ProjectFilesTab from "../../../../components/projects/FilesTab";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "timeline", label: "Timeline" },
  { value: "inbox", label: "Inbox" },
  { value: "tasks", label: "Tasks" },
  { value: "files", label: "Files & Assets" },
  { value: "people", label: "People" },
  { value: "approvals", label: "Approvals" },
  { value: "settings", label: "Settings" },
] as const;

type TabKey = (typeof TABS)[number]["value"];

const TIMELINE_TYPES: TimelineItemRecord["type"][] = [
  "LIVE_HOLD",
  "TRAVEL_SEGMENT",
  "PROMO_SLOT",
  "RELEASE_MILESTONE",
  "LEGAL_ACTION",
  "FINANCE_ACTION",
];

const MEMBER_ROLE_OPTIONS: ProjectMemberRole[] = ["owner", "editor", "viewer"];

const DAY_MS = 24 * 60 * 60 * 1000;

function formatRoleLabel(role: ProjectMemberRole): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "editor":
      return "Editor";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}

interface TimelineFormState {
  title: string;
  type: TimelineItemRecord["type"];
  startsAt: string;
  endsAt: string;
  lane: string;
  territory: string;
  priority: number;
  dependencies: string[];
  dependencyKind: TimelineDependencyKind;
}

interface TaskFormState {
  title: string;
  description: string;
  status: string;
  dueAt: string;
  priority: number;
}

const INITIAL_TIMELINE_FORM: TimelineFormState = {
  title: "",
  type: "LIVE_HOLD",
  startsAt: "",
  endsAt: "",
  lane: "",
  territory: "",
  priority: 50,
  dependencies: [],
  dependencyKind: "FS",
};

const INITIAL_TASK_FORM: TaskFormState = {
  title: "",
  description: "",
  status: "todo",
  dueAt: "",
  priority: 50,
};

export default function ProjectHubPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const { session, user } = useAuth();
  const accessToken = session?.access_token ?? null;
  const projectId = params?.projectId ?? "";

  const [hub, setHub] = useState<ProjectHubResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [timelineForm, setTimelineForm] = useState<TimelineFormState>(INITIAL_TIMELINE_FORM);
  const [taskForm, setTaskForm] = useState<TaskFormState>(INITIAL_TASK_FORM);
  const [linkEmailId, setLinkEmailId] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [processingApprovalId, setProcessingApprovalId] = useState<string | null>(null);
  const [filingContext, setFilingContext] = useState<{ emailId: string; subject: string } | null>(null);
  const [filingAttachments, setFilingAttachments] = useState<EmailAttachmentRecord[]>([]);
  const [filingSelected, setFilingSelected] = useState<Set<string>>(new Set());
  const [filingSourceId, setFilingSourceId] = useState<string>("");
  const [filingSubfolder, setFilingSubfolder] = useState<string>("");
  const [filingLoading, setFilingLoading] = useState(false);
  const [filingError, setFilingError] = useState<string | null>(null);
  const [filingSuccess, setFilingSuccess] = useState<string | null>(null);
  const [memberSearchTerm, setMemberSearchTerm] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState<ProfileSummary[]>([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchError, setMemberSearchError] = useState<string | null>(null);
  const [memberInviteRole, setMemberInviteRole] = useState<ProjectMemberRecord["role"]>("editor");
  const [memberActionKey, setMemberActionKey] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [memberActionSuccess, setMemberActionSuccess] = useState<string | null>(null);

  const loadHub = useCallback(async () => {
    if (!projectId || !accessToken) {
      setError("Project context missing or authentication expired.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetchProjectHub(projectId, accessToken);
      setHub(response);
    } catch (err: any) {
      console.error("Failed to load project hub", err);
      setError(err?.message || "Failed to load project hub");
    } finally {
      setLoading(false);
    }
  }, [projectId, accessToken]);

  useEffect(() => {
    void loadHub();
  }, [loadHub]);

  const project = hub?.project;

  const topActions: ProjectTopAction[] = hub?.topActions ?? [];
  const timelineDependencies: TimelineDependencyRecord[] = hub?.timelineDependencies ?? [];
  const timelineItems: TimelineItemRecord[] = hub?.timelineItems ?? [];
  const approvals: ApprovalRecord[] = hub?.approvals ?? [];
  const currentUserId = user?.id ?? null;

  const { timelineStartDate, timelineEndDate } = useMemo(() => {
    const now = Date.now();
    const defaultStart = new Date(now - DAY_MS * 3);
    const defaultEnd = new Date(now + DAY_MS * 10);

    if (timelineItems.length === 0) {
      return { timelineStartDate: defaultStart, timelineEndDate: defaultEnd };
    }

    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;

    for (const item of timelineItems) {
      const parsedStart = item.startsAt ? Date.parse(item.startsAt) : null;
      const parsedEnd = item.endsAt ? Date.parse(item.endsAt) : null;

      if (parsedStart != null && !Number.isNaN(parsedStart)) {
        minStart = Math.min(minStart, parsedStart);
        if (parsedEnd != null && !Number.isNaN(parsedEnd)) {
          maxEnd = Math.max(maxEnd, parsedEnd);
        } else {
          maxEnd = Math.max(maxEnd, parsedStart);
        }
      } else if (parsedEnd != null && !Number.isNaN(parsedEnd)) {
        minStart = Math.min(minStart, parsedEnd);
        maxEnd = Math.max(maxEnd, parsedEnd);
      }
    }

    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
      return { timelineStartDate: defaultStart, timelineEndDate: defaultEnd };
    }

    if (maxEnd < minStart) {
      maxEnd = minStart + DAY_MS;
    }

    const padding = DAY_MS;

    return {
      timelineStartDate: new Date(minStart - padding),
      timelineEndDate: new Date(maxEnd + padding),
    };
  }, [timelineItems]);

  const timelineViewMode = "week" as const;
  const timelineZoom = 1;

  const currentMembership = useMemo(() => {
    if (!hub?.members || !currentUserId) return null;
    return hub.members.find((entry) => entry.member.userId === currentUserId) ?? null;
  }, [hub?.members, currentUserId]);

  const ownerCount = useMemo(() => {
    if (!hub?.members) return 0;
    return hub.members.filter((entry) => entry.member.role === "owner").length;
  }, [hub?.members]);

  const canManageMembers = currentMembership?.member.role === "owner";

  const memberIds = useMemo(() => {
    if (!hub?.members) return new Set<string>();
    return new Set(hub.members.map((entry) => entry.member.userId));
  }, [hub?.members]);

  const upcomingTimeline = useMemo(() => {
    if (timelineItems.length === 0) return [];
    const now = Date.now();
    return timelineItems
      .filter((item) => item.startsAt && new Date(item.startsAt).getTime() >= now)
      .sort((a, b) => new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime())
      .slice(0, 5);
  }, [timelineItems]);

  const emailSuggestionApprovals = useMemo(
    () => approvals.filter((approval) => approval.type === "project_email_link"),
    [approvals]
  );

  const driveSources = useMemo(
    () => (hub?.sources ?? []).filter((source) => source.kind === "drive_folder"),
    [hub?.sources]
  );

  useEffect(() => {
    if (!filingContext) return;

    if (driveSources.length === 0) {
      setFilingAttachments([]);
      setFilingSelected(new Set());
      setFilingSourceId("");
      setFilingError("Connect a Drive folder to file attachments.");
      return;
    }

    if (!filingSourceId) {
      setFilingSourceId(driveSources[0].id);
    }

    if (!accessToken) {
      setFilingError("Your session expired. Please sign in again.");
      return;
    }

    let cancelled = false;
    setFilingLoading(true);
    setFilingError(null);
    setFilingSuccess(null);
    void fetchEmailAttachments(filingContext.emailId, accessToken)
      .then((attachments) => {
        if (cancelled) return;
        setFilingAttachments(attachments);
        setFilingSelected(new Set(attachments.map((attachment) => attachment.id)));
      })
      .catch((err: any) => {
        if (cancelled) return;
        setFilingError(err?.message || "Failed to load attachments");
      })
      .finally(() => {
        if (cancelled) return;
        setFilingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filingContext, accessToken, driveSources, filingSourceId]);

  const formatApprovalSummary = (approval: ApprovalRecord) => {
    const payload = (approval.payload as Record<string, unknown>) ?? {};
    const metadata: string[] = [];
    let title = "Review request";
    let subtitle = approval.type;

    if (approval.type === "project_email_link") {
      title = typeof payload.emailSubject === "string" ? (payload.emailSubject as string) : "Link classified email";
      subtitle = "Attach classified email";
      if (typeof payload.primaryLabel === "string") {
        metadata.push(`Label ${payload.primaryLabel}`);
      }
      if (typeof payload.score === "number") {
        metadata.push(`Score ${Math.round(payload.score as number)}`);
      }
      if (Array.isArray(payload.rationales)) {
        const reasons = payload.rationales as string[];
        metadata.push(...reasons.slice(0, 3));
        if (reasons.length > 3) {
          metadata.push(`+${reasons.length - 3} additional signals`);
        }
      }
    } else if (approval.type === "timeline_item_from_email") {
      title = typeof payload.title === "string" ? (payload.title as string) : "Add timeline entry";
      subtitle = "Proposed timeline item";
      if (typeof payload.startsAt === "string") {
        metadata.push(`Starts ${new Date(payload.startsAt as string).toLocaleString()}`);
      }
      if (typeof payload.lane === "string") {
        metadata.push(`Lane ${payload.lane}`);
      }
      if (Array.isArray(payload.dependencies) && (payload.dependencies as unknown[]).length > 0) {
        metadata.push(`${(payload.dependencies as unknown[]).length} dependencies`);
      }
    } else {
      if (typeof payload.summary === "string") {
        metadata.push(payload.summary as string);
      }
    }

    return { title, subtitle, metadata };
  };

  const handleTimelineField = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setTimelineForm((prev) => ({ ...prev, [name]: name === "priority" ? Number(value) : value }));
  };

  const handleTimelineDependencies = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(event.target.selectedOptions).map((option) => option.value);
    setTimelineForm((prev) => ({ ...prev, dependencies: selected }));
  };

  const handleTaskField = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setTaskForm((prev) => ({ ...prev, [name]: name === "priority" ? Number(value) : value }));
  };

  const submitTimelineItem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !accessToken || !timelineForm.title.trim()) {
      setError("Timeline item title is required");
      return;
    }

    try {
      const dependenciesPayload = timelineForm.dependencies.length
        ? timelineForm.dependencies.map((dependencyId) => ({
            itemId: dependencyId,
            kind: timelineForm.dependencyKind,
          }))
        : undefined;

      await createTimelineItem(
        projectId,
        {
          title: timelineForm.title.trim(),
          type: timelineForm.type,
          startsAt: timelineForm.startsAt || null,
          endsAt: timelineForm.endsAt || null,
          lane: timelineForm.lane || null,
          territory: timelineForm.territory || null,
          priority: timelineForm.priority,
          dependencies: dependenciesPayload,
        },
        accessToken
      );
      setTimelineForm(INITIAL_TIMELINE_FORM);
      await loadHub();
    } catch (err: any) {
      setError(err?.message || "Failed to add timeline item");
    }
  };

  const submitTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !accessToken || !taskForm.title.trim()) {
      setError("Task title is required");
      return;
    }

    try {
      await createProjectTask(
        projectId,
        {
          title: taskForm.title.trim(),
          description: taskForm.description.trim() || undefined,
          status: taskForm.status,
          dueAt: taskForm.dueAt || undefined,
          priority: taskForm.priority,
        },
        accessToken
      );
      setTaskForm(INITIAL_TASK_FORM);
      await loadHub();
    } catch (err: any) {
      setError(err?.message || "Failed to add task");
    }
  };

  const updateTaskStatus = async (task: ProjectTaskRecord, status: string) => {
    if (!projectId || !accessToken) return;
    try {
      await updateProjectTask(projectId, task.id, { status }, accessToken);
      await loadHub();
    } catch (err: any) {
      setError(err?.message || "Failed to update task");
    }
  };

  const removeTask = async (task: ProjectTaskRecord) => {
    if (!projectId || !accessToken) return;
    try {
      await deleteProjectTask(projectId, task.id, accessToken);
      await loadHub();
    } catch (err: any) {
      setError(err?.message || "Failed to delete task");
    }
  };

  const removeTimelineItem = async (itemId: string) => {
    if (!projectId || !accessToken) return;
    try {
      await deleteTimelineItem(projectId, itemId, accessToken);
      await loadHub();
    } catch (err: any) {
      setError(err?.message || "Failed to delete timeline item");
    }
  };

  const submitEmailLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !accessToken || !linkEmailId.trim()) {
      setError("Email ID required to link");
      return;
    }

    try {
      await linkEmailToProject(projectId, linkEmailId.trim(), accessToken);
      setLinkEmailId("");
      await loadHub();
    } catch (err: any) {
      setError(err?.message || "Failed to attach email");
    }
  };

  const removeEmailLink = async (linkId: string) => {
    if (!projectId || !accessToken) return;
    try {
      await unlinkEmailFromProject(projectId, linkId, accessToken);
      await loadHub();
    } catch (err: any) {
      setError(err?.message || "Failed to unlink email");
    }
  };

  const startFilingAttachments = (email: EmailRecord | null) => {
    if (!email) {
      setFilingError("Email metadata unavailable");
      return;
    }
    if (driveSources.length === 0) {
      setFilingError("Connect a Drive folder first");
      return;
    }
    setFilingContext({ emailId: email.id, subject: email.subject ?? "Email" });
    setFilingSubfolder("");
  };

  const closeFilingModal = () => {
    setFilingContext(null);
    setFilingAttachments([]);
    setFilingSelected(new Set());
    setFilingSubfolder("");
    setFilingError(null);
    setFilingSuccess(null);
  };

  const toggleAttachmentSelection = (attachmentId: string) => {
    setFilingSelected((prev) => {
      const next = new Set(prev);
      if (next.has(attachmentId)) {
        next.delete(attachmentId);
      } else {
        next.add(attachmentId);
      }
      return next;
    });
  };

  const submitAttachmentFiling = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!filingContext || !projectId || !accessToken) return;
    if (!filingSourceId) {
      setFilingError("Select a destination folder");
      return;
    }
    if (filingSelected.size === 0) {
      setFilingError("Select at least one attachment");
      return;
    }

    setFilingLoading(true);
    setFilingError(null);
    setFilingSuccess(null);
    try {
      await fileEmailAttachmentsToDrive(
        projectId,
        filingContext.emailId,
        {
          projectSourceId: filingSourceId,
          attachmentIds: Array.from(filingSelected),
          subfolderPath: filingSubfolder || undefined,
        },
        accessToken
      );
      setFilingSuccess("Filed attachments to Drive.");
      await loadHub();
    } catch (err: any) {
      setFilingError(err?.message || "Failed to file attachments");
    } finally {
      setFilingLoading(false);
    }
  };

  const handleApprovalAction = async (
    approvalId: string,
    action: "approve" | "decline",
    note?: string
  ) => {
    if (!accessToken) return;
    setProcessingApprovalId(approvalId);
    try {
      await respondToApproval(approvalId, action, { note, accessToken });
      await loadHub();
    } catch (err: any) {
      setError(err?.message || "Failed to process approval");
    } finally {
      setProcessingApprovalId(null);
    }
  };

  const submitSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !accessToken || !project) return;

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();
    const status = form.get("status") as ProjectRecord["status"];
    const startDate = String(form.get("startDate") || "");
    const endDate = String(form.get("endDate") || "");
    const color = String(form.get("color") || "");

    if (!name) {
      setSettingsError("Project name cannot be empty");
      return;
    }

    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(null);

    try {
      const updated = await updateProject(
        projectId,
        {
          name,
          description,
          status,
          startDate: startDate || null,
          endDate: endDate || null,
          color: color || null,
        },
        accessToken
      );
      setHub((prev) => (prev ? { ...prev, project: updated } : prev));
      setSettingsSuccess("Project settings updated");
    } catch (err: any) {
      setSettingsError(err?.message || "Failed to update project");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleMemberSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMemberActionError(null);
    setMemberActionSuccess(null);

    if (!accessToken) {
      setMemberSearchError("Your session expired. Please sign in again.");
      setMemberSearchResults([]);
      return;
    }

    const query = memberSearchTerm.trim();
    if (query.length < 2) {
      setMemberSearchError("Enter at least two characters to search.");
      setMemberSearchResults([]);
      return;
    }

    setMemberSearchLoading(true);
    setMemberSearchError(null);
    try {
      const results = await searchProfiles({ query, limit: 8, accessToken });
      setMemberSearchResults(results);
      if (results.length === 0) {
        setMemberSearchError("No matching profiles found.");
      }
    } catch (err: any) {
      setMemberSearchResults([]);
      setMemberSearchError(err?.message || "Failed to search profiles");
    } finally {
      setMemberSearchLoading(false);
    }
  };

  const handleAddMember = async (profile: ProfileSummary) => {
    if (!projectId || !accessToken) {
      setMemberActionError("Missing project context or authentication.");
      return;
    }

    if (memberIds.has(profile.id)) {
      setMemberActionError("That profile is already part of the project.");
      return;
    }

    setMemberActionError(null);
    setMemberActionSuccess(null);
    setMemberActionKey(`add:${profile.id}`);

    try {
      await addProjectMember(projectId, { userId: profile.id, role: memberInviteRole }, accessToken);
      const displayName = profile.fullName || profile.email || "New member";
      setMemberActionSuccess(`Added ${displayName} as ${formatRoleLabel(memberInviteRole)}.`);
      setMemberSearchTerm("");
      setMemberSearchResults([]);
      await loadHub();
    } catch (err: any) {
      setMemberActionError(err?.message || "Failed to add project member");
    } finally {
      setMemberActionKey(null);
    }
  };

  const handleMemberRoleChange = async (
    member: ProjectMemberRecord,
    role: ProjectMemberRecord["role"]
  ) => {
    if (!projectId || !accessToken) {
      setMemberActionError("Missing project context or authentication.");
      return;
    }

    if (role === member.role) {
      return;
    }

    if (member.userId === currentUserId && member.role === "owner" && role !== "owner" && ownerCount <= 1) {
      setMemberActionError("At least one owner is required.");
      return;
    }

    setMemberActionError(null);
    setMemberActionSuccess(null);
    setMemberActionKey(`update:${member.id}`);

    const existingEntry = hub?.members.find((entry) => entry.member.id === member.id);
    const displayName = existingEntry?.profile?.fullName || existingEntry?.profile?.email || member.userId;

    try {
      await updateProjectMemberRole(projectId, member.id, role, accessToken);
      setMemberActionSuccess(`Updated ${displayName} to ${formatRoleLabel(role)}.`);
      await loadHub();
    } catch (err: any) {
      setMemberActionError(err?.message || "Failed to update member role");
    } finally {
      setMemberActionKey(null);
    }
  };

  const handleRemoveMember = async (member: ProjectMemberRecord) => {
    if (!projectId || !accessToken) {
      setMemberActionError("Missing project context or authentication.");
      return;
    }

    if (member.userId === currentUserId) {
      setMemberActionError("You cannot remove yourself from the project.");
      return;
    }

    if (member.role === "owner" && ownerCount <= 1) {
      setMemberActionError("At least one owner must remain on the project.");
      return;
    }

    setMemberActionError(null);
    setMemberActionSuccess(null);
    setMemberActionKey(`remove:${member.id}`);

    const existingEntry = hub?.members.find((entry) => entry.member.id === member.id);
    const displayName = existingEntry?.profile?.fullName || existingEntry?.profile?.email || member.userId;

    try {
      await removeProjectMember(projectId, member.id, accessToken);
      setMemberActionSuccess(`Removed ${displayName} from the project.`);
      await loadHub();
    } catch (err: any) {
      setMemberActionError(err?.message || "Failed to remove member");
    } finally {
      setMemberActionKey(null);
    }
  };

  if (!projectId) {
    return (
      <section className="space-y-4">
        <p className="text-sm text-red-600">Project identifier missing from the URL.</p>
        <button
          type="button"
          onClick={() => router.push("/projects")}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          Back to projects
        </button>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="flex items-center gap-3 text-sm text-gray-600">
        <span className="h-3 w-3 animate-ping rounded-full bg-gray-400" />
        Loading project hub…
      </section>
    );
  }

  if (error) {
    return (
      <section className="space-y-4">
        <p className="text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => void loadHub()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          Retry
        </button>
      </section>
    );
  }

  if (!hub || !project) {
    return (
      <section className="space-y-4">
        <p className="text-sm text-gray-600">Project could not be found.</p>
        <button
          type="button"
          onClick={() => router.push("/projects")}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white"
        >
          Back to projects
        </button>
      </section>
    );
  }

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatsCard title="Open tasks" value={hub.stats.openTaskCount ?? 0} />
        <StatsCard title="Upcoming timeline" value={hub.stats.upcomingTimelineCount ?? 0} />
        <StatsCard title="Assets indexed" value={hub.stats.assetCount ?? 0} />
        <StatsCard title="Linked emails" value={hub.stats.linkedEmailCount ?? 0} />
        <StatsCard title="Conflicts flagged" value={hub.stats.conflictCount ?? 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Upcoming key dates</h3>
          {upcomingTimeline.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No upcoming timeline items yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-gray-700">
              {upcomingTimeline.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{item.title}</p>
                    <p className="text-xs text-gray-500">{item.lane || "General"}</p>
                  </div>
                  <span className="text-xs text-gray-500">{item.startsAt ? new Date(item.startsAt).toLocaleString() : "No date"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Top actions</h3>
          {topActions.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No outstanding actions.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm text-gray-700">
              {topActions.map((action) => (
                <li key={action.id} className="rounded border border-gray-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{action.title}</p>
                      <p className="text-xs text-gray-500">
                        {action.entityType === "task" ? "Task" : action.entityType === "timeline" ? "Timeline" : "Email"}
                        {action.startsAt
                          ? ` • ${new Date(action.startsAt).toLocaleDateString()}`
                          : action.dueAt
                          ? ` • ${new Date(action.dueAt).toLocaleDateString()}`
                          : ""}
                      </p>
                    </div>
                    <span className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">
                      {Math.round(action.score)}
                    </span>
                  </div>
                  {action.rationale && action.rationale.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-gray-500">
                      {action.rationale.slice(0, 3).map((reason) => (
                        <li key={`${action.id}-${reason}`}>{reason}</li>
                      ))}
                      {action.rationale.length > 3 ? (
                        <li className="italic text-gray-400">+{action.rationale.length - 3} more factors</li>
                      ) : null}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Project labels</h3>
        {project.labels && Object.keys(project.labels).length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(project.labels).map(([key, value]) => (
              <span key={key} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                <span className="font-medium text-gray-700">{key}</span>
                <span className="text-gray-500">{String(value)}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">No labels assigned yet.</p>
        )}
      </div>
    </div>
  );

  const renderTimeline = () => (
    <div className="space-y-6">
      <TimelineForm
        form={timelineForm}
        onFieldChange={handleTimelineField}
        onDependenciesChange={handleTimelineDependencies}
        onSubmit={submitTimelineItem}
        existingItems={hub?.timelineItems ?? []}
      />
      <TimelineStudio
        items={timelineItems}
        dependencies={timelineDependencies}
        viewMode={timelineViewMode}
        startDate={timelineStartDate}
        endDate={timelineEndDate}
        zoom={timelineZoom}
      />
    </div>
  );

  const renderInbox = () => (
    <div className="space-y-6">
      {emailSuggestionApprovals.length > 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Suggested project links</h3>
          <p className="mt-1 text-sm text-emerald-700">
            Automation spotted emails that likely belong to this project. Approving will attach the email and update your stats.
          </p>
          <ul className="mt-4 space-y-4">
            {emailSuggestionApprovals.map((approval) => {
              const payload = approval.payload as Record<string, unknown>;
              const rationales = Array.isArray(payload?.rationales)
                ? (payload.rationales as string[])
                : [];
              const score = typeof payload?.score === "number" ? Math.round(payload.score) : null;
              const subject = typeof payload?.emailSubject === "string" ? payload.emailSubject : "Linked email";
              const receivedAt = typeof payload?.emailReceivedAt === "string" ? payload.emailReceivedAt : null;
              return (
                <li key={approval.id} className="rounded border border-emerald-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{subject}</p>
                      {receivedAt ? (
                        <p className="text-xs text-gray-500">Received {new Date(receivedAt).toLocaleString()}</p>
                      ) : null}
                      {rationales.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-xs text-gray-600">
                          {rationales.map((reason) => (
                            <li key={`${approval.id}-${reason}`}>{reason}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {score != null ? (
                        <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                          Score {score}
                        </span>
                      ) : null}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleApprovalAction(approval.id, "approve")}
                          disabled={processingApprovalId === approval.id}
                          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
                        >
                          {processingApprovalId === approval.id ? "Applying…" : "Attach"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleApprovalAction(approval.id, "decline")}
                          disabled={processingApprovalId === approval.id}
                          className="rounded-md border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <form onSubmit={submitEmailLink} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Attach email by ID</h3>
        <div className="mt-3 flex gap-3">
          <input
            type="text"
            value={linkEmailId}
            onChange={(event) => setLinkEmailId(event.target.value)}
            placeholder="Email ID"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
          <button
            type="submit"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
          >
            Attach
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Linked emails</h3>
        {hub.emailLinks.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No emails linked yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {hub.emailLinks.map(({ link, email }) => (
              <EmailRow
                key={link.id}
                linkId={link.id}
                email={email}
                onUnlink={() => void removeEmailLink(link.id)}
                onFileAttachments={() => startFilingAttachments(email)}
                canFileAttachments={driveSources.length > 0}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const renderTasks = () => (
    <div className="space-y-6">
      <TaskForm form={taskForm} onFieldChange={handleTaskField} onSubmit={submitTask} />
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Project tasks</h3>
        {hub.tasks.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No tasks yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {hub.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onStatusChange={(status) => void updateTaskStatus(task, status)}
                onRemove={() => void removeTask(task)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const renderFiles = () => (
    <ProjectFilesTab
      project={project}
      sources={hub.sources}
      assets={hub.assets ?? []}
      assetLinks={hub.assetLinks ?? []}
      accessToken={accessToken}
      onRefreshHub={loadHub}
    />
  );

  const renderPeople = () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Project members</h3>
        {hub.members.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No members yet. Owners can add teammates from Settings.</p>
        ) : (
          <ul className="mt-3 space-y-3 text-sm text-gray-700">
            {hub.members.map(({ member, profile }) => (
              <li key={member.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 p-3">
                <div>
                  <p className="font-semibold text-gray-900">{profile?.fullName || profile?.email || member.userId}</p>
                  <p className="text-xs text-gray-500">{profile?.email || "Email unknown"}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{formatRoleLabel(member.role)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Contact activity insights will appear here once email linkage and timeline usage expand.
      </div>
    </div>
  );

  const renderApprovals = () => (
    <div className="space-y-4">
      {approvals.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
          No pending approvals. Automation drafts will appear here as they arrive.
        </div>
      ) : (
        approvals.map((approval) => {
          const summary = formatApprovalSummary(approval);
          const isProcessing = processingApprovalId === approval.id;
          return (
            <div key={approval.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">{summary.subtitle}</p>
                  <h3 className="text-lg font-semibold text-gray-900">{summary.title}</h3>
                  {summary.metadata.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm text-gray-600">
                      {summary.metadata.map((item, index) => (
                        <li key={`${approval.id}-meta-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-2 text-xs text-gray-400">
                    Draft requested {new Date(approval.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                    {approval.type.replaceAll("_", " ")}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleApprovalAction(approval.id, "approve")}
                      disabled={isProcessing}
                      className="rounded-md bg-gray-900 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-500"
                    >
                      {isProcessing ? "Saving…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleApprovalAction(approval.id, "decline")}
                      disabled={isProcessing}
                      className="rounded-md border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-6">
      <form onSubmit={submitSettings} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">General settings</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="md:col-span-2 text-xs font-semibold uppercase text-gray-500">
            Name
            <input
              name="name"
              defaultValue={project.name}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="md:col-span-2 text-xs font-semibold uppercase text-gray-500">
            Description
            <textarea
              name="description"
              defaultValue={project.description ?? ""}
              rows={3}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-gray-500">
            Status
            <select
              name="status"
              defaultValue={project.status}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="text-xs font-semibold uppercase text-gray-500">
            Accent colour
            <input
              name="color"
              type="color"
              defaultValue={project.color ?? "#6366f1"}
              className="mt-1 h-10 w-full rounded-md border border-gray-300"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-gray-500">
            Start date
            <input
              name="startDate"
              type="date"
              defaultValue={project.startDate ? project.startDate.split("T")[0] : ""}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold uppercase text-gray-500">
            End date
            <input
              name="endDate"
              type="date"
              defaultValue={project.endDate ? project.endDate.split("T")[0] : ""}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        {settingsError ? <p className="mt-3 text-sm text-red-600">{settingsError}</p> : null}
        {settingsSuccess ? <p className="mt-3 text-sm text-green-600">{settingsSuccess}</p> : null}
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={settingsSaving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {settingsSaving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Members &amp; roles</h3>
        <p className="mt-1 text-sm text-gray-600">
          Owners can adjust access levels, invite collaborators, and keep this project scoped to the right team.
        </p>
        {memberActionError ? <p className="mt-3 text-sm text-red-600">{memberActionError}</p> : null}
        {memberActionSuccess ? <p className="mt-3 text-sm text-emerald-600">{memberActionSuccess}</p> : null}

        <div className="mt-4">
          {hub.members.length === 0 ? (
            <p className="text-sm text-gray-500">No members added yet.</p>
          ) : (
            <ul className="space-y-3 text-sm text-gray-700">
              {hub.members.map(({ member, profile }) => {
                const isCurrent = member.userId === currentUserId;
                const isLastOwner = member.role === "owner" && ownerCount <= 1;
                const updateKey = `update:${member.id}`;
                const removeKey = `remove:${member.id}`;
                const isUpdating = memberActionKey === updateKey;
                const isRemoving = memberActionKey === removeKey;
                const canRemove = canManageMembers && !isCurrent && !(member.role === "owner" && ownerCount <= 1);
                return (
                  <li
                    key={member.id}
                    className="flex flex-col gap-3 rounded border border-gray-200 p-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="font-semibold text-gray-900">
                        {profile?.fullName || profile?.email || member.userId}
                        {isCurrent ? " • You" : ""}
                      </p>
                      <p className="text-xs text-gray-500">{profile?.email || "Email unknown"}</p>
                    </div>
                    {canManageMembers ? (
                      <div className="flex flex-col items-start gap-2 md:flex-row md:items-center">
                        <select
                          value={member.role}
                          onChange={(event) =>
                            void handleMemberRoleChange(
                              member,
                              event.target.value as ProjectMemberRecord["role"]
                            )
                          }
                          disabled={isUpdating || isRemoving || (isCurrent && isLastOwner)}
                          className="rounded border border-gray-300 bg-white px-3 py-1 text-xs"
                        >
                          {MEMBER_ROLE_OPTIONS.map((roleOption) => (
                            <option key={roleOption} value={roleOption}>
                              {formatRoleLabel(roleOption)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void handleRemoveMember(member)}
                          disabled={!canRemove || isRemoving}
                          className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isRemoving ? "Removing…" : "Remove"}
                        </button>
                      </div>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                        {formatRoleLabel(member.role)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {canManageMembers ? (
          <>
            <form onSubmit={handleMemberSearch} className="mt-6 flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[220px] text-xs font-semibold uppercase text-gray-500">
                Search profiles
                <input
                  type="search"
                  value={memberSearchTerm}
                  onChange={(event) => setMemberSearchTerm(event.target.value)}
                  placeholder="Name or email"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Invite as
                <select
                  value={memberInviteRole}
                  onChange={(event) =>
                    setMemberInviteRole(event.target.value as ProjectMemberRecord["role"])
                  }
                  className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  {MEMBER_ROLE_OPTIONS.map((roleOption) => (
                    <option key={roleOption} value={roleOption}>
                      {formatRoleLabel(roleOption)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-500"
                disabled={memberSearchLoading}
              >
                {memberSearchLoading ? "Searching…" : "Search"}
              </button>
            </form>
            {memberSearchError ? (
              <p className="mt-2 text-sm text-red-600">{memberSearchError}</p>
            ) : null}
            {memberSearchResults.length > 0 ? (
              <ul className="mt-4 space-y-2 text-sm text-gray-700">
                {memberSearchResults.map((profile) => {
                  const alreadyMember = memberIds.has(profile.id);
                  const actionKey = `add:${profile.id}`;
                  const isAdding = memberActionKey === actionKey;
                  return (
                    <li
                      key={profile.id}
                      className="flex flex-col gap-2 rounded border border-gray-200 p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="font-semibold text-gray-900">
                          {profile.fullName || profile.email || "Unnamed profile"}
                        </p>
                        <p className="text-xs text-gray-500">{profile.email || "Email unknown"}</p>
                      </div>
                      {alreadyMember ? (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                          Already added
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleAddMember(profile)}
                          disabled={isAdding}
                          className="rounded-md bg-gray-900 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-500"
                        >
                          {isAdding ? "Adding…" : `Add as ${formatRoleLabel(memberInviteRole)}`}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            Only project owners can change access. Ask an owner to promote or invite teammates on your behalf.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Source management and default label presets are planned for a later update.
      </div>
    </div>
  );

  const tabContent: Record<TabKey, ReactElement> = {
    overview: renderOverview(),
    timeline: renderTimeline(),
    inbox: renderInbox(),
    tasks: renderTasks(),
    files: renderFiles(),
    people: renderPeople(),
    approvals: renderApprovals(),
    settings: renderSettings(),
  };

  return (
    <>
      <section className="space-y-6">
        <header className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900">{project.name}</h1>
            <p className="text-sm text-gray-600">{project.description || "No description set yet."}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">Status: {project.status}</span>
            {project.color ? (
              <span className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />
                {project.color.toUpperCase()}
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span>Start {project.startDate ? new Date(project.startDate).toLocaleDateString() : "TBD"}</span>
          <span>End {project.endDate ? new Date(project.endDate).toLocaleDateString() : "TBD"}</span>
          <span>{hub.members.length} member{hub.members.length === 1 ? "" : "s"}</span>
          <span>{hub.sources.length} source{hub.sources.length === 1 ? "" : "s"}</span>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                active ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div>{tabContent[activeTab]}</div>
      </section>

      {filingContext ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">File email attachments</h3>
                <p className="text-sm text-gray-600">{filingContext.subject}</p>
              </div>
              <button
                type="button"
                onClick={closeFilingModal}
                className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>

            {filingError ? <p className="mb-3 text-sm text-red-600">{filingError}</p> : null}
            {filingSuccess ? <p className="mb-3 text-sm text-emerald-600">{filingSuccess}</p> : null}

            <form onSubmit={submitAttachmentFiling} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">
                  Destination folder
                  <select
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    value={filingSourceId}
                    onChange={(event) => setFilingSourceId(event.target.value)}
                  >
                    <option value="">Select folder…</option>
                    {driveSources.map((source) => {
                      const metadata = (source.metadata ?? {}) as Record<string, unknown>;
                      const folderPath = typeof metadata.folderPath === "string" ? (metadata.folderPath as string) : undefined;
                      const optionLabel = source.title ?? folderPath ?? source.externalId;
                      return (
                        <option key={source.id} value={source.id}>
                          {optionLabel}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="text-sm font-medium text-gray-700">
                  Subfolder (optional)
                  <input
                    type="text"
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    placeholder="e.g. Inbox/2025-10"
                    value={filingSubfolder}
                    onChange={(event) => setFilingSubfolder(event.target.value)}
                  />
                </label>
              </div>

              <div className="max-h-56 overflow-y-auto rounded border border-gray-200">
                {filingLoading ? (
                  <p className="p-4 text-sm text-gray-500">Loading attachments…</p>
                ) : filingAttachments.length === 0 ? (
                  <p className="p-4 text-sm text-gray-500">No attachments detected for this email.</p>
                ) : (
                  <ul className="divide-y divide-gray-100 text-sm">
                    {filingAttachments.map((attachment) => (
                      <li key={attachment.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <label className="flex flex-1 items-center gap-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300"
                            checked={filingSelected.has(attachment.id)}
                            onChange={() => toggleAttachmentSelection(attachment.id)}
                          />
                          <span className="truncate text-gray-800">{attachment.filename}</span>
                        </label>
                        <span className="text-xs text-gray-500">
                          {attachment.mimeType ?? ""}
                          {attachment.size ? ` • ${(attachment.size / 1024).toFixed(1)} KB` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  Selected {filingSelected.size} of {filingAttachments.length} attachments
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeFilingModal}
                    className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={filingLoading || filingSelected.size === 0 || !filingSourceId}
                    className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    {filingLoading ? "Filing…" : "File to Drive"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function StatsCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-600">{title}</h3>
      <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function TimelineForm({
  form,
  onFieldChange,
  onDependenciesChange,
  onSubmit,
  existingItems,
}: {
  form: TimelineFormState;
  onFieldChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onDependenciesChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  existingItems: TimelineItemRecord[];
}) {
  const sortedTimelineItems = useMemo(() => {
    return [...existingItems].sort((a, b) => {
      const aValueRaw = a.startsAt ? Date.parse(a.startsAt) : Number.POSITIVE_INFINITY;
      const bValueRaw = b.startsAt ? Date.parse(b.startsAt) : Number.POSITIVE_INFINITY;
      const aValue = Number.isNaN(aValueRaw) ? Number.POSITIVE_INFINITY : aValueRaw;
      const bValue = Number.isNaN(bValueRaw) ? Number.POSITIVE_INFINITY : bValueRaw;
      return aValue - bValue;
    });
  }, [existingItems]);

  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Add timeline item</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="md:col-span-2 text-xs font-semibold uppercase text-gray-500">
          Title
          <input
            name="title"
            value={form.title}
            onChange={onFieldChange}
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Type
          <select
            name="type"
            value={form.type}
            onChange={onFieldChange}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {TIMELINE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Starts at
          <input
            name="startsAt"
            type="datetime-local"
            value={form.startsAt}
            onChange={onFieldChange}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Ends at
          <input
            name="endsAt"
            type="datetime-local"
            value={form.endsAt}
            onChange={onFieldChange}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Lane
          <input
            name="lane"
            value={form.lane}
            onChange={onFieldChange}
            placeholder="Live / Promo / Writing / Brand / Release"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="md:col-span-2 text-xs font-semibold uppercase text-gray-500">
          Dependencies
          <select
            name="dependencies"
            multiple
            value={form.dependencies}
            onChange={onDependenciesChange}
            disabled={sortedTimelineItems.length === 0}
            size={Math.min(6, Math.max(3, sortedTimelineItems.length || 3))}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            {sortedTimelineItems.map((item) => {
              const label = item.startsAt
                ? `${item.title} - ${new Date(item.startsAt).toLocaleDateString()}`
                : item.title;
              return (
                <option key={item.id} value={item.id}>
                  {label}
                </option>
              );
            })}
          </select>
          <span className="mt-1 block text-[0.65rem] text-gray-400">Hold Ctrl/Cmd to select multiple blockers.</span>
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Dependency mode
          <select
            name="dependencyKind"
            value={form.dependencyKind}
            onChange={onFieldChange}
            disabled={form.dependencies.length === 0}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="FS">Finish to Start</option>
            <option value="SS">Start to Start</option>
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Territory
          <input
            name="territory"
            value={form.territory}
            onChange={onFieldChange}
            placeholder="e.g. EU, JP"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Priority
          <input
            name="priority"
            type="number"
            min={0}
            max={100}
            value={form.priority}
            onChange={onFieldChange}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
        >
          Add to timeline
        </button>
      </div>
    </form>
  );
}



function TaskForm({
  form,
  onFieldChange,
  onSubmit,
}: {
  form: TaskFormState;
  onFieldChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Add task</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="md:col-span-2 text-xs font-semibold uppercase text-gray-500">
          Title
          <input
            name="title"
            value={form.title}
            onChange={onFieldChange}
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="md:col-span-2 text-xs font-semibold uppercase text-gray-500">
          Description
          <textarea
            name="description"
            rows={3}
            value={form.description}
            onChange={onFieldChange}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Status
          <select
            name="status"
            value={form.status}
            onChange={onFieldChange}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="waiting">Waiting</option>
            <option value="done">Done</option>
          </select>
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Due date
          <input
            name="dueAt"
            type="date"
            value={form.dueAt}
            onChange={onFieldChange}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-semibold uppercase text-gray-500">
          Priority
          <input
            name="priority"
            type="number"
            min={0}
            max={100}
            value={form.priority}
            onChange={onFieldChange}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700"
        >
          Add task
        </button>
      </div>
    </form>
  );
}

function TaskRow({
  task,
  onStatusChange,
  onRemove,
}: {
  task: ProjectTaskRecord;
  onStatusChange: (status: string) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded border border-gray-200 p-3 text-sm text-gray-700 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="font-semibold text-gray-900">{task.title}</p>
        {task.description ? <p className="text-xs text-gray-500">{task.description}</p> : null}
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
          <span>
            Status:
            <select
              value={task.status}
              onChange={(event) => onStatusChange(event.target.value)}
              className="ml-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
            >
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="waiting">Waiting</option>
              <option value="done">Done</option>
            </select>
          </span>
          {task.dueAt ? <span>Due {new Date(task.dueAt).toLocaleDateString()}</span> : null}
          <span>Priority {task.priority ?? 0}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="self-start rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
      >
        Remove
      </button>
    </li>
  );
}

function EmailRow({
  linkId,
  email,
  onUnlink,
  onFileAttachments,
  canFileAttachments,
}: {
  linkId: string;
  email: EmailRecord | null;
  onUnlink: () => void;
  onFileAttachments?: () => void;
  canFileAttachments?: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 rounded border border-gray-200 p-3 text-sm text-gray-700 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="font-semibold text-gray-900">{email?.subject ?? "Email subject unavailable"}</p>
        <p className="text-xs text-gray-500">
          {email?.fromName ? `${email.fromName} • ` : ""}
          {email?.fromEmail}
          {email?.receivedAt ? ` • ${new Date(email.receivedAt).toLocaleString()}` : ""}
        </p>
        {email?.labels && email.labels.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {email.labels.map((label) => (
              <span key={`${linkId}-${label}`} className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                {label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {canFileAttachments ? (
          <button
            type="button"
            onClick={onFileAttachments}
            className="self-start rounded-md border border-blue-500 px-3 py-1 text-xs text-blue-600 hover:bg-blue-50"
          >
            File attachments
          </button>
        ) : null}
        <button
          type="button"
          onClick={onUnlink}
          className="self-start rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
        >
          Unlink
        </button>
      </div>
    </li>
  );
}
