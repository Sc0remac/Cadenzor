# Cadenzor – AI Artist Management Platform

## Overview

**Cadenzor** is an AI-powered operational platform for artist management that transforms unstructured communications (email, meetings, voice notes) into a structured, timeline-first workspace. It automates email triage, surfaces critical actions through a Priority Engine, and enables managers to orchestrate complex touring, promotion, legal, and finance workflows with human-in-the-loop approval guardrails.

Built for artist managers like Oran who juggle dozens of shows, contracts, promo requests, and logistics across multiple artists and territories, Cadenzor replaces spreadsheet chaos with an intelligent, collaborative hub.

---

## Product Vision

Cadenzor turns the flood of emails, attachments, and meetings into a single source of truth:

- **Timeline Studio** – Multi-lane visual workspace showing Live, Promo, Writing, Brand, and Release operations with dependencies, conflicts, and travel buffers.
- **Priority Engine** – Scores tasks, emails, and timeline items by urgency, impact, dependencies, and proximity to events—no more rigid T-7/T-2 rules.
- **Project Hubs** – Self-contained contexts (e.g., "Asian Tour 2026") with scoped timelines, tasks, files, approvals, and metrics.
- **Playbooks** – Deterministic automation recipes that draft replies, propose calendar holds, file documents, and create tasks—always with approval gates for sensitive actions.
- **Today Digest** – Morning summary of top priorities, new leads, pending approvals, and project health across the entire workspace.

**Non-goals (MVP):** No auto-sending of legal/finance emails; no unapproved calendar confirmations; no public partner portal.

---

## Core Features

### 1. Email Triage & Classification

**What it does:**
- Connects to Gmail and classifies unread messages using a detailed taxonomy covering legal, finance, logistics, booking, promo, assets, and fan mail.
- Extracts entities (artist, venue, city, dates, fees) and enriches contact records.
- Applies Gmail labels (e.g., `Cadenzor/LEGAL/Contract_Draft`, `Cadenzor/artist/Barry_Cant_Swim`) for in-inbox visibility.
- Stores summaries, labels, and priority scores in Supabase.

**Primary labels** (one required per email):
- **LEGAL** – Contract_Draft, Contract_Executed, Addendum_or_Amendment, NDA_or_Clearance, Insurance_Indemnity, Compliance
- **FINANCE** – Settlement, Invoice, Payment_Remittance, Banking_Details, Tax_Docs, Expenses_Receipts, Royalties_Publishing
- **LOGISTICS** – Itinerary_DaySheet, Travel, Accommodation, Ground_Transport, Visas_Immigration, Technical_Advance, Passes_Access
- **BOOKING** – Offer, Hold_or_Availability, Confirmation, Reschedule_or_Cancel
- **PROMO** – Promo_Time_Request, Press_Feature, Radio_Playlist, Deliverables, Promos_Submission
- **ASSETS** – Artwork, Audio, Video, Photos, Logos_Brand, EPK_OneSheet
- **FAN** – Support_or_Thanks, Request, Issues_or_Safety
- **MISC** – Uncategorized

**Cross-tag prefixes** (optional, applied alongside primary labels):
- `artist/{name}`, `project/{slug}`, `territory/{ISO2}`, `city/{name}`, `venue/{name}`, `date/{YYYY-MM-DD}`, `tz/{IANA}`, `approval/{type}`, `confidential/{flag}`, `status/{state}`, `assettype/{kind}`, `risk/{flag}`

**Implementation:**
- Worker: `worker/src/index.ts`, `worker/src/classifyEmail.ts`
- AI analysis: `shared/src/analyzeEmail.ts` (OpenAI with retry/backoff)
- Heuristic fallback: `shared/src/heuristicLabels.ts`
- Dashboard: `app/components/EmailDashboard.tsx`
- API: `app/app/api/email-stats/route.ts`, `app/app/api/emails/route.ts`, `app/app/api/classify-emails/route.ts`

### 2. Project Hubs (Workspace Isolation + Context Graph)

**What it does:**
- Creates top-level project containers (e.g., "Asian Tour 2026", "Barry Cant Swim – SHEE Release") that own timelines, tasks, files, and emails while sharing a global data graph.
- Enables deliberate linking of Drive folders, email threads, and calendar events to projects.
- Derives labels from connected sources (e.g., folder path `/JP/` → `territory=JP`).
- Suggests email-to-project attachments when confidence is high (venue/city/date match, thread participants, folder mentions).

