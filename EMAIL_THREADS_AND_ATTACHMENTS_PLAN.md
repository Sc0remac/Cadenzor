# Email Threads & Attachments Implementation Plan

**Version:** 1.0
**Date:** 2025-10-29
**Status:** Design & Specification

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Email Threading Architecture](#email-threading-architecture)
4. [Attachment Handling Architecture](#attachment-handling-architecture)
5. [Database Schema Changes](#database-schema-changes)
6. [Backend Implementation](#backend-implementation)
7. [Frontend Implementation](#frontend-implementation)
8. [User Configuration & Rules](#user-configuration--rules)
9. [Phased Implementation Plan](#phased-implementation-plan)
10. [Risk Analysis & Mitigation](#risk-analysis--mitigation)

---

## Executive Summary

### Objectives

Transform Kazador's email handling from individual message processing to **conversation-aware threading** with **intelligent attachment routing** to Google Drive. This enables:

- **Thread-level context** for better AI summaries and classification
- **Conversation state management** across days/weeks of back-and-forth
- **Automatic attachment filing** to Drive with user-defined rules
- **Project-scoped attachment organization** with minimal manual overhead

### Key Capabilities

| Feature | Benefit |
|---------|---------|
| **Email Threads** | Understand full context; avoid duplicate classification; track conversation status |
| **Thread Summaries** | Incremental AI updates on new messages; preserve prior context; identify outstanding questions |
| **Attachment Routing** | Auto-save to Drive folders by rule; de-duplicate by hash; link to projects |
| **Smart Folder Discovery** | Respect existing Drive structure; create folders only when needed |
| **User-Defined Rules** | Flexible conditions (sender, label, MIME type, project) → actions (folder template, permissions) |

### Non-Goals (MVP)

- Multi-provider email (Office 365, IMAP) – Gmail only for now
- Attachment preview/editing in Kazador – Drive remains source of truth
- Auto-forwarding or auto-reply based on thread state
- Public partner portals for attachment sharing

---

## Current State Analysis

### What Works Today

#### Email Ingestion (`worker/src/index.ts`)
- Fetches Gmail messages via OAuth refresh tokens (per-user accounts)
- Extracts headers (Subject, From, Date) and body text
- Classifies with OpenAI + heuristic fallback → summary, labels, category, sentiment
- Stores in `emails` table with priority score
- Applies Gmail labels (`Kazador/{category}`)
- Links emails to projects via `project_email_links`

#### Database Tables
- **`emails`**: Single message records with `id` (Gmail message ID), `from_email`, `subject`, `received_at`, `category`, `labels[]`, `summary`, `priority_score`, `triage_state`, `sentiment`, `source`
- **`email_attachments`**: Filename, MIME type, size, hash (sha256), optional storage bucket/path
  - **RLS**: Service-role only (not user-readable)
  - **Foreign key**: `email_id → emails.id` (cascade delete)
- **`contacts`**: Name, email, `last_email_at`
- **`project_email_links`**: Many-to-many email ↔ project with confidence, source (manual/ai/rule)

#### Email Dashboard (`app/components/EmailDashboard.tsx`)
- Lists individual messages (not threads)
- Filters by label, source (Gmail, manual, seeded), triage state
- Shows priority score, category, sentiment, linked projects
- Actions: Acknowledge, Resolve, Snooze, Open in Gmail

#### Attachment Handling
- Worker **detects** attachments (`hasAttachments` flag) but does **not download** or store them
- `email_attachments` table exists but is **unpopulated** in current flow
- No Drive integration for email attachments (Drive indexing exists only for project-linked folders)

### What's Missing

| Gap | Impact |
|-----|--------|
| **No thread tracking** | Cannot understand conversation context; duplicate summaries for replies |
| **No `thread_id`, `in_reply_to`, `references`** | Cannot group messages or detect conversation flow |
| **No `email_threads` rollup table** | No thread-level state (last activity, participant list, rolling summary) |
| **Attachments not downloaded** | Cannot route files to Drive; cannot de-duplicate; no project linkage |
| **No attachment routing rules** | Users cannot configure auto-filing; manual work required |
| **No Drive folder discovery** | System doesn't check for existing structure before creating folders |
| **Thread-agnostic UI** | Inbox shows flat message list; no collapse/expand; no conversation view |

---

## Email Threading Architecture

### Conceptual Model

A **thread** is a collection of related messages sharing a Gmail `threadId`. Each **message** belongs to exactly one thread. Threads have:

- **Conversation state**: participants, subject (canonical), first/last message timestamps, unread count
- **Rolling summary**: AI-generated, incrementally updated as new messages arrive
- **Primary classification**: Derived from message labels (consensus or most recent)
- **Project links**: Inherited from messages or explicitly assigned
- **Priority score**: Thread-level score factoring in recency, heat (message count), unresolved questions, deadlines

### Data Model

#### New: `email_threads` Table

```sql
CREATE TABLE public.email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gmail_thread_id text NOT NULL,
  subject_canonical text NOT NULL,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Counts & timestamps
  message_count int NOT NULL DEFAULT 1,
  first_message_at timestamptz NOT NULL,
  last_message_at timestamptz NOT NULL,
  unread_count int NOT NULL DEFAULT 0,

  -- Classification (derived from messages)
  primary_label text,
  labels text[] DEFAULT '{}',

  -- AI summary (incremental)
  rolling_summary jsonb,  -- { summary: string, key_points: string[], outstanding_questions: string[], last_message_id: string }
  last_summarized_at timestamptz,

  -- Priority
  priority_score numeric(5,2),
  priority_components jsonb,

  -- Projects
  primary_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  project_ids uuid[] DEFAULT '{}',

  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,

  UNIQUE(user_id, gmail_thread_id)
);

CREATE INDEX idx_threads_user_last_message ON email_threads(user_id, last_message_at DESC);
CREATE INDEX idx_threads_priority ON email_threads(user_id, priority_score DESC NULLS LAST);
CREATE INDEX idx_threads_primary_project ON email_threads(primary_project_id) WHERE primary_project_id IS NOT NULL;
```

#### Extended: `emails` Table

Add thread tracking fields:

```sql
ALTER TABLE public.emails
  ADD COLUMN thread_id uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  ADD COLUMN gmail_thread_id text,
  ADD COLUMN gmail_message_id text,  -- Distinct from `id` if we want separation
  ADD COLUMN in_reply_to text,
  ADD COLUMN references text[],
  ADD COLUMN message_index int,  -- Position in thread (0 = first message)
  ADD COLUMN is_internal_reply boolean DEFAULT false,  -- Heuristic: from user's domain
  ADD COLUMN has_open_question boolean DEFAULT false,  -- AI-detected question to user
  ADD COLUMN expected_reply_by timestamptz;  -- Optional deadline extracted from content

CREATE INDEX idx_emails_thread ON emails(thread_id, message_index);
CREATE INDEX idx_emails_gmail_thread ON emails(gmail_thread_id);
```

### Thread Ingestion Flow

#### Worker: `processGmailAccount` (modified)

1. **Fetch thread context**: When Gmail API returns a message, also fetch its full thread via `gmail.users.threads.get()`
2. **Upsert thread record**:
   - Extract `threadId`, subject (from first message), all message IDs
   - Calculate `message_count`, `first_message_at`, `last_message_at`, participant list (from/to/cc deduplicated)
   - Derive `primary_label` from consensus of message labels or most recent message
3. **Upsert messages**:
   - For each message in thread, extract `In-Reply-To` and `References` headers
   - Assign `message_index` (chronological order)
   - Link to `email_threads.id`
4. **Incremental summarization**:
   - If thread has &lt; N messages (e.g., 10), summarize all
   - If thread is long, pass only **last M new messages** + prior `rolling_summary` to AI
   - AI returns **delta update**: new decisions, new questions, resolved items
5. **Priority scoring**: Call `calculateThreadPriority` (new function) with thread-level signals
6. **Project linking**: Apply project assignment rules at thread level; propagate to messages

### Thread Summarization Strategy

#### Inputs to `analyzeThread`

```typescript
interface ThreadAnalysisInput {
  threadId: string;
  messages: Array<{
    id: string;
    subject: string;
    from: { name: string | null; email: string };
    to: string[];
    receivedAt: string;
    body: string;
    messageIndex: number;
  }>;
  priorSummary?: {
    summary: string;
    keyPoints: string[];
    outstandingQuestions: string[];
    lastMessageId: string;
  } | null;
  projectContext?: {
    projectId: string;
    name: string;
    labels: Record<string, any>;
  } | null;
  attachmentContext?: Array<{
    filename: string;
    mimeType: string;
    size: number;
  }>;
}
```

#### Outputs

```typescript
interface ThreadAnalysisResult {
  summary: string;
  keyPoints: string[];          // Decisions, agreements, commitments
  outstandingQuestions: string[]; // Unanswered asks directed at user
  deadlines: Array<{            // Extracted dates with context
    description: string;
    dueAt: string;              // ISO datetime
  }>;
  sentiment: EmailSentiment;
  nextAction: string | null;    // Suggested next step (e.g., "Reply with availability")
  attachmentsOfInterest: string[]; // Filenames that matter (contracts, invoices, etc.)
}
```

#### AI Prompt Strategy

**For new threads (no prior summary):**
```
Analyze this email thread and return structured JSON:
- summary: 2-3 sentence overview
- keyPoints: array of key decisions/facts
- outstandingQuestions: questions directed at the user that remain unanswered
- deadlines: array of { description, dueAt (ISO) }
- sentiment: { label: "positive" | "neutral" | "negative", confidence: 0-1 }
- nextAction: suggested next step for the user
- attachmentsOfInterest: filenames that are critical (contracts, invoices, riders)

Messages (chronological):
[...formatted message list...]
```

**For incremental updates (thread has prior summary):**
```
This thread has a prior summary. Analyze only the NEW messages and return a DELTA update.

Prior summary:
{priorSummary.summary}

Prior key points:
- {priorSummary.keyPoints[0]}
- ...

Prior outstanding questions:
- {priorSummary.outstandingQuestions[0]}
- ...

NEW messages:
[...only messages after lastMessageId...]

Return JSON with:
- summary: UPDATED summary incorporating new info
- newKeyPoints: array of NEW decisions/facts (don't repeat old ones)
- resolvedQuestions: array of prior questions now answered
- newQuestions: array of NEW questions
- deadlines: any NEW or CHANGED deadlines
- sentiment: current sentiment
- nextAction: updated next step
```

**Cost optimization:**
- For threads &gt; 10 messages, only send last 10 + prior summary
- Use cheaper model (gpt-4o-mini) for threads with low activity
- Use streaming if summary is displayed live

### Thread Priority Scoring

Extend `shared/src/emailPriority.ts` with `calculateThreadPriority`:

**Inputs:**
- Thread metadata (message count, last activity, unread count)
- Message content signals (has deadline, has contract keyword, has explicit ask)
- Participant roles (customer, executive, known contact)
- Project context (linked project priority, upcoming milestones)

**Components (0–100 each, weighted):**

| Component | Weight | Logic |
|-----------|--------|-------|
| **Recency** | 25% | Decay function: half-life 24h for time since last message |
| **Heat** | 20% | Message count in last 7 days; bonus if &gt;3 back-and-forth |
| **Urgency** | 25% | Has explicit deadline within 7 days; keyword match (urgent, ASAP, confirm by) |
| **Impact** | 15% | Has attachments (contracts, invoices); linked to high-priority project |
| **Outstanding** | 15% | Has unanswered questions directed at user; expected reply overdue |

**Output:** `priority_score` (0–100) + `priority_components` (breakdown for UI)

### Thread-Level Classification

- **Primary label**: Most common label across messages, or label of most recent message
- **Label consensus**: If 80%+ of messages share a label, apply to thread
- **Label promotion**: If thread linked to project, inherit project labels (e.g., `artist/Barry_Cant_Swim`, `territory/JP`)

---

## Attachment Handling Architecture

### Goals

1. **Auto-download** attachments from Gmail and store them securely
2. **Route to Google Drive** based on user-defined rules (sender, label, project, MIME type)
3. **De-duplicate** by MD5/SHA256 hash
4. **Discover existing Drive structure** before creating folders
5. **Link attachments to projects** via `asset_links`
6. **User control**: Preview rules before applying; manual override per file

### Data Model

#### Extended: `email_attachments` Table

```sql
ALTER TABLE public.email_attachments
  ADD COLUMN gmail_part_id text,
  ADD COLUMN drive_file_id text,
  ADD COLUMN drive_folder_id text,
  ADD COLUMN drive_web_view_link text,
  ADD COLUMN drive_web_content_link text,
  ADD COLUMN path_hint text,  -- Resolved folder path like "Kazador/Barry Cant Swim/Contracts/2026"
  ADD COLUMN processed_at timestamptz,
  ADD COLUMN routing_rule_id uuid REFERENCES attachment_routing_rules(id) ON DELETE SET NULL,
  ADD COLUMN error text,
  ADD COLUMN md5 text,  -- MD5 from Gmail or Drive
  ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

-- Update RLS to allow user reads
DROP POLICY IF EXISTS email_attachments_service_role_only ON public.email_attachments;

CREATE POLICY email_attachments_owner_read ON public.email_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM emails e
      WHERE e.id = email_attachments.email_id
        AND (e.user_id = auth.uid() OR auth.role() = 'service_role')
    )
  );

CREATE POLICY email_attachments_service_write ON public.email_attachments
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_attachments_drive_file ON email_attachments(drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE INDEX idx_attachments_project ON email_attachments(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_attachments_md5 ON email_attachments(md5) WHERE md5 IS NOT NULL;
```

#### New: `attachment_routing_rules` Table

```sql
CREATE TABLE public.attachment_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Rule metadata
  name text NOT NULL,
  description text,
  enabled boolean DEFAULT true,
  priority int DEFAULT 0,  -- Lower = higher priority (first match wins)

  -- Conditions (all must match; null = any)
  conditions jsonb NOT NULL,
  -- Example:
  -- {
  --   "senderDomains": ["example.com", "promoter.co.uk"],
  --   "senderEmails": ["john@example.com"],
  --   "subjectKeywords": ["contract", "invoice"],
  --   "threadLabels": ["LEGAL/Contract_Draft", "FINANCE/Invoice"],
  --   "projectIds": ["<uuid>"],
  --   "mimeTypes": ["application/pdf", "image/*"],
  --   "filenamePatterns": ["*.pdf", "contract_*.docx"],  -- glob or regex
  --   "minSizeBytes": 1024,
  --   "maxSizeBytes": 10485760
  -- }

  -- Actions
  actions jsonb NOT NULL,
  -- Example:
  -- {
  --   "driveFolderTemplate": "Kazador/{project.name}/Contracts/{yyyy}",
  --   "createMissingFolders": true,
  --   "filenameTemplate": "{date}_{original_filename}",
  --   "convertToGoogleDocs": false,  -- For .docx → Google Doc
  --   "shareWithProjectMembers": false,
  --   "addLabels": ["archived", "contract"],
  --   "linkToProject": true,
  --   "deduplicateBy": "md5"  -- "md5" | "sha256" | "filename" | "none"
  -- }

  -- Audit
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_routing_rules_user_priority ON attachment_routing_rules(user_id, priority, enabled);
```

#### New: `drive_folder_cache` Table

Cache resolved Drive folder IDs to avoid repeated lookups:

```sql
CREATE TABLE public.drive_folder_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  path_template text NOT NULL,  -- e.g., "Kazador/{project.slug}/Contracts"
  resolved_path text NOT NULL,  -- e.g., "Kazador/Barry_Cant_Swim/Contracts"
  folder_id text NOT NULL,      -- Google Drive folder ID

  -- Optional project context
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,

  -- Freshness
  last_verified_at timestamptz DEFAULT now(),
  exists boolean DEFAULT true,

  created_at timestamptz DEFAULT now() NOT NULL,

  UNIQUE(user_id, resolved_path)
);

CREATE INDEX idx_drive_cache_user_project ON drive_folder_cache(user_id, project_id) WHERE project_id IS NOT NULL;
```

### Attachment Routing Flow

#### 1. Worker: Download Attachments

**Location:** `worker/src/attachmentJobs.ts` (new file)

**Entry point:** Called from `processGmailAccount` after email upsert

```typescript
async function processEmailAttachments(
  gmail: gmail_v1.Gmail,
  message: gmail_v1.Schema$Message,
  emailRecord: { id: string; userId: string; threadId: string; subject: string; labels: string[] },
  supabase: SupabaseClient
): Promise<void> {
  const parts = extractAttachmentParts(message.payload);

  for (const part of parts) {
    const { filename, mimeType, size, partId, attachmentId } = part;

    // Check if already processed
    const { data: existing } = await supabase
      .from('email_attachments')
      .select('id, drive_file_id')
      .eq('email_id', emailRecord.id)
      .eq('gmail_part_id', partId)
      .maybeSingle();

    if (existing?.drive_file_id) {
      console.log(`Attachment ${filename} already processed`);
      continue;
    }

    // Download from Gmail
    const attachmentData = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: emailRecord.id,
      id: attachmentId!,
    });

    const dataBase64 = attachmentData.data.data!;
    const buffer = Buffer.from(dataBase64, 'base64');
    const md5 = crypto.createHash('md5').update(buffer).digest('hex');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    // Upsert attachment record (without Drive info yet)
    const { data: attachment, error: attachError } = await supabase
      .from('email_attachments')
      .upsert({
        email_id: emailRecord.id,
        gmail_part_id: partId,
        filename,
        mime_type: mimeType,
        size,
        md5,
        sha256,
        metadata: { attachmentId },
      }, { onConflict: 'email_id,gmail_part_id' })
      .select()
      .single();

    if (attachError || !attachment) {
      console.error(`Failed to upsert attachment ${filename}`, attachError);
      continue;
    }

    // Enqueue Drive routing job
    await enqueueAttachmentRouting({
      attachmentId: attachment.id,
      userId: emailRecord.userId,
      emailContext: emailRecord,
      buffer,
    });
  }
}
```

#### 2. Worker: Route to Drive

**Entry point:** Background job or immediate processing (depending on load)

```typescript
async function routeAttachmentToDrive(
  attachmentId: string,
  userId: string,
  emailContext: { id: string; threadId: string; subject: string; labels: string[] },
  buffer: Buffer,
  supabase: SupabaseClient
): Promise<void> {
  // Load attachment
  const { data: attachment } = await supabase
    .from('email_attachments')
    .select('*')
    .eq('id', attachmentId)
    .single();

  if (!attachment) throw new Error(`Attachment ${attachmentId} not found`);

  // Load routing rules for user (ordered by priority)
  const { data: rules } = await supabase
    .from('attachment_routing_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('enabled', true)
    .order('priority', { ascending: true });

  // Find first matching rule
  const matchedRule = rules?.find(rule =>
    evaluateRuleConditions(rule.conditions, {
      senderEmail: emailContext.fromEmail,
      threadLabels: emailContext.labels,
      filename: attachment.filename,
      mimeType: attachment.mime_type,
      size: attachment.size,
      projectId: attachment.project_id,
    })
  );

  if (!matchedRule) {
    console.log(`No routing rule matched for attachment ${attachment.filename}`);
    // Optionally: use default rule or save to "Kazador/Attachments/{yyyy}/{mm}"
    return;
  }

  // Resolve folder template
  const folderPath = await resolveFolderTemplate(
    matchedRule.actions.driveFolderTemplate,
    {
      projectId: attachment.project_id,
      date: new Date(emailContext.receivedAt),
      threadLabels: emailContext.labels,
    },
    supabase
  );

  // Get or create Drive folder
  const folderId = await getOrCreateDriveFolder(
    userId,
    folderPath,
    matchedRule.actions.createMissingFolders,
    supabase
  );

  // Check for duplicate
  if (matchedRule.actions.deduplicateBy === 'md5') {
    const existing = await findDriveFileByMd5(userId, folderId, attachment.md5, supabase);
    if (existing) {
      console.log(`Duplicate detected: ${attachment.filename} (MD5: ${attachment.md5})`);
      await supabase
        .from('email_attachments')
        .update({
          drive_file_id: existing.id,
          drive_folder_id: folderId,
          drive_web_view_link: existing.webViewLink,
          path_hint: folderPath,
          processed_at: new Date().toISOString(),
          routing_rule_id: matchedRule.id,
        })
        .eq('id', attachmentId);
      return;
    }
  }

  // Upload to Drive
  const driveClient = await getDriveClientForUser(userId, supabase);
  const driveFile = await driveClient.files.create({
    requestBody: {
      name: resolveFilenameTemplate(matchedRule.actions.filenameTemplate, attachment.filename, new Date()),
      parents: [folderId],
      mimeType: attachment.mime_type,
    },
    media: {
      mimeType: attachment.mime_type,
      body: Readable.from(buffer),
    },
    fields: 'id, name, webViewLink, webContentLink, md5Checksum',
  });

  // Update attachment record
  await supabase
    .from('email_attachments')
    .update({
      drive_file_id: driveFile.data.id,
      drive_folder_id: folderId,
      drive_web_view_link: driveFile.data.webViewLink,
      drive_web_content_link: driveFile.data.webContentLink,
      path_hint: folderPath,
      processed_at: new Date().toISOString(),
      routing_rule_id: matchedRule.id,
      md5: driveFile.data.md5Checksum,
    })
    .eq('id', attachmentId);

  // Optionally: share with project members
  if (matchedRule.actions.shareWithProjectMembers && attachment.project_id) {
    await shareDriveFileWithProjectMembers(
      driveClient,
      driveFile.data.id!,
      attachment.project_id,
      supabase
    );
  }

  console.log(`Routed ${attachment.filename} to Drive: ${folderPath}`);
}
```

#### 3. Folder Template Resolution

**Template tokens:**

| Token | Example Value | Source |
|-------|---------------|--------|
| `{user.email}` | `oran@example.com` | User profile |
| `{project.name}` | `Barry Cant Swim - Asian Tour` | Project record |
| `{project.slug}` | `barry-asian-tour-2026` | Project record |
| `{label.primary}` | `LEGAL` | Email thread primary label |
| `{yyyy}` | `2026` | Current year or email date |
| `{mm}` | `05` | Current month or email date |
| `{dd}` | `10` | Current day or email date |
| `{artist}` | `Barry Cant Swim` | From thread label `artist/Barry_Cant_Swim` |
| `{territory}` | `JP` | From thread label `territory/JP` |

**Example templates:**

- `Kazador/{project.slug}/Contracts/{yyyy}`
- `Kazador/{artist}/Finance/{label.primary}/{yyyy}-{mm}`
- `Kazador/Attachments/{yyyy}/{mm}`

**Implementation:**

```typescript
async function resolveFolderTemplate(
  template: string,
  context: {
    projectId?: string;
    date: Date;
    threadLabels: string[];
  },
  supabase: SupabaseClient
): Promise<string> {
  let resolved = template;

  // Date tokens
  const yyyy = context.date.getFullYear();
  const mm = String(context.date.getMonth() + 1).padStart(2, '0');
  const dd = String(context.date.getDate()).padStart(2, '0');
  resolved = resolved.replace('{yyyy}', String(yyyy));
  resolved = resolved.replace('{mm}', mm);
  resolved = resolved.replace('{dd}', dd);

  // Project tokens
  if (context.projectId && resolved.includes('{project.')) {
    const { data: project } = await supabase
      .from('projects')
      .select('name, slug')
      .eq('id', context.projectId)
      .single();

    if (project) {
      resolved = resolved.replace('{project.name}', project.name);
      resolved = resolved.replace('{project.slug}', project.slug);
    }
  }

  // Label tokens
  const primaryLabel = context.threadLabels[0]?.split('/')[0] || 'MISC';
  resolved = resolved.replace('{label.primary}', primaryLabel);

  // Artist, territory from cross-tags
  const artistMatch = context.threadLabels.find(l => l.startsWith('artist/'));
  if (artistMatch) {
    const artist = artistMatch.split('/')[1].replace(/_/g, ' ');
    resolved = resolved.replace('{artist}', artist);
  }

  const territoryMatch = context.threadLabels.find(l => l.startsWith('territory/'));
  if (territoryMatch) {
    const territory = territoryMatch.split('/')[1];
    resolved = resolved.replace('{territory}', territory);
  }

  return resolved;
}
```

#### 4. Drive Folder Discovery & Creation

**Cache-first lookup:**

```typescript
async function getOrCreateDriveFolder(
  userId: string,
  path: string,
  createIfMissing: boolean,
  supabase: SupabaseClient
): Promise<string> {
  // Check cache
  const { data: cached } = await supabase
    .from('drive_folder_cache')
    .select('folder_id, exists')
    .eq('user_id', userId)
    .eq('resolved_path', path)
    .maybeSingle();

  if (cached?.exists) {
    // Optionally: verify folder still exists in Drive (every 24h)
    return cached.folder_id;
  }

  // Traverse path or search Drive
  const driveClient = await getDriveClientForUser(userId, supabase);
  const parts = path.split('/').filter(Boolean);
  let parentId = 'root';

  for (const part of parts) {
    const existing = await findDriveFolderByName(driveClient, part, parentId);

    if (existing) {
      parentId = existing.id!;
    } else if (createIfMissing) {
      const created = await driveClient.files.create({
        requestBody: {
          name: part,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
        fields: 'id',
      });
      parentId = created.data.id!;
    } else {
      throw new Error(`Folder not found: ${path} (missing: ${part})`);
    }
  }

  // Cache result
  await supabase
    .from('drive_folder_cache')
    .upsert({
      user_id: userId,
      resolved_path: path,
      folder_id: parentId,
      last_verified_at: new Date().toISOString(),
      exists: true,
    }, { onConflict: 'user_id,resolved_path' });

  return parentId;
}
```

### De-Duplication Strategy

**By MD5 hash:**
1. After downloading attachment from Gmail, compute MD5
2. Query `email_attachments` for existing entries with same `md5` + `user_id` + `drive_folder_id`
3. If found:
   - Link new `email_attachments` row to existing `drive_file_id`
   - Skip upload
   - Log in `metadata`: `{ deduplicatedFrom: <original_attachment_id> }`

**By filename + folder:**
1. Query Drive API for files with same name in target folder
2. If found:
   - Compare size or download Drive file's MD5
   - If match, reuse
   - If mismatch, append timestamp to filename: `contract_v2_20261029.pdf`

---

## Database Schema Changes

### Migration 1: Email Threading

```sql
-- File: migrations/001_email_threading.sql

-- Create email_threads table
CREATE TABLE public.email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gmail_thread_id text NOT NULL,
  subject_canonical text NOT NULL,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  message_count int NOT NULL DEFAULT 1,
  first_message_at timestamptz NOT NULL,
  last_message_at timestamptz NOT NULL,
  unread_count int NOT NULL DEFAULT 0,
  primary_label text,
  labels text[] DEFAULT '{}',
  rolling_summary jsonb,
  last_summarized_at timestamptz,
  priority_score numeric(5,2),
  priority_components jsonb,
  primary_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  project_ids uuid[] DEFAULT '{}',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, gmail_thread_id)
);

CREATE INDEX idx_threads_user_last_message ON email_threads(user_id, last_message_at DESC);
CREATE INDEX idx_threads_priority ON email_threads(user_id, priority_score DESC NULLS LAST);
CREATE INDEX idx_threads_primary_project ON email_threads(primary_project_id) WHERE primary_project_id IS NOT NULL;
CREATE INDEX idx_threads_labels_gin ON email_threads USING gin(labels);

-- Extend emails table
ALTER TABLE public.emails
  ADD COLUMN thread_id uuid REFERENCES email_threads(id) ON DELETE CASCADE,
  ADD COLUMN gmail_thread_id text,
  ADD COLUMN gmail_message_id text,
  ADD COLUMN in_reply_to text,
  ADD COLUMN references text[],
  ADD COLUMN message_index int,
  ADD COLUMN is_internal_reply boolean DEFAULT false,
  ADD COLUMN has_open_question boolean DEFAULT false,
  ADD COLUMN expected_reply_by timestamptz;

CREATE INDEX idx_emails_thread ON emails(thread_id, message_index);
CREATE INDEX idx_emails_gmail_thread ON emails(gmail_thread_id);

-- RLS for email_threads
ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_threads_owner_read ON email_threads
  FOR SELECT USING (user_id = auth.uid() OR auth.role() = 'service_role');

CREATE POLICY email_threads_service_write ON email_threads
  FOR ALL USING (auth.role() = 'service_role');
```

### Migration 2: Attachment Routing

```sql
-- File: migrations/002_attachment_routing.sql

-- Extend email_attachments
ALTER TABLE public.email_attachments
  ADD COLUMN gmail_part_id text,
  ADD COLUMN drive_file_id text,
  ADD COLUMN drive_folder_id text,
  ADD COLUMN drive_web_view_link text,
  ADD COLUMN drive_web_content_link text,
  ADD COLUMN path_hint text,
  ADD COLUMN processed_at timestamptz,
  ADD COLUMN routing_rule_id uuid,
  ADD COLUMN error text,
  ADD COLUMN md5 text,
  ADD COLUMN project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_attachments_email_part ON email_attachments(email_id, gmail_part_id);
CREATE INDEX idx_attachments_drive_file ON email_attachments(drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE INDEX idx_attachments_project ON email_attachments(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_attachments_md5 ON email_attachments(md5) WHERE md5 IS NOT NULL;

-- Update RLS
DROP POLICY IF EXISTS email_attachments_service_role_only ON public.email_attachments;

CREATE POLICY email_attachments_owner_read ON public.email_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM emails e
      WHERE e.id = email_attachments.email_id
        AND (e.user_id = auth.uid() OR auth.role() = 'service_role')
    )
  );

CREATE POLICY email_attachments_service_write ON public.email_attachments
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Create attachment_routing_rules
CREATE TABLE public.attachment_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  enabled boolean DEFAULT true,
  priority int DEFAULT 0,
  conditions jsonb NOT NULL,
  actions jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_routing_rules_user_priority ON attachment_routing_rules(user_id, priority, enabled);

ALTER TABLE attachment_routing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY routing_rules_owner ON attachment_routing_rules
  FOR ALL USING (user_id = auth.uid() OR auth.role() = 'service_role');

-- Add FK for routing_rule_id
ALTER TABLE email_attachments
  ADD CONSTRAINT email_attachments_routing_rule_fkey
    FOREIGN KEY (routing_rule_id)
    REFERENCES attachment_routing_rules(id)
    ON DELETE SET NULL;

-- Create drive_folder_cache
CREATE TABLE public.drive_folder_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  path_template text NOT NULL,
  resolved_path text NOT NULL,
  folder_id text NOT NULL,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  last_verified_at timestamptz DEFAULT now(),
  exists boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, resolved_path)
);

CREATE INDEX idx_drive_cache_user_project ON drive_folder_cache(user_id, project_id) WHERE project_id IS NOT NULL;

ALTER TABLE drive_folder_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY drive_cache_owner ON drive_folder_cache
  FOR ALL USING (user_id = auth.uid() OR auth.role() = 'service_role');
```

---

## Backend Implementation

### Worker Changes

#### 1. Thread-Aware Gmail Ingestion

**File:** `worker/src/index.ts` (modify `processGmailAccount`)

**Key changes:**

```typescript
// Before processing messages, fetch full thread
const threadRes = await gmail.users.threads.get({
  userId: 'me',
  id: msg.threadId!,
  format: 'metadata',
  metadataHeaders: ['Subject', 'From', 'To', 'Cc', 'Date', 'In-Reply-To', 'References'],
});

// Upsert thread record
const thread = await upsertEmailThread(
  supabase,
  account.userId,
  threadRes.data,
  {
    gmail,
    priorityConfig,
  }
);

// For each message in thread, link to thread.id
payloadToUpsert.thread_id = thread.id;
payloadToUpsert.gmail_thread_id = msg.threadId;
payloadToUpsert.message_index = calculateMessageIndex(threadRes.data.messages, msg.id);
payloadToUpsert.in_reply_to = getHeader('In-Reply-To');
payloadToUpsert.references = parseReferencesHeader(getHeader('References'));

// After upserting all messages, call thread summarization
if (shouldSummarizeThread(thread)) {
  await summarizeThread(supabase, thread.id, { openaiApiKey: process.env.OPENAI_API_KEY });
}

// Process attachments
await processEmailAttachments(gmail, msgRes.data, { id: msg.id, userId: account.userId, threadId: thread.id }, supabase);
```

#### 2. Thread Summarization

**File:** `shared/src/analyzeThread.ts` (new)

```typescript
export async function analyzeThread(
  input: ThreadAnalysisInput,
  openaiApiKey: string
): Promise<ThreadAnalysisResult> {
  const mode = input.priorSummary ? 'incremental' : 'full';

  const systemMessage = buildThreadAnalysisSystemPrompt(mode);
  const userPayload = buildThreadAnalysisUserPayload(input, mode);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: input.messages.length > 10 ? 'gpt-4o' : 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI thread analysis failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const parsed = JSON.parse(content);

  return {
    summary: parsed.summary,
    keyPoints: mode === 'incremental'
      ? [...(input.priorSummary?.keyPoints || []), ...(parsed.newKeyPoints || [])]
      : parsed.keyPoints,
    outstandingQuestions: mode === 'incremental'
      ? (input.priorSummary?.outstandingQuestions || [])
          .filter(q => !parsed.resolvedQuestions?.includes(q))
          .concat(parsed.newQuestions || [])
      : parsed.outstandingQuestions,
    deadlines: parsed.deadlines || [],
    sentiment: normaliseEmailSentiment(parsed.sentiment),
    nextAction: parsed.nextAction || null,
    attachmentsOfInterest: parsed.attachmentsOfInterest || [],
  };
}
```

**Worker job:** `worker/src/threadSummarizationJob.ts`

```typescript
export async function summarizeThread(
  supabase: SupabaseClient,
  threadId: string,
  options: { openaiApiKey: string }
): Promise<void> {
  // Load thread + messages
  const { data: thread } = await supabase
    .from('email_threads')
    .select('*, emails(*)')
    .eq('id', threadId)
    .single();

  if (!thread) throw new Error(`Thread ${threadId} not found`);

  const messages = thread.emails
    .sort((a, b) => a.message_index - b.message_index)
    .map(e => ({
      id: e.id,
      subject: e.subject,
      from: { name: e.from_name, email: e.from_email },
      to: [], // TODO: parse To header
      receivedAt: e.received_at,
      body: e.body || e.summary,  // Fallback to summary if body not stored
      messageIndex: e.message_index,
    }));

  // Determine if incremental
  const priorSummary = thread.rolling_summary;
  const lastSummarizedMessageIndex = priorSummary?.lastMessageIndex ?? -1;
  const newMessages = messages.filter(m => m.messageIndex > lastSummarizedMessageIndex);

  if (newMessages.length === 0) return;

  const input: ThreadAnalysisInput = {
    threadId,
    messages: newMessages.length < 10 ? messages : newMessages,
    priorSummary,
  };

  const result = await analyzeThread(input, options.openaiApiKey);

  // Update thread
  await supabase
    .from('email_threads')
    .update({
      rolling_summary: {
        summary: result.summary,
        keyPoints: result.keyPoints,
        outstandingQuestions: result.outstandingQuestions,
        deadlines: result.deadlines,
        nextAction: result.nextAction,
        lastMessageIndex: messages[messages.length - 1].messageIndex,
      },
      last_summarized_at: new Date().toISOString(),
    })
    .eq('id', threadId);
}
```

#### 3. Attachment Processing

**File:** `worker/src/attachmentJobs.ts` (new)

See [Attachment Routing Flow](#attachment-routing-flow) section for full implementation.

**Key functions:**
- `processEmailAttachments(gmail, message, emailContext, supabase)` – Download and create records
- `routeAttachmentToDrive(attachmentId, userId, emailContext, buffer, supabase)` – Evaluate rules and upload
- `getOrCreateDriveFolder(userId, path, createIfMissing, supabase)` – Resolve folder
- `evaluateRuleConditions(conditions, context)` – Match rule criteria

**Idempotency:**
- Check `email_attachments.gmail_part_id` before downloading
- Check `drive_file_id` before uploading
- Use MD5 de-duplication

**Error handling:**
- Store errors in `email_attachments.error` column
- Retry with exponential backoff (max 3 attempts)
- Surface errors in UI for manual retry

### API Routes

#### 1. Thread Listing

**File:** `app/app/api/threads/route.ts` (new, Node runtime)

```typescript
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1');
  const perPage = parseInt(searchParams.get('perPage') || '20');
  const label = searchParams.get('label') || 'all';
  const projectId = searchParams.get('projectId') || null;

  const supabase = createServerSupabaseClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let query = supabase
    .from('email_threads')
    .select('*, emails(count)', { count: 'exact' })
    .eq('user_id', user.id)
    .order('last_message_at', { ascending: false });

  if (label !== 'all') {
    query = query.contains('labels', [label]);
  }

  if (projectId) {
    query = query.contains('project_ids', [projectId]);
  }

  const { data: threads, error, count } = await query
    .range((page - 1) * perPage, page * perPage - 1);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    threads,
    pagination: {
      page,
      perPage,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / perPage),
    },
  });
}
```

#### 2. Thread Detail

**File:** `app/app/api/threads/[threadId]/route.ts` (new, Node runtime)

```typescript
export async function GET(req: Request, { params }: { params: { threadId: string } }) {
  const supabase = createServerSupabaseClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: thread, error } = await supabase
    .from('email_threads')
    .select(`
      *,
      emails (
        *,
        attachments:email_attachments(*)
      )
    `)
    .eq('id', params.threadId)
    .eq('user_id', user.id)
    .single();

  if (error || !thread) return Response.json({ error: 'Thread not found' }, { status: 404 });

  // Sort messages by message_index
  thread.emails.sort((a, b) => a.message_index - b.message_index);

  return Response.json({ thread });
}
```

#### 3. Attachment Routing Rules

**File:** `app/app/api/attachment-rules/route.ts` (new, Node runtime)

```typescript
export async function GET(req: Request) {
  const supabase = createServerSupabaseClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rules, error } = await supabase
    .from('attachment_routing_rules')
    .select('*')
    .eq('user_id', user.id)
    .order('priority', { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rules });
}

export async function POST(req: Request) {
  const supabase = createServerSupabaseClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { name, description, enabled, priority, conditions, actions } = body;

  const { data: rule, error } = await supabase
    .from('attachment_routing_rules')
    .insert({
      user_id: user.id,
      name,
      description,
      enabled,
      priority,
      conditions,
      actions,
    })
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rule });
}
```

**Similar routes:**
- `PATCH /api/attachment-rules/[ruleId]` – Update rule
- `DELETE /api/attachment-rules/[ruleId]` – Delete rule
- `POST /api/attachment-rules/[ruleId]/test` – Dry-run rule on existing emails

#### 4. Attachment Actions

**File:** `app/app/api/attachments/[attachmentId]/route.ts` (new, Node runtime)

```typescript
export async function POST(req: Request, { params }: { params: { attachmentId: string } }) {
  const supabase = createServerSupabaseClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { action, targetFolderId } = await req.json();

  if (action === 'retry-routing') {
    // Enqueue background job to re-route attachment
    await enqueueAttachmentRouting(params.attachmentId, user.id);
    return Response.json({ success: true });
  }

  if (action === 'move-to-folder') {
    // Manual override: move attachment to specific Drive folder
    const { data: attachment } = await supabase
      .from('email_attachments')
      .select('drive_file_id')
      .eq('id', params.attachmentId)
      .single();

    if (!attachment?.drive_file_id) {
      return Response.json({ error: 'Attachment not yet uploaded' }, { status: 400 });
    }

    const driveClient = await getDriveClientForUser(user.id, supabase);
    await driveClient.files.update({
      fileId: attachment.drive_file_id,
      addParents: targetFolderId,
      removeParents: 'previous-parent-id',  // TODO: track current parent
    });

    return Response.json({ success: true });
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 });
}
```

---

## Frontend Implementation

### UI Components

#### 1. Thread-First Inbox

**File:** `app/components/ThreadInbox.tsx` (new)

**Features:**
- List threads (not individual emails)
- Show thread preview: subject, participants, last message snippet, message count, unread badge
- Collapse/expand to show all messages in thread
- Thread-level actions: Mark done, Snooze, Open in Gmail, Link to project
- Filter by label, project, date range
- Sort by last activity, priority, unread count

**Component structure:**

```tsx
export function ThreadInbox() {
  const [threads, setThreads] = useState<ThreadRecord[]>([]);
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ label: 'all', projectId: null });

  // Fetch threads on mount/filter change
  useEffect(() => {
    fetchThreads(filters).then(setThreads);
  }, [filters]);

  return (
    <div>
      <ThreadFilters filters={filters} onChange={setFilters} />

      {threads.map(thread => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          expanded={expandedThreadId === thread.id}
          onToggle={() => setExpandedThreadId(expandedThreadId === thread.id ? null : thread.id)}
          onAction={(action) => handleThreadAction(thread, action)}
        />
      ))}
    </div>
  );
}

function ThreadCard({ thread, expanded, onToggle, onAction }) {
  return (
    <div className="border rounded p-4">
      <div className="flex justify-between items-start">
        <div className="flex-1" onClick={onToggle}>
          <h3 className="font-semibold">{thread.subject_canonical}</h3>
          <p className="text-sm text-gray-600">
            {thread.participants.map(p => p.name || p.email).join(', ')}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {thread.message_count} messages · Last: {formatRelativeTime(thread.last_message_at)}
          </p>
        </div>

        <div className="flex gap-2">
          <PriorityBadge score={thread.priority_score} />
          {thread.unread_count > 0 && (
            <span className="bg-blue-500 text-white rounded-full px-2 py-1 text-xs">
              {thread.unread_count} new
            </span>
          )}
        </div>
      </div>

      {/* Rolling summary */}
      {thread.rolling_summary?.summary && (
        <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
          <strong>Summary:</strong> {thread.rolling_summary.summary}

          {thread.rolling_summary.outstandingQuestions?.length > 0 && (
            <div className="mt-2">
              <strong>Outstanding:</strong>
              <ul className="list-disc ml-5">
                {thread.rolling_summary.outstandingQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Expand to show messages */}
      {expanded && (
        <div className="mt-4 space-y-3">
          {thread.emails.map(email => (
            <MessageCard key={email.id} message={email} />
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        <button onClick={() => onAction('mark-done')}>Mark Done</button>
        <button onClick={() => onAction('snooze')}>Snooze</button>
        <button onClick={() => onAction('open-gmail')}>Open in Gmail</button>
        <button onClick={() => onAction('link-project')}>Link to Project</button>
      </div>
    </div>
  );
}

function MessageCard({ message }) {
  return (
    <div className="border-l-2 border-gray-300 pl-4">
      <div className="flex justify-between">
        <div>
          <strong>{message.from_name || message.from_email}</strong>
          <span className="text-xs text-gray-500 ml-2">
            {formatRelativeTime(message.received_at)}
          </span>
        </div>
        <span className="text-xs text-gray-500">{message.category}</span>
      </div>

      <p className="text-sm mt-2">{message.summary || message.body?.slice(0, 200)}</p>

      {message.attachments?.length > 0 && (
        <div className="mt-2">
          <AttachmentList attachments={message.attachments} />
        </div>
      )}
    </div>
  );
}
```

#### 2. Attachment List & Actions

**File:** `app/components/AttachmentList.tsx` (new)

```tsx
interface AttachmentListProps {
  attachments: EmailAttachmentRecord[];
  onAction?: (attachment: EmailAttachmentRecord, action: string) => void;
}

export function AttachmentList({ attachments, onAction }: AttachmentListProps) {
  return (
    <div className="space-y-2">
      {attachments.map(att => (
        <div key={att.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
          <div className="flex items-center gap-3">
            <FileIcon mimeType={att.mime_type} />
            <div>
              <p className="font-medium text-sm">{att.filename}</p>
              <p className="text-xs text-gray-500">
                {formatFileSize(att.size)} · {att.mime_type}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {att.drive_file_id ? (
              <>
                <a
                  href={att.drive_web_view_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-sm"
                >
                  Open in Drive
                </a>
                <span className="text-xs text-green-600">✓ Saved</span>
              </>
            ) : att.error ? (
              <>
                <span className="text-xs text-red-600">Failed: {att.error}</span>
                <button
                  onClick={() => onAction?.(att, 'retry')}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Retry
                </button>
              </>
            ) : (
              <span className="text-xs text-gray-500">Processing...</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

#### 3. Home Dashboard: Inbox Snapshot (Thread Preview)

**File:** `app/components/home/dashboard-cards/InboxSnapshotCard.tsx` (modify)

**Changes:**
- Fetch threads instead of individual emails
- Show thread count, unread threads
- Display top 5 threads by priority
- Click to navigate to `/inbox?threadId={id}` (auto-expand)

```tsx
export function InboxSnapshotCard({ threads, loading, error }: InboxSnapshotCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbox Snapshot</CardTitle>
        <p className="text-sm text-gray-600">{threads.length} active threads</p>
      </CardHeader>
      <CardContent>
        {threads.slice(0, 5).map(thread => (
          <Link key={thread.id} href={`/inbox?threadId=${thread.id}`}>
            <div className="flex justify-between items-center p-3 hover:bg-gray-50 rounded">
              <div className="flex-1">
                <p className="font-medium text-sm">{thread.subject_canonical}</p>
                <p className="text-xs text-gray-500">
                  {thread.message_count} msgs · Last: {formatRelativeTime(thread.last_message_at)}
                </p>
              </div>
              <PriorityBadge score={thread.priority_score} />
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
```

#### 4. Attachment Routing Rules Settings

**File:** `app/app/(protected)/settings/attachment-rules/page.tsx` (new)

**Features:**
- List all rules with enabled/disabled toggle
- Reorder rules by priority (drag-and-drop)
- Create/edit rule modal:
  - **Conditions builder**: Sender domain, labels, MIME type, filename pattern, project
  - **Actions builder**: Folder template with token picker, filename template, share options, de-duplication strategy
  - **Test rule**: Select existing emails/attachments to preview matches
- Delete rule with confirmation
- "Apply to existing" button: re-process past attachments with new rules

```tsx
export default function AttachmentRulesPage() {
  const [rules, setRules] = useState<AttachmentRoutingRule[]>([]);
  const [editingRule, setEditingRule] = useState<AttachmentRoutingRule | null>(null);

  useEffect(() => {
    fetchAttachmentRules().then(setRules);
  }, []);

  const handleSaveRule = async (rule: AttachmentRoutingRule) => {
    if (rule.id) {
      await updateAttachmentRule(rule.id, rule);
    } else {
      await createAttachmentRule(rule);
    }
    setRules(await fetchAttachmentRules());
    setEditingRule(null);
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Attachment Routing Rules</h1>

      <button onClick={() => setEditingRule({ /* new rule template */ })}>
        + New Rule
      </button>

      <DndContext onDragEnd={handleReorder}>
        <SortableContext items={rules} strategy={verticalListSortingStrategy}>
          {rules.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={() => setEditingRule(rule)}
              onDelete={() => handleDeleteRule(rule.id)}
              onToggle={() => handleToggleRule(rule.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {editingRule && (
        <RuleEditorModal
          rule={editingRule}
          onSave={handleSaveRule}
          onCancel={() => setEditingRule(null)}
        />
      )}
    </div>
  );
}

function RuleCard({ rule, onEdit, onDelete, onToggle }) {
  return (
    <div className="border p-4 rounded mb-3">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-semibold">{rule.name}</h3>
          <p className="text-sm text-gray-600">{rule.description}</p>

          <div className="mt-2 text-xs">
            <strong>Conditions:</strong> {summarizeConditions(rule.conditions)}
            <br />
            <strong>Actions:</strong> Save to {rule.actions.driveFolderTemplate}
          </div>
        </div>

        <div className="flex gap-2">
          <Toggle checked={rule.enabled} onChange={onToggle} />
          <button onClick={onEdit}>Edit</button>
          <button onClick={onDelete} className="text-red-600">Delete</button>
        </div>
      </div>
    </div>
  );
}
```

**Rule Editor Modal:**

```tsx
function RuleEditorModal({ rule, onSave, onCancel }) {
  const [name, setName] = useState(rule.name || '');
  const [conditions, setConditions] = useState(rule.conditions || {});
  const [actions, setActions] = useState(rule.actions || {});

  return (
    <Modal onClose={onCancel}>
      <h2 className="text-xl font-bold mb-4">
        {rule.id ? 'Edit Rule' : 'New Rule'}
      </h2>

      <label>
        Rule Name
        <input value={name} onChange={e => setName(e.target.value)} />
      </label>

      <h3 className="font-semibold mt-4">Conditions (all must match)</h3>
      <ConditionsBuilder conditions={conditions} onChange={setConditions} />

      <h3 className="font-semibold mt-4">Actions</h3>
      <ActionsBuilder actions={actions} onChange={setActions} />

      <div className="mt-6 flex gap-3">
        <button onClick={() => onSave({ ...rule, name, conditions, actions })}>
          Save Rule
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

function ConditionsBuilder({ conditions, onChange }) {
  return (
    <div className="space-y-3">
      <label>
        Sender Domains (comma-separated)
        <input
          value={conditions.senderDomains?.join(', ') || ''}
          onChange={e => onChange({ ...conditions, senderDomains: e.target.value.split(',').map(s => s.trim()) })}
        />
      </label>

      <label>
        Thread Labels
        <MultiSelect
          options={EMAIL_LABELS}
          selected={conditions.threadLabels || []}
          onChange={labels => onChange({ ...conditions, threadLabels: labels })}
        />
      </label>

      <label>
        MIME Types
        <input
          placeholder="e.g., application/pdf, image/*"
          value={conditions.mimeTypes?.join(', ') || ''}
          onChange={e => onChange({ ...conditions, mimeTypes: e.target.value.split(',').map(s => s.trim()) })}
        />
      </label>

      <label>
        Filename Patterns (glob)
        <input
          placeholder="e.g., *.pdf, contract_*.docx"
          value={conditions.filenamePatterns?.join(', ') || ''}
          onChange={e => onChange({ ...conditions, filenamePatterns: e.target.value.split(',').map(s => s.trim()) })}
        />
      </label>

      {/* Add more condition fields as needed */}
    </div>
  );
}

function ActionsBuilder({ actions, onChange }) {
  return (
    <div className="space-y-3">
      <label>
        Drive Folder Template
        <div className="flex gap-2">
          <input
            value={actions.driveFolderTemplate || ''}
            onChange={e => onChange({ ...actions, driveFolderTemplate: e.target.value })}
            placeholder="Kazador/{project.slug}/Contracts/{yyyy}"
          />
          <TokenPicker onSelect={token => onChange({ ...actions, driveFolderTemplate: (actions.driveFolderTemplate || '') + token })} />
        </div>
      </label>

      <label>
        Filename Template
        <input
          value={actions.filenameTemplate || '{original_filename}'}
          onChange={e => onChange({ ...actions, filenameTemplate: e.target.value })}
          placeholder="{date}_{original_filename}"
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={actions.createMissingFolders ?? true}
          onChange={e => onChange({ ...actions, createMissingFolders: e.target.checked })}
        />
        Create missing folders
      </label>

      <label>
        <input
          type="checkbox"
          checked={actions.shareWithProjectMembers ?? false}
          onChange={e => onChange({ ...actions, shareWithProjectMembers: e.target.checked })}
        />
        Share with project members
      </label>

      <label>
        De-duplication Strategy
        <select
          value={actions.deduplicateBy || 'md5'}
          onChange={e => onChange({ ...actions, deduplicateBy: e.target.value })}
        >
          <option value="md5">By MD5 hash</option>
          <option value="filename">By filename</option>
          <option value="none">No de-duplication</option>
        </select>
      </label>
    </div>
  );
}
```

---

## User Configuration & Rules

### Settings UI

#### Location: `/settings/email`

**Tabs:**

1. **Threading**
   - Enable/disable thread grouping (default: ON)
   - Thread summarization frequency: Always / Only threads &gt; 5 messages / Manual
   - Include prior summary in incremental updates: Yes / No
   - Auto-collapse threads older than N days

2. **Attachments**
   - Enable attachment download: Yes / No (default: Yes)
   - Auto-route to Drive: Yes / No (default: Yes, if rules exist)
   - Default folder (if no rules match): `Kazador/Attachments/{yyyy}/{mm}`
   - De-duplication default: MD5 / Filename / None

3. **Routing Rules**
   - Link to `/settings/attachment-rules`
   - Quick templates: "Legal Contracts to Legal/{yyyy}", "Invoices to Finance/{project.slug}"

#### Pre-Built Rule Templates

| Template | Conditions | Actions |
|----------|-----------|---------|
| **Legal Contracts** | Labels contain `LEGAL/Contract_Draft`, MIME = `application/pdf` | Folder: `Kazador/{project.slug}/Legal/{yyyy}`, De-dupe by MD5 |
| **Invoices & Settlements** | Labels contain `FINANCE/Invoice` or `FINANCE/Settlement` | Folder: `Kazador/Finance/{label.primary}/{yyyy}-{mm}` |
| **Press Photos** | Labels contain `ASSETS/Photos`, MIME = `image/*` | Folder: `Kazador/{artist}/Press/{yyyy}`, Convert to Google Photos album (future) |
| **Technical Riders** | Labels contain `LOGISTICS/Technical_Advance`, filename contains `rider` | Folder: `Kazador/{project.slug}/Riders` |

**User flow:**
1. Navigate to `/settings/attachment-rules`
2. Click "+ New Rule" or "Use Template"
3. Select template → pre-fills conditions and actions
4. Customize folder paths, conditions
5. Save → rule added with priority 0 (highest)
6. Reorder rules by dragging
7. Test rule: Click "Test" → select sample emails → preview which attachments match

---

## Phased Implementation Plan

### Phase 1: Email Threading Foundation (Weeks 1-2)

**Goal:** Thread-aware ingestion and storage; no UI changes yet.

**Tasks:**
1. ✅ Create migration: `email_threads` table + extend `emails` with thread fields
2. ✅ Update `worker/src/index.ts`:
   - Fetch full thread via Gmail API
   - Upsert `email_threads` record
   - Link messages to `thread_id`
   - Extract `in_reply_to`, `references`, `message_index`
3. ✅ Add thread priority scoring function: `shared/src/threadPriority.ts`
4. ✅ Backfill existing emails:
   - Worker job: group by `subject` + participant similarity → infer threads
   - Assign `message_index` by `received_at`

**Success criteria:**
- All new emails linked to threads
- `email_threads` table populated
- Priority scores calculated

### Phase 2: Thread Summarization (Weeks 3-4)

**Goal:** AI-powered thread summaries with incremental updates.

**Tasks:**
1. ✅ Implement `shared/src/analyzeThread.ts` with full + incremental modes
2. ✅ Add worker job: `worker/src/threadSummarizationJob.ts`
3. ✅ Trigger summarization:
   - After thread upsert (if message_count ≤ 10)
   - On-demand via API: `POST /api/threads/[threadId]/summarize`
4. ✅ Store results in `email_threads.rolling_summary`
5. ✅ Test with 10-20 sample threads

**Success criteria:**
- Summaries generated for threads with &gt; 1 message
- Incremental updates preserve prior context
- Summaries visible in DB (UI not required yet)

### Phase 3: Thread UI (Weeks 5-6)

**Goal:** Thread-first inbox with collapse/expand.

**Tasks:**
1. ✅ Build `app/components/ThreadInbox.tsx`
2. ✅ Add API routes:
   - `GET /api/threads` (list with filters)
   - `GET /api/threads/[threadId]` (detail with messages)
3. ✅ Modify `/inbox` page to use `ThreadInbox` component
4. ✅ Add thread actions: Mark done, Snooze, Link to project
5. ✅ Update `InboxSnapshotCard` in home dashboard to show threads

**Success criteria:**
- Inbox shows threads grouped correctly
- Expand thread to see all messages
- Rolling summary displayed
- Filters (label, project) work

### Phase 4: Attachment Download & Storage (Weeks 7-8)

**Goal:** Download Gmail attachments and populate `email_attachments` table.

**Tasks:**
1. ✅ Extend `email_attachments` schema with Drive fields
2. ✅ Implement `worker/src/attachmentJobs.ts`:
   - Extract attachment parts from Gmail message
   - Download via `gmail.users.messages.attachments.get`
   - Compute MD5 and SHA256
   - Upsert `email_attachments` record
3. ✅ Hook into `processGmailAccount` after email upsert
4. ✅ Test with sample emails containing PDFs, images, etc.

**Success criteria:**
- Attachments downloaded and stored in `email_attachments`
- MD5 hashes populated
- No duplicate downloads (idempotency via `gmail_part_id`)

### Phase 5: Attachment Routing Rules (Weeks 9-10)

**Goal:** User-configurable rules to route attachments to Drive.

**Tasks:**
1. ✅ Create `attachment_routing_rules` table
2. ✅ Implement rule evaluation logic: `evaluateRuleConditions`
3. ✅ Build `routeAttachmentToDrive` function
4. ✅ Implement folder template resolution + caching (`drive_folder_cache`)
5. ✅ Add API routes: `/api/attachment-rules` (CRUD)
6. ✅ Test with 2-3 sample rules

**Success criteria:**
- Rules stored in DB
- Attachments routed to correct Drive folders
- Folder cache prevents repeated lookups
- De-duplication by MD5 works

### Phase 6: Routing Rules UI (Weeks 11-12)

**Goal:** Settings page for creating and managing rules.

**Tasks:**
1. ✅ Build `/settings/attachment-rules` page
2. ✅ Implement `RuleEditorModal` with conditions + actions builders
3. ✅ Add token picker for folder templates
4. ✅ Implement rule reordering (drag-and-drop)
5. ✅ Add "Test rule" preview modal
6. ✅ Ship pre-built templates

**Success criteria:**
- Users can create, edit, delete rules via UI
- Folder templates with tokens work
- Test rule shows matched attachments
- Templates reduce friction for common cases

### Phase 7: Attachment UI & Actions (Week 13)

**Goal:** Show attachments in inbox; enable manual actions.

**Tasks:**
1. ✅ Build `app/components/AttachmentList.tsx`
2. ✅ Integrate into `MessageCard` (inside thread view)
3. ✅ Add attachment actions:
   - "Open in Drive"
   - "Retry routing" (if failed)
   - "Move to folder" (manual override)
4. ✅ Show routing status: Saved / Processing / Failed

**Success criteria:**
- Attachments visible in thread view
- Drive links work
- Retry button re-triggers routing
- Failed attachments surfaced with error message

### Phase 8: Polish & Optimization (Week 14)

**Goal:** Performance, error handling, and UX refinements.

**Tasks:**
1. ✅ Optimize thread listing query (pagination, indexes)
2. ✅ Add error monitoring for attachment jobs
3. ✅ Implement retry logic with exponential backoff
4. ✅ Add "Apply to existing attachments" bulk job
5. ✅ User documentation: How to set up rules, folder templates
6. ✅ A/B test: Thread UI vs. flat inbox (opt-in toggle)

**Success criteria:**
- Inbox loads in &lt; 2s for 1000+ threads
- Attachment failures logged and surfaced
- Bulk re-processing completes without errors
- User guide published

---

## Risk Analysis & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| **Gmail API quota limits** | Worker fails; attachments not downloaded | Medium | Batch downloads; exponential backoff; user quotas if needed |
| **Drive API rate limits** | Uploads fail; folder creation blocked | Medium | Cache folder IDs; queue uploads with concurrency limits |
| **Large attachments (>25MB)** | Download timeouts; storage costs | Low | Skip attachments >25MB; offer manual download link |
| **Thread misidentification** | Messages grouped incorrectly | Low | Use Gmail `threadId` (canonical); fallback to subject+participants |
| **AI summarization costs** | High OpenAI spend for long threads | Medium | Use cheaper model (gpt-4o-mini); cap thread length to 10 messages; incremental updates |
| **User deletes Drive folder** | Cached folder ID stale; uploads fail | Low | Verify folder existence before upload; invalidate cache on 404 |
| **Duplicate attachments across projects** | Storage waste | Low | De-duplicate by MD5 globally; link same file to multiple projects |
| **Rule conflicts** | Multiple rules match same attachment | Medium | First match wins; clear priority ordering in UI |
| **Migration breaks existing emails** | Data loss; downtime | Low | Test migrations on staging DB; add rollback plan; keep backups |
| **Thread summaries expose sensitive data** | Privacy breach if shared | Medium | Respect confidential flags; add RLS; warn users before sharing |

---

## Appendix

### Glossary

| Term | Definition |
|------|-----------|
| **Thread** | A collection of related email messages sharing a Gmail `threadId` |
| **Rolling Summary** | AI-generated summary that updates incrementally as new messages arrive |
| **Routing Rule** | User-defined condition + action pair for attachment filing |
| **Folder Template** | Path pattern with tokens (e.g., `{project.slug}`) resolved at runtime |
| **Drive Folder Cache** | DB table storing resolved folder IDs to avoid repeated Drive API lookups |
| **De-duplication** | Strategy to avoid storing the same attachment multiple times (by MD5, filename, etc.) |

### References

- [Gmail API Threads](https://developers.google.com/gmail/api/guides/threads)
- [Gmail API Attachments](https://developers.google.com/gmail/api/reference/rest/v1/users.messages.attachments)
- [Google Drive API Files](https://developers.google.com/drive/api/v3/reference/files)
- [OpenAI JSON Mode](https://platform.openai.com/docs/guides/json-mode)

### Open Questions

1. **Should we store full email bodies in DB?**
   - Pro: Faster thread summarization (no Gmail API call)
   - Con: Storage costs, privacy concerns
   - **Decision:** Store summaries only; fetch bodies on-demand for full view

2. **How to handle attachments already in Drive (linked in email body)?**
   - Option A: Parse Drive links from body, copy to project folder
   - Option B: Create asset_link without downloading
   - **Decision:** Option B for MVP; Option A as future enhancement

3. **Should attachment rules support regex or only glob patterns?**
   - **Decision:** Glob for simplicity; add regex if users request it

4. **How to handle thread splits (e.g., "Re: [New Subject]")?**
   - Gmail handles this; trust `threadId`
   - If user reports issue, investigate Gmail API behavior

---

## Implementation Checklist

- [ ] Phase 1: Email threading foundation
  - [ ] Migration: `email_threads` table
  - [ ] Worker: fetch threads, upsert records
  - [ ] Backfill existing emails
- [ ] Phase 2: Thread summarization
  - [ ] `analyzeThread` function
  - [ ] Worker summarization job
  - [ ] API: trigger summarization
- [ ] Phase 3: Thread UI
  - [ ] `ThreadInbox` component
  - [ ] API routes: `/api/threads`
  - [ ] Update home dashboard
- [ ] Phase 4: Attachment download
  - [ ] Schema: extend `email_attachments`
  - [ ] Worker: download + store
  - [ ] Idempotency checks
- [ ] Phase 5: Routing rules
  - [ ] Schema: `attachment_routing_rules`
  - [ ] Rule evaluation logic
  - [ ] Folder resolution + caching
- [ ] Phase 6: Routing UI
  - [ ] Settings page: `/settings/attachment-rules`
  - [ ] Rule editor modal
  - [ ] Pre-built templates
- [ ] Phase 7: Attachment UI
  - [ ] `AttachmentList` component
  - [ ] Attachment actions (retry, move)
  - [ ] Show status in thread view
- [ ] Phase 8: Polish
  - [ ] Performance optimization
  - [ ] Error handling + retry
  - [ ] Bulk re-processing job
  - [ ] User documentation

---

**End of Implementation Plan**

This document serves as the single source of truth for implementing email threading and attachment handling in Kazador. All team members (human or AI) should refer to this plan when working on related features.
