export type EmailLabel = string;

export interface LabelDefinition {
  name: EmailLabel;
  meaning: string;
  whyItMatters: string;
}

export interface CrossLabelDefinition {
  prefix: string;
  meaning: string;
  whyItMatters: string;
}

export const PRIMARY_LABEL_DEFINITIONS: ReadonlyArray<LabelDefinition> = [
  {
    name: "LEGAL/Contract_Draft",
    meaning: "Draft agreements, redlines, and tracked changes requiring review.",
    whyItMatters: "Requires review cycles and can block booking and promo work until resolved.",
  },
  {
    name: "LEGAL/Contract_Executed",
    meaning: "Fully signed contracts and addenda that are legally binding.",
    whyItMatters: "Triggers downstream actions like invoicing and logistics lock-ins.",
  },
  {
    name: "LEGAL/Addendum_or_Amendment",
    meaning: "Changes to contract terms, fees, or dates after execution.",
    whyItMatters: "Can invalidate prior holds and budgets so teams must review immediately.",
  },
  {
    name: "LEGAL/NDA_or_Clearance",
    meaning: "NDAs, image or recording clearances, and sync licences.",
    whyItMatters: "Gates promo content and releases until clearances are confirmed.",
  },
  {
    name: "LEGAL/Insurance_Indemnity",
    meaning: "Certificates of insurance and liability clauses.",
    whyItMatters: "Required by venues and festivals; missing documents create show risk.",
  },
  {
    name: "LEGAL/Compliance",
    meaning: "GDPR, data requests, and policy updates impacting legal compliance.",
    whyItMatters: "Needs careful handling and retention to satisfy regulatory requirements.",
  },
  {
    name: "FINANCE/Settlement",
    meaning: "Post-show settlements covering fees, costs, taxes, and net payouts.",
    whyItMatters: "Directly impacts cash flow and must be reconciled and stored.",
  },
  {
    name: "FINANCE/Invoice",
    meaning: "Invoices sent to or received from promoters, agencies, or brands.",
    whyItMatters: "Drives accounts receivable/payable workflows and payment tracking.",
  },
  {
    name: "FINANCE/Payment_Remittance",
    meaning: "Payment confirmations and remittance advice closing the loop on invoices.",
    whyItMatters: "Updates ledgers and payment status for financial reporting.",
  },
  {
    name: "FINANCE/Banking_Details",
    meaning: "Updates to IBAN, SWIFT, and payee banking information.",
    whyItMatters: "High fraud risk requiring strict verification playbooks.",
  },
  {
    name: "FINANCE/Tax_Docs",
    meaning: "Tax documents such as W-8, W-9, VAT, and withholding certificates.",
    whyItMatters: "Affects net payouts and must be retained for each territory.",
  },
  {
    name: "FINANCE/Expenses_Receipts",
    meaning: "Reimbursable expenses, per diems, and travel receipts.",
    whyItMatters: "Required for accounting and accurate settlements.",
  },
  {
    name: "FINANCE/Royalties_Publishing",
    meaning: "Statements from labels or publishers covering royalties.",
    whyItMatters: "Supports long-term revenue tracking and separate reporting.",
  },
  {
    name: "LOGISTICS/Itinerary_DaySheet",
    meaning: "Day schedules with contacts, set times, and on-site details.",
    whyItMatters: "Serves as the single source of truth feeding the project timeline.",
  },
  {
    name: "LOGISTICS/Travel",
    meaning: "Flight, train, ferry bookings and travel changes.",
    whyItMatters: "Time-sensitive information for conflict checking and buffers.",
  },
  {
    name: "LOGISTICS/Accommodation",
    meaning: "Hotel or Airbnb confirmations and changes.",
    whyItMatters: "Needs alignment with routing and budget planning.",
  },
  {
    name: "LOGISTICS/Ground_Transport",
    meaning: "Drivers, ride shares, and pickup logistics.",
    whyItMatters: "Connects arrivals to venues; failures create show risk.",
  },
  {
    name: "LOGISTICS/Visas_Immigration",
    meaning: "Visa letters, approvals, and immigration appointments.",
    whyItMatters: "Hard blocker for international performances.",
  },
  {
    name: "LOGISTICS/Technical_Advance",
    meaning: "Technical riders, stage plots, backline, and FOH/monitor details.",
    whyItMatters: "Ensures performance readiness and triggers asset shipments.",
  },
  {
    name: "LOGISTICS/Passes_Access",
    meaning: "Accreditation, wristbands, and AAA lists.",
    whyItMatters: "Reduces on-site friction and needs early submission.",
  },
  {
    name: "BOOKING/Offer",
    meaning: "Initial show offers covering city, venue, date, fee, and terms.",
    whyItMatters: "Creates holds and triggers brand-fit scoring and reply drafts.",
  },
  {
    name: "BOOKING/Hold_or_Availability",
    meaning: "Requests to hold dates or check availability.",
    whyItMatters: "Generates tentative calendar holds to prevent clashes.",
  },
  {
    name: "BOOKING/Confirmation",
    meaning: "Pre-contract confirmations that a show is proceeding.",
    whyItMatters: "Promotes the opportunity into contract and logistics setup.",
  },
  {
    name: "BOOKING/Reschedule_or_Cancel",
    meaning: "Changes to dates or terms, including cancellations.",
    whyItMatters: "Triggers cascading updates to timelines, travel, and promotion.",
  },
  {
    name: "PROMO/Promo_Time_Request",
    meaning: "Requests for interviews, guest mixes, or press slots tied to timing.",
    whyItMatters: "Needs routing-aware scheduling and reply drafts with proposed slots.",
  },
  {
    name: "PROMO/Press_Feature",
    meaning: "Articles, reviews, and photo requests from press.",
    whyItMatters: "Requires asset coordination and approvals.",
  },
  {
    name: "PROMO/Radio_Playlist",
    meaning: "Radio plays, playlist adds, and premiere opportunities.",
    whyItMatters: "Feeds track reports and logs supporter quotes.",
  },
  {
    name: "PROMO/Deliverables",
    meaning: "Requests for liners, bios, quotes, or promo copy.",
    whyItMatters: "Creates asset creation tasks with deadlines.",
  },
  {
    name: "PROMO/Promos_Submission",
    meaning: "People sending tracks or promos for listening.",
    whyItMatters: "Needs acknowledgement and routing to the listening queue.",
  },
  {
    name: "ASSETS/Artwork",
    meaning: "Artwork assets such as covers, banners, and social crops.",
    whyItMatters: "Supports version control and connects to releases and promoters.",
  },
  {
    name: "ASSETS/Audio",
    meaning: "Audio files like WAVs, masters, radio edits, instrumentals, or stems.",
    whyItMatters: "Drives SoundCloud drafts and track report completeness.",
  },
  {
    name: "ASSETS/Video",
    meaning: "Video assets including teasers, trailers, live clips, and reels.",
    whyItMatters: "Large files with rights considerations that feed scheduling.",
  },
  {
    name: "ASSETS/Photos",
    meaning: "Press or live photo assets.",
    whyItMatters: "Used for EPK distribution and consistency across channels.",
  },
  {
    name: "ASSETS/Logos_Brand",
    meaning: "Logos, lockups, and style guides.",
    whyItMatters: "Prevents incorrect branding versions from circulating.",
  },
  {
    name: "ASSETS/EPK_OneSheet",
    meaning: "Press kits, one-pagers, and electronic press kits.",
    whyItMatters: "Should auto-attach in replies and serve as a central reference.",
  },
  {
    name: "FAN/Support_or_Thanks",
    meaning: "Supportive or appreciative fan messages.",
    whyItMatters: "Enables friendly auto-acks and inclusion in weekly digests.",
  },
  {
    name: "FAN/Request",
    meaning: "Personal requests such as birthdays or giveaways.",
    whyItMatters: "Needs polite decline templates with optional human review.",
  },
  {
    name: "FAN/Issues_or_Safety",
    meaning: "Sensitive or urgent community issues flagged by fans.",
    whyItMatters: "Must escalate to a human immediately with no automation.",
  },
  {
    name: "MISC/Uncategorized",
    meaning: "Messages that cannot be confidently classified yet.",
    whyItMatters: "Feeds the active learning pool for manual tagging.",
  },
];