**Project Hub tabs:**
- **Overview** – Summary, KPIs, top priorities (from Priority Engine), upcoming key dates, progress bars
- **Timeline** – Scoped multi-lane view with dependencies, conflicts, holds, and milestones
- **Inbox** – Emails linked to this project plus AI suggestions
- **Tasks** – To-dos with statuses, assignees, and due dates
- **Files & Assets** – Connected Drive folders, canonical assets (logos, EPK), asset links
- **People** – Contacts and orgs most active in this project
- **Approvals** – Pending approvals for email links, timeline items, label suggestions
- **Settings** – Labels/metadata, color, date range, templates, sources

**Templates:**
Creating a project from a template (e.g., "Tour Leg", "Single Release", "Festival Weekend") seeds standard timeline items, dependencies, and checklists.

**Implementation:**
- API: `app/app/api/projects/route.ts`, `app/app/api/project-templates/route.ts`
- Components: `app/components/projects/ProjectCard.tsx`, `app/components/projects/ProjectCreateDialog.tsx`
- Project Hub: `app/app/(protected)/projects/[projectId]/page.tsx`
- Timeline Studio: `app/components/projects/TimelineStudio.tsx`
- Files: `app/components/projects/FilesTab.tsx`
- Suggestions: `shared/src/projectSuggestions.ts`, `app/app/api/projects/suggestions/email/route.ts`
- Worker jobs: `worker/src/projectJobs.ts` (computes metrics, suggestions, approvals)

### 3. Timeline Studio

**What it does:**
- Multi-lane visual timeline per artist with lanes for **Live, Promo, Writing, Brand/Partnerships, Release-ops**.
- Supports item types: events (shows, interviews), milestones (deliver artwork), tasks, holds, offers/leads, release gates (upload draft, publish, send-out).
- Models dependencies: finish-to-start (FS), start-to-start (SS); visualizes blockers; detects circular dependencies.
- Conflict detection: flags calendar overlaps, travel feasibility issues (configurable buffer windows), and territory jumps.
- Priority computation: Priority Engine scores items by urgency × impact × confidence × dependencies × calendar proximity.
- Views: filter by category, territory, date range (next 7/14/30 days), per project/release, per contact/org.
- Versioning & snapshots: capture timeline state for sharing or historical comparison; diff two snapshots.
- Sharing: generate read-only links or export to Google Doc/Sheet.

**Implementation:**
- Component: `app/components/projects/TimelineStudio.tsx`
- Conflict detection: `shared/src/timelineConflicts.ts`
- Priority scoring: `shared/src/projectPriority.ts`
- Database: `timeline_items`, `timeline_dependencies` tables (see schema)

### 4. Priority Engine & Today Digest

**What it does:**
- Replaces rigid T-7/T-2 risk horizons with a flexible scoring algorithm.
- **Inputs:** due date, event start, dependency chain (blocking others?), impact (user-set weight per item type), confidence (classification certainty), calendar density (overlaps), SLA targets, user pins/snoozes.
- **Output:** priority score (0–100) + rationale.
- **Behavior:** Top actions bubble up on dashboard and timeline views; snoozing or completing updates score in real time.
- **Config:** per-artist weights and rules; quick presets (Travel-heavy Week, Release Week, Touring Off-Week).

**Today Digest (08:00 Europe/London):**
- Priority summary for the day; new leads; holds awaiting approval; yesterday's meeting outcomes; release updates.
- Optional Telegram TL;DR with Approve/Reject buttons (future).
- Web view at `/today` inside the Next.js app.
- Scheduled worker job: `npm --prefix worker run digest`.

**Implementation:**
- Priority Engine: `shared/src/projectPriority.ts`
- Digest job: `worker/src/digestJob.ts`
- Today Dashboard: `app/components/today/TodayDashboard.tsx`, `app/app/(protected)/today/page.tsx`
- API: `app/app/api/digests/route.ts`
- Database: `user_preferences`, `digests`, `action_logs` tables

### 5. Playbooks & Autopilot Policy

**What they are:**
Deterministic automation recipes with clear inputs/outputs and an autopilot policy (Auto / Draft-Only / Notify). Playbooks draft next steps for key labels (legal, settlements, logistics/promo) but never act alone on sensitive topics.

**Example Playbooks:**

| Playbook | Trigger | Actions | Policy |
|----------|---------|---------|--------|
| **Booking Enquiry** | BOOKING/Offer email | Extract venue/date/fee → enrich → brand-fit score → create lead → optional hold → folder scaffold → reply draft → add to timeline | Draft-Only |
| **Promo Time Request** | PROMO/Promo_Time_Request | Slot proposal (routing-aware) → tentative hold → press kit → reply draft → timeline item | Draft-Only (Auto later) |
| **Promos Submission** | PROMO/Promos_Submission | Capture links → listening queue → acknowledgement → optional listening tasks | Auto for ack; Draft-Only for personalized |
| **Logistics Update** | LOGISTICS/Itinerary_DaySheet | Parse itinerary/rider → update event/checklists → file docs → mark blockers | Draft-Only/Notify |
| **Assets Request** | ASSETS/* email | Attach canonical assets → reply draft → log distribution → timeline annotation | Auto if unambiguous |
| **Finance/Settlement** | FINANCE/Settlement | Extract amounts/due → reminders → timeline tasks | Draft-Only; legal/finance guardrails |
| **Meeting Ingest** | Zoom/Meet recording | Transcribe/summarise → tasks → file → attach to timeline | Auto ingest; Notify for sensitive |
| **Voice Memo** | Telegram voice note | Transcribe/normalise → task/note/doc → timeline/backlog | Auto |
| **Track Report Builder** | New assets in Drive | Build/refresh track report → update release lane | Auto |
| **SoundCloud Uploader** | ASSETS/Audio + release gate | Create private draft; metadata; approval to publish | Draft-Only; Auto for draft creation |
| **Promo Send-Out** | Release gate: Send-Outs | Generate list + drafts; throttle; add follow-ups to timeline | Draft-Only |
| **Promo Feedback Collector** | Replies to send-outs | Parse replies; update supporters/quotes; timeline annotations | Auto ingest |

**Guardrails:**
- Domain/keyword blacklists (legal/finance/confidential)
- Confidence thresholds
- Per-artist tone kits
- All outbound email: Draft-Only by default

**Implementation:**
- Approvals: `app/app/api/approvals/route.ts`, `app/lib/approvalActions.ts`
- Worker: `worker/src/projectJobs.ts` (queues approvals for suggestions)
- Database: `approvals` table with `type`, `payload`, `status`, `approver_id`

### 6. Google Integrations

**Gmail:**
- Fetch unread messages via Gmail API (OAuth 2.0 refresh token flow).
- Classify, label, store summaries and metadata.
- Extract attachments (future: file to Drive or Supabase Storage).
- Required scopes: `https://www.googleapis.com/auth/gmail.modify` (for label application) or `gmail.readonly`.

**Google Drive:**
- Connect project folders as `project_sources` (kind=`drive_folder`).
- Index file metadata: IDs, names, mime types, sizes, paths, owners, modified dates.
- Detect contract/asset types; link to projects and emails.
- Optional change-watch keeps index fresh.
- Attachment filing: move/copy from email into Drive project folders.
- UI for "Files & Assets" tab to browse, filter, and link.

**Google Calendar (planned):**
- Sync timeline items to Google/Outlook calendars for holds and confirmed events.
- Push/pull updates with approval on external changes.

**Implementation:**
- Worker auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`
- Worker Gmail: `worker/src/index.ts`, Google APIs SDK `googleapis`
- Frontend Drive: `app/lib/googleOAuth.ts`, `app/lib/googleDriveClient.ts`, `app/lib/driveIndexer.ts`
- Database: `oauth_accounts`, `assets`, `asset_links`, `project_sources` tables

### 7. Legal & Finance Workflows (Planned)

**Contracts:**
- Detect contract PDFs → extract party/term/fees/dates → store terms → approval to create tasks/labels.
- High-sensitivity approval route; visibility flags.
- Database: `contracts` table.

**Settlements:**
- Parse settlements → ledger lines → create tasks for missing docs → notify accountant.
- Database: `settlements`, `finance_tasks` (or reuse `project_tasks` with finance labels).

### 8. Meeting Intelligence (Planned)

**What it does:**
- Ingest Zoom/Google Meet recordings/transcripts.
- Generate summaries, decisions, and action items.
- Attach to the correct timeline and folders.

**Implementation:**
- Database: `meetings` table with `project_id`, `asset_id`, `recorded_at`, `participants`, `transcript`, `summary`, `actions`.
- Supabase Storage bucket for audio/video; index via `assets`.

### 9. Voice-First Capture (Telegram) (Planned)

**What it does:**
- Voice/text notes → transcribe, normalise shorthand, classify as task/note/doc.
- Auto-place on timeline at appropriate dates or backlog.

### 10. Release-Ops (Track Pipeline) (Planned)

**What it does:**
- Dynamic Track Reports from Drive (WAVs, radio edit, stems, artwork, one-sheet, credits, ISRC/BPM/Key/tags, status flags).
- Track Report linked as a Release lane on the timeline with gates (Upload Draft, Send-Outs, Publish, Post-Publish follow-ups).
- SoundCloud upload (API or assisted via Playwright): create private draft, set artwork/tags/permissions, return URL/ID; publish only on approval.
- Promo send-outs: segmented list (radio/DJ/press/artists, territory, previous support), drafted mail-merge messages, pacing/throttling; add send-out windows and follow-ups to timeline.
- Feedback tracking: parse replies, capture supporters/quotes/airplay; update Track Report; annotate timeline.

**Implementation:**
- Database: `tracks`, `track_assets`, `track_reports`, `promo_contacts`, `promo_lists`, `promo_list_members`, `sendouts`, `sendout_events`, `soundcloud_jobs` tables.

### 11. Brand-Fit Scoring (Lead Quality) (Planned)

**What it does:**
- Deterministic enrichment from venue/label/site, RA/Bandsintown/Songkick, Maps/Places, socials/news, internal memory.
- Explainable subscores and band (Accept/Caution/Decline) with conditions.
- Output stored with rubric version; leads appear on the timeline.

**Implementation:**
- Database: `brand_rubrics`, `offers` tables with `brand_fit_score`, `rubric_version`.

### 12. People & Org Enrichment (Planned)

**What it does:**
- Rich profiles with orgs, roles, reliability, past interactions.
- Signature parsing: extract title/company/phones from email bodies.
- Org mapping + domain linking; contact activity rollups.

**Implementation:**
- Database: `orgs`, `contact_orgs`, `contact_enrichment` tables.

---

## Architecture & Stack

### Monorepo Structure

```
cadenzor/
├── app/               # Next.js 14 dashboard (frontend)
│   ├── app/           # App Router pages and API routes
│   ├── components/    # React components
│   ├── lib/           # Helper utilities (Supabase, Google APIs)
│   ├── tailwind.config.js
│   └── package.json
├── worker/            # Node worker for Gmail triage (backend)
│   ├── src/index.ts   # Polls Gmail, classifies messages, writes to DB
│   ├── classifyEmail.ts
│   ├── digestJob.ts
│   ├── projectJobs.ts
│   └── package.json
├── shared/            # Shared types and domain logic
│   ├── src/types.ts
│   ├── analyzeEmail.ts
│   ├── heuristicLabels.ts
│   ├── labelUtils.ts
│   ├── projectPriority.ts
│   ├── timelineConflicts.ts
│   └── projectSuggestions.ts
├── package.json       # Root workspace configuration
├── schema_new.sql     # Canonical Supabase schema
└── README.md
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14 (App Router), React 18, Tailwind CSS, TypeScript |
| **Backend** | Node.js 20+, TypeScript, Supabase (Postgres + Auth + Storage + Realtime) |
| **Database** | Supabase (Postgres 15), Row-Level Security (RLS) policies |
| **AI/ML** | OpenAI API (email classification, summarization) |
| **Email** | Gmail API (OAuth 2.0, refresh tokens) |
| **Calendar** | Google Calendar API (planned) |
| **Storage** | Google Drive API, Supabase Storage |
| **Testing** | Vitest, Testing Library (React) |
| **Dev Tools** | npm workspaces, ESLint, Prettier (assumed), Git |
| **Deployment** | Vercel (app), Node server (worker), Supabase Cloud |

### Database Schema (Highlights)

**Core tables:**
- `contacts` – name, email, last_email_at
- `emails` – id (Gmail message ID), from_name, from_email, subject, received_at, category, is_read, summary, labels (jsonb), priority_score, triage_state, triaged_at
- `email_attachments` – filename, mime_type, size, storage_bucket, storage_path, sha256
- `projects` – id, artist_id, name, slug, description, status, start_date, end_date, color, labels (jsonb), priority_profile (jsonb), created_by
- `project_members` – project_id, user_id, role (owner/editor/viewer)
- `project_sources` – kind (drive_folder/drive_file/sheet/calendar), external_id, title, watch, scope, metadata, last_indexed_at
- `project_email_links` – project_id, email_id, confidence, source (manual/ai/rule)
- `project_item_links` – project_id, ref_table, ref_id, confidence, source
- `project_tasks` – title, description, status, due_at, priority, assignee_id
- `timeline_items` – type (event/milestone/task/hold/lead/gate), title, starts_at, ends_at, lane, territory, status, priority, ref_table, ref_id, metadata (jsonb)
- `timeline_dependencies` – from_item_id, to_item_id, kind (FS/SS), note
- `assets` – project_id, source (drive), external_id, title, mime_type, size, path, owner, modified_at, confidential, metadata, is_canonical, canonical_category (logo/epk/cover/press/audio/video/other), drive_url, drive_web_view_link
- `asset_links` – project_id, asset_id, ref_table, ref_id, source
- `oauth_accounts` – user_id, provider (google), account_email, scopes, access_token, refresh_token, expires_at
- `approvals` – project_id, type (project_email_link/timeline_item_from_email/...), status (pending/approved/declined), payload (jsonb), requested_by, approver_id, approved_at, declined_at, resolution_note
- `user_preferences` – user_id, digest_frequency (daily/weekly/off), digest_hour, timezone, channels (web/email/slack), quiet_hours
- `digests` – user_id, generated_for (date), channel, status (generated/queued/sent/failed), payload (jsonb), delivered_at
- `action_logs` – user_id, action, entity, ref_id, payload (jsonb), created_at
- `project_templates` – name, slug, description, payload (jsonb)
- `project_template_items` – template_id, item_type, title, lane, offset_days, duration_days, metadata

**Indexes:**
- B-tree on foreign keys, `starts_at`, `ends_at`, `priority`, `status`, `created_at`
- GIN on `labels` (jsonb), `metadata` (jsonb)
- Optional pgvector for semantic search (Phase 2)

**RLS policies:**
- Enforce project membership and user ownership
- Global admins can see all
- Worker bypasses via service role key

---

## Environment Variables

**Supabase (both worker and dashboard):**
- `SUPABASE_URL` – your Supabase project URL (e.g., `https://xyzcompany.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` – service key for the worker to write to the database
- `NEXT_PUBLIC_SUPABASE_URL` – same as `SUPABASE_URL`, exposed to the browser
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` – public anon key for the frontend

**Google / Gmail (worker only):**
- `GOOGLE_CLIENT_ID` – Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` – Google OAuth client secret
- `GOOGLE_REDIRECT_URI` – optional; redirect URI used when minting the refresh token (e.g., `https://developers.google.com/oauthplayground`)
- `GMAIL_REFRESH_TOKEN` – refresh token obtained via OAuth consent flow for the Gmail account to monitor

**OpenAI (worker only):**
- `OPENAI_API_KEY` – OpenAI API key for email classification

**Worker config (optional):**
- `MAX_EMAILS_TO_PROCESS` – limits how many unread messages are analyzed per run (defaults to `5`)

---

## Installation & Setup

### Prerequisites
- Node.js 20 or later (see `.nvmrc`)
- Supabase project (cloud or local)
- Google OAuth credentials (client ID, secret, refresh token)
- OpenAI API key

### 1. Clone the repository
```bash
git clone <repo-url>
cd cadenzor
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up Supabase
- Create a Supabase project at https://supabase.com
- Apply the schema: `schema_new.sql` (via Supabase SQL editor or migration tool)
- Copy your Supabase URL and keys

### 4. Configure environment variables

**Worker (`worker/.env`):**
```bash
SUPABASE_URL=https://xyzcompany.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GMAIL_REFRESH_TOKEN=your-gmail-refresh-token
OPENAI_API_KEY=your-openai-api-key
MAX_EMAILS_TO_PROCESS=5
```

**Dashboard (`app/.env.local`):**
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xyzcompany.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 5. Build the monorepo
```bash
npm run build
# Builds shared, worker, and app packages
```

### 6. Run the worker (email triage)
```bash
cd worker
npm run build
npm start
# Polls Gmail, classifies, and writes to DB
```

### 7. Run the dashboard (Next.js)
```bash
cd app
npm run dev
# Visit http://localhost:3000
```

### 8. Run the digest job
```bash
npm --prefix worker run digest
# Generates Today digest and stores in DB
```

### 9. Run tests
```bash
npm test
# Runs Vitest suites across all packages
```

---

## User Journeys

### A. Booking Offer Workflow
1. Email arrives: "Show offer for Barry Cant Swim at Fabric London, £5,000, 2026-05-10"
2. Worker classifies as `BOOKING/Offer`, applies Gmail labels, extracts venue/date/fee
3. Playbook triggers: brand-fit scoring, lead creation, proposed hold, folder scaffold, reply draft
4. Items appear on Timeline Studio (lane: Live, territory: GB, date: 2026-05-10)
5. Dashboard highlights top action: "New offer: Fabric London – Accept conditions / Request info / Decline"
6. Oran reviews, approves hold, sends reply draft

### B. Promo Interview Workflow
1. Email: "Can Barry do a 30min interview for Radio 1 on 2026-05-12 at 14:00 BST?"
2. Worker classifies as `PROMO/Promo_Time_Request`
3. Playbook proposes slots around routing (checks timeline for conflicts/buffers)
4. Tentative hold added to timeline (lane: Promo, city: London, date: 2026-05-12)
5. Reply drafted: "Thanks! Barry is available 14:00–14:30 BST. Here's his EPK: [link]"
6. Oran approves and sends

### C. Meeting Intelligence Workflow
1. Zoom meeting wraps (1 hour, 5 attendees)
2. Worker ingests recording → transcribe → summarise
3. Decisions: "Confirm Fabric show; request higher fee; book hotels by Friday"
4. Tasks created: "Negotiate fee with Fabric", "Book hotels for London leg"
5. Tasks placed on timeline; visible in dashboard "Recent Meetings" panel
6. Oran reviews summary, edits tasks if needed

### D. Release Workflow (SHEE by Barry Cant Swim)
1. Oran creates project: "SHEE – Single Release"
2. Connects Drive folder: `/Barry Cant Swim/Releases/SHEE`
3. Worker indexes: WAV, radio edit, stems, artwork JPG, one-sheet PDF
4. Track Report built; release gates added to timeline:
   - Upload Draft (2026-04-01)
   - Send-Outs (2026-04-10)
   - Publish (2026-04-20)
   - Post-Publish follow-ups (2026-04-27)
5. SoundCloud draft created (private); awaits approval to publish
6. Promo list generated (radio/DJ/press, territory: GB/DE/JP)
7. Mail-merge drafts created; Oran reviews, approves send-out
8. Replies parsed: supporters/quotes logged; timeline shows progress
9. Dashboard "Release Control Room" shows readiness bars, SoundCloud status, send-out stages

---

## Roadmap & Gaps

### Implemented ✅
- Email triage pipeline (Gmail fetch, OpenAI classification, heuristic fallback, Gmail labels)
- Email dashboard with filtering, pagination, manual classification trigger
- Supabase auth (email/password, protected routes, profile edit)
- Projects domain (CRUD, list, templates, seed)
- Project Hub with Overview, Timeline Studio, Inbox (email links), Tasks, Files & Assets, People, Approvals, Settings
- Email-to-project suggestions + approvals workflow
- Priority Engine + conflict detection
- Today digest (web view at `/today`, worker job)
- Worker jobs (project metrics, approval queuing)
- Timeline Studio (multi-lane Gantt, dependencies, buffers, conflict warnings)
- Supabase schema (emails, contacts, projects, tasks, timeline, dependencies, sources, approvals, digests, assets)

### Planned 🚧
- **Priority Engine digest:** Daily/weekly email delivery, Telegram TL;DR
- **Gmail inbox actions:** Threaded view, attachments, reply drafts, snooze, "Open in Gmail" links
- **Google Drive integration:** OAuth per user, Drive file indexing, attachment filing, asset library UI
- **Playbooks expansion:** Legal summary, settlement parsing, promo slot proposals, asset filing
- **Promo & scheduling intelligence:** Routing-aware slot proposals, hold creation, calendar sync
- **Legal & finance workflows:** Contract term extraction, settlement parsing, high-sensitivity approvals
- **Calendar sync:** Google/Outlook calendar integration, hold/event push/pull
- **People & org enrichment:** Signature extraction, org mapping, contact activity rollups
- **Meeting recordings:** Zoom/Meet ingestion, transcription, summarization, action items
- **Voice-first capture:** Telegram integration, transcription, task/note creation
- **Release-ops:** Track Reports, SoundCloud uploader, promo send-outs, feedback tracking
- **Brand-fit scoring:** Deterministic enrichment, explainable subscores, lead quality bands

---

## Key Files Reference

### Frontend (app/)
- **Routes:** `app/app/(protected)/page.tsx` (home), `/inbox/page.tsx`, `/today/page.tsx`, `/projects/page.tsx`, `/projects/[projectId]/page.tsx`, `/profile/page.tsx`, `/admin/page.tsx`
- **API:** `app/app/api/email-stats/route.ts`, `emails/route.ts`, `classify-emails/route.ts`, `projects/route.ts`, `project-templates/route.ts`, `approvals/route.ts`, `digests/route.ts`
- **Components:** `EmailDashboard.tsx`, `home/HomeDashboard.tsx`, `today/TodayDashboard.tsx`, `projects/TimelineStudio.tsx`, `projects/FilesTab.tsx`, `AppShell.tsx`, `AuthGuard.tsx`, `AuthProvider.tsx`, `LoginForm.tsx`
- **Libraries:** `lib/supabaseClient.ts`, `supabaseBrowserClient.ts`, `serverSupabase.ts`, `serverAuth.ts`, `adminAuth.ts`, `projectAccess.ts`, `approvalActions.ts`, `googleOAuth.ts`, `googleDriveClient.ts`, `driveIndexer.ts`, `auditLog.ts`

### Worker (worker/)
- **Jobs:** `src/index.ts` (Gmail poller), `classifyEmail.ts`, `digestJob.ts`, `projectJobs.ts`
- **Scripts:** `npm run build`, `npm start`, `npm run digest`, `npm run refresh-projects`

### Shared (shared/)
- **Types:** `src/types.ts` (all domain types, taxonomy constants)
- **Logic:** `analyzeEmail.ts` (OpenAI orchestration), `heuristicLabels.ts` (rule-based), `labelUtils.ts` (normalization), `projectPriority.ts` (scoring), `timelineConflicts.ts` (conflict detection), `projectSuggestions.ts` (email-to-project linking)

### Database
- **Schema:** `schema_new.sql` (canonical Supabase schema)

### Reference Docs
- `README.md` – Setup guides, Supabase schema summary
- `Project Overview.txt` – Product narrative (AI Music Management Assistant – Timeline-First Spec v1.2)
- `Project Roadmap.txt` – Milestone planning, backlog ideas
- `AGENTS.md` – Complete codebase guide for contributors (human or AI)
- `Contact Enrichment.txt` – Requirements for contact sync & dedupe
- `Oran Responses.txt` – Stakeholder Q&A guiding UX & automation decisions

---

## Testing

- **Framework:** Vitest (unit tests), Testing Library (React component tests)
- **Config:** `vitest.config.ts`, `vitest.setup.ts`
- **Coverage:** `shared/src/__tests__/` (analyzeEmail, heuristicLabels, projectPriority), `worker/src/__tests__/` (classifyEmail), `app/components/__tests__/` (AuthGuard)
- **Run:** `npm test` from repo root

---

## Security & Compliance

- **RLS policies:** Enforce project membership, user ownership; global admins see all; worker bypasses via service role
- **Never-act-alone guardrails:** All outbound email Draft-Only by default; domain/keyword blacklists for legal/finance/confidential; confidence thresholds; per-artist tone kits
- **Approvals workflow:** High-sensitivity actions (legal, finance, settlements) require explicit approval before execution
- **Audit logs:** `action_logs` table tracks user actions, entity changes, diffs
- **Confidential flags:** Assets and emails can be flagged as confidential; restricts visibility and sharing

---

## Contributing

- **Monorepo:** npm workspaces; shared types in `shared/`; frontend in `app/`; backend in `worker/`
- **Code style:** TypeScript, ESLint, Prettier (assumed)
- **Git workflow:** Feature branches, PRs to `main`
- **Testing:** Add tests for new features; run `npm test` before committing
- **Documentation:** Update this file and `AGENTS.md` when adding major features

**Pull requests are welcome!** Enjoy hacking on Cadenzor.

---

## Contact & Support

- **Docs:** See `README.md`, `AGENTS.md`, `Project Overview.txt`, `Project Roadmap.txt`
- **Issues:** GitHub issues (if public repo) or internal tracker
- **Stakeholder:** Oran (artist manager) – see `Oran Responses.txt` for Q&A context

---

## License

Private / proprietary (assumed; specify if open-source)

---

**Cadenzor** – From inbox chaos to timeline clarity. Manage artists like a pro.