export const CROSS_LABEL_DEFINITIONS: ReadonlyArray<CrossLabelDefinition> = [
  {
    prefix: "artist",
    meaning: "Labels scoped to a specific artist, e.g. artist/Barry_Cant_Swim.",
    whyItMatters: "Enables multi-artist filtering and access rules.",
  },
  {
    prefix: "project",
    meaning: "Associates the message with a project slug, e.g. project/Asian_Tour_2026.",
    whyItMatters: "Links to project objects and scoped hubs.",
  },
  {
    prefix: "territory",
    meaning: "ISO2 territory code such as territory/JP.",
    whyItMatters: "Supports routing, compliance, and derived data.",
  },
  {
    prefix: "city",
    meaning: "City names like city/Tokyo.",
    whyItMatters: "Improves routing context and localisation.",
  },
  {
    prefix: "venue",
    meaning: "Venue names, normalised when possible.",
    whyItMatters: "Supports brand-fit enrichment and de-duplication.",
  },
  {
    prefix: "date",
    meaning: "Key dates in ISO format, e.g. date/2026-05-10.",
    whyItMatters: "Enables scheduling precision and conflict checks.",
  },
  {
    prefix: "tz",
    meaning: "Time zone labels using IANA names, e.g. tz/Europe/London.",
    whyItMatters: "Clarifies scheduling context across regions.",
  },
  {
    prefix: "approval",
    meaning: "Approval states such as approval/legal or approval/manager.",
    whyItMatters: "Blocks automation until the required owner signs off.",
  },
  {
    prefix: "confidential",
    meaning: "Flags sensitive content like confidential/true.",
    whyItMatters: "Restricts visibility and sharing.",
  },
  {
    prefix: "status",
    meaning: "Pipeline states such as status/signed or status/pending_info.",
    whyItMatters: "Feeds reporting on negotiation and fulfilment states.",
  },
  {
    prefix: "assettype",
    meaning: "Asset types including assettype/artwork or assettype/wav.",
    whyItMatters: "Speeds up asset routing across systems.",
  },
  {
    prefix: "risk",
    meaning: "Risk flags like risk/missing_contract or risk/payment_delay.",
    whyItMatters: "Escalates issues to dashboards for follow-up.",
  },
];

export const DEFAULT_EMAIL_LABELS = PRIMARY_LABEL_DEFINITIONS.map(
  (definition) => definition.name
) as ReadonlyArray<EmailLabel>;

export const EMAIL_FALLBACK_LABEL: EmailLabel = "MISC/Uncategorized";

/**
 * A simple shape representing an email stored in the database. It contains
 * minimal information used by the frontend and worker. Additional fields
 * can be added as needed (e.g. messageId, threadId, snippet, etc.).
 */
export type EmailTriageState = "unassigned" | "acknowledged" | "snoozed" | "resolved";

export interface EmailRecord {
  id: string;
  fromName: string | null;
  fromEmail: string;
  subject: string;
  receivedAt: string;
  category: EmailLabel;
  isRead: boolean;
  summary?: string | null;
  labels?: EmailLabel[];
  priorityScore?: number | null;
  triageState?: EmailTriageState;
  triagedAt?: string | null;
}

/**
 * Definition of a contact record persisted in the Supabase database.
 */
export interface ContactRecord {
  id: string;
  name: string | null;
  email: string;
  lastEmailAt: string;
}

export type ProjectStatus = "active" | "paused" | "archived";

export type ProjectMemberRole = "owner" | "editor" | "viewer";

export interface ProjectRecord {
  id: string;
  artistId: string | null;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  color: string | null;
  labels: Record<string, string | number | boolean | null>;
  priorityProfile: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberRecord {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  createdAt: string;
}

export type ProjectSourceKind = "drive_folder" | "drive_file" | "sheet" | "calendar" | "external_url";

export interface ProjectSourceRecord {
  id: string;
  projectId: string;
  kind: ProjectSourceKind;
  externalId: string;
  title: string | null;
  watch: boolean;
  scope: string | null;
  metadata: Record<string, unknown> | null;
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectLinkSource = "manual" | "ai" | "rule";

export type AssetSource = "drive";

export type AssetCanonicalCategory = "logo" | "epk" | "cover" | "press" | "audio" | "video" | "other";

export interface AssetRecord {
  id: string;
  projectId: string;
  projectSourceId: string;
  source: AssetSource;
  externalId: string;
  title: string;
  mimeType: string | null;
  size: number | null;
  path: string | null;
  owner: string | null;
  modifiedAt: string | null;
  confidential: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  isCanonical: boolean;
  canonicalCategory: AssetCanonicalCategory | null;
  driveUrl: string | null;
  driveWebViewLink: string | null;
}

export interface AssetLinkRecord {
  id: string;
  projectId: string;
  assetId: string;
  refTable: string;
  refId: string;
  source: ProjectLinkSource;
  createdAt: string;
}

export interface ProjectItemLinkRecord {
  id: string;
  projectId: string;
  refTable: string;
  refId: string;
  confidence: number | null;
  source: ProjectLinkSource;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProjectEmailLinkRecord {
  id: string;
  projectId: string;
  emailId: string;
  confidence: number | null;
  source: ProjectLinkSource;
  createdAt: string;
}

export interface EmailAttachmentRecord {
  id: string;
  emailId: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  storageBucket: string | null;
  storagePath: string | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type OAuthProvider = "google";

export interface OAuthAccountRecord {
  id: string;
  userId: string;
  provider: OAuthProvider;
  accountEmail: string;
  scopes: string[];
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  tokenMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type TimelineDependencyKind = "FS" | "SS";

export interface TimelineDependencyRecord {
  id: string;
  projectId: string;
  fromItemId: string;
  toItemId: string;
  kind: TimelineDependencyKind;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TimelineItemType = "event" | "milestone" | "task" | "hold" | "lead" | "gate";

export interface TimelineItemRecord {
  id: string;
  projectId: string;
  type: TimelineItemType;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  lane: string | null;
  territory: string | null;
  status: string | null;
  priority: number | null;
  refTable: string | null;
  refId: string | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTaskRecord {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  dueAt: string | null;
  priority: number | null;
  assigneeId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ApprovalStatus = "pending" | "approved" | "declined";

export type ApprovalType =
  | "project_email_link"
  | "timeline_item_from_email"
  | "timeline_dependency"
  | "project_label_suggestion"
  | "generic";

export interface ApprovalRecord {
  id: string;
  projectId: string | null;
  type: ApprovalType | string;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  requestedBy: string | null;
  createdBy: string | null;
  approverId: string | null;
  approvedAt: string | null;
  declinedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DerivedLabelSuggestion {
  labelKey: string;
  labelValue: string | number | boolean;
  evidence: Array<{
    assetId?: string;
    path?: string;
    reason: string;
  }>;
}

export type ProjectTopActionEntity = "task" | "timeline" | "email";

export interface ProjectTopAction {
  id: string;
  projectId: string;
  entityType: ProjectTopActionEntity;
  title: string;
  score: number;
  rationale: string[];
  dueAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string | null;
  refTable: string;
  refId: string;
  priority: number | null;
}

export type DigestFrequency = "daily" | "weekly" | "off";

export interface UserPreferenceRecord {
  id: string;
  userId: string;
  digestFrequency: DigestFrequency;
  digestHour: number;
  timezone: string;
  channels: string[];
  quietHours: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDigestMetrics {
  openTasks: number;
  upcomingTimeline: number;
  linkedEmails: number;
  conflicts: number;
  healthScore: number;
  trend: string | null;
}

export interface DigestProjectSnapshot {
  project: ProjectRecord;
  metrics: ProjectDigestMetrics;
  topActions: ProjectTopAction[];
  approvals: ApprovalRecord[];
}

export interface DigestTopAction extends ProjectTopAction {
  projectName: string;
  projectColor: string | null;
  projectStatus: ProjectRecord["status"];
}

export interface DigestPayload {
  generatedAt: string;
  topActions: DigestTopAction[];
  projects: DigestProjectSnapshot[];
  meta: {
    totalProjects: number;
    totalPendingApprovals: number;
    highlightedProjects: number;
  };
}

export type DigestChannel = "web" | "email" | "slack";

export type DigestStatus = "generated" | "queued" | "sent" | "failed";

export interface DigestRecord {
  id: string;
  userId: string;
  generatedFor: string;
  channel: DigestChannel;
  status: DigestStatus;
  payload: DigestPayload;
  deliveredAt: string | null;
  createdAt: string;
}

export interface ProjectTemplateRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTemplateItemRecord {
  id: string;
  templateId: string;
  itemType: TimelineItemType;
  title: string;
  lane: string | null;
  offsetDays: number;
  durationDays: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}
