# Google Drive Integration Strategy: Intelligent File Management at Scale

**Document Version:** 1.0
**Date:** October 2025
**Purpose:** Define how Kazador intelligently integrates Google Drive without creating a computational monolith
Deadline
---

## The Challenge

Oran connects his Google Drive to Kazador and links folders to projects. Each project might have:
- 50-200 files (contracts, riders, invoices, artwork, audio files, itineraries)
- Files arriving continuously (email attachments, direct uploads)
- Files in various formats (PDF, DOCX, PNG, JPG, MP3, WAV, ZIP)

**The Naive Approach (DON'T DO THIS):**
- Index every file deeply on connection
- Extract full text from every PDF
- Analyze every image with vision models
- Transcribe every audio file
- Re-analyze everything on every change
- **Result:** Slow, expensive, overwhelming, unnecessary

**The Smart Approach (THIS DOCUMENT):**
- Lightweight metadata indexing (always)
- Pattern-based categorization (fast)
- Selective deep analysis (only when needed)
- Incremental updates (only changed files)
- User-triggered depth (Oran chooses)
- **Result:** Fast, cheap, useful, scalable

---

## Three-Tier Architecture

### Tier 1: Metadata-Only Indexing (Always On, Lightweight)
**What:** Index Drive file metadata without downloading or analyzing content
**When:** Immediate on folder connection, incremental updates via Drive change notifications
**Cost:** Nearly free (Drive API metadata calls only)

### Tier 2: Smart Categorization (Pattern-Based, Fast)
**What:** Categorize files based on name, path, type, and light heuristics
**When:** During metadata indexing
**Cost:** Minimal (regex + rule matching, no AI)

### Tier 3: Deep Content Analysis (Selective, On-Demand)
**What:** Extract text from PDFs, analyze images, transcribe audio, run AI understanding
**When:** Only when triggered by automation rules, user request, or specific file types
**Cost:** Moderate (AI API costs, but rare)

---

## Tier 1: Metadata-Only Indexing

### What Gets Indexed (No Content Downloaded)

**File Metadata (from Drive API):**
- File ID (unique identifier)
- File name
- MIME type (application/pdf, image/png, audio/mpeg, etc.)
- File size (bytes)
- Created date
- Modified date
- Last modified by (user email)
- Owner (user email)
- Parent folder ID(s)
- Full path (constructed from folder tree)
- Sharing settings (private, shared, anyone with link)
- Starred status
- Trashed status
- Drive URL (for quick access)
- Thumbnail URL (if available)

**Folder Metadata:**
- Folder ID
- Folder name
- Parent folder ID
- Full path
- Color
- Created/modified dates

**What's NOT Indexed (Yet):**
- File content (text inside PDFs, image contents, audio transcripts)
- File relationships (which files reference other files)
- Version history
- Comments

### Database Schema

**Table: `drive_files`**
```
Columns:
- id (UUID, primary key)
- project_id (UUID, references projects)
- drive_file_id (TEXT, Drive's unique ID)
- name (TEXT, filename)
- mime_type (TEXT, e.g., "application/pdf")
- size_bytes (BIGINT)
- path (TEXT, full folder path, e.g., "/Projects/Asian Tour 2026/Contracts/")
- parent_folder_id (TEXT, Drive folder ID)
- owner_email (TEXT)
- created_at (TIMESTAMPTZ, Drive creation date)
- modified_at (TIMESTAMPTZ, Drive modification date)
- last_indexed_at (TIMESTAMPTZ, when we last synced)
- drive_url (TEXT, direct link to Drive)
- thumbnail_url (TEXT, preview image if available)
- is_trashed (BOOLEAN)
- sharing_settings (JSONB, who can access)
- metadata (JSONB, flexible field for extra data)
- category (TEXT, auto-detected category, see Tier 2)
- tags (TEXT[], searchable tags)
- content_analyzed (BOOLEAN, whether Tier 3 ran)
- content_summary (TEXT, from Tier 3 if ran)
```

**Indexes:**
- `project_id` (fast project-scoped queries)
- `drive_file_id` (unique, for updates)
- `path` (GIN index for path prefix searches)
- `mime_type` (fast filtering by type)
- `category` (fast filtering by category)
- `tags` (GIN index for tag searches)
- `modified_at` (for sorting by recency)
- Full-text search index on `name` and `content_summary`

### Indexing Flow

**Initial Connection:**
1. User connects Google Drive in `/settings/integrations`
2. OAuth flow grants Drive API access (read-only scope)
3. Store refresh token in `oauth_accounts` table
4. User goes to Project Hub → Settings → Sources
5. User clicks "Connect Drive Folder"
6. Drive folder picker opens
7. User selects folder (e.g., `/Projects/Asian Tour 2026/`)
8. System creates `project_sources` record (kind=`drive_folder`)
9. Worker job queued: `index_drive_folder`

**Worker Job: `index_drive_folder`**
```
Input: project_id, source_id, folder_id

Steps:
1. Fetch folder metadata from Drive API
2. Recursively list all files in folder (using Drive API)
   - Drive API: files.list(q="'{folder_id}' in parents")
   - Handle pagination (Drive returns 1000 files max per request)
3. For each file:
   - Extract metadata (no content download)
   - Run Tier 2 categorization (fast, pattern-based)
   - Insert/update `drive_files` table
4. Mark source as `indexed` with timestamp
5. Set up Drive change notifications (watch for updates)

Performance:
- 1000 files = ~10 seconds (metadata only, no content)
- 10,000 files = ~2 minutes
```

**Incremental Updates (Change Notifications):**
```
Drive supports push notifications when files change:

1. Register webhook with Drive API:
   - POST to /drive/v3/files/{fileId}/watch
   - Provide webhook URL (e.g., /api/webhooks/drive-changes)
2. Drive sends notification when:
   - File added to watched folder
   - File modified
   - File deleted
   - File moved
3. Webhook handler:
   - Receive notification
   - Fetch updated file metadata
   - Update `drive_files` table
   - Trigger Tier 2 re-categorization if needed
   - Trigger automation rules if file matches triggers

Performance:
- Real-time updates (within seconds of Drive change)
- No polling needed
- Minimal API calls (only changed files)
```

### User Experience

**Files Tab in Project Hub:**
```
/projects/{projectId}/files

Display:
- Connected Drive folders (sources)
- File tree view (folders + files)
- List view (table with columns: name, type, size, modified, category)
- Search bar (searches name and tags)
- Filters:
  - By category (Contracts, Artwork, Audio, etc.)
  - By file type (PDF, Image, Audio, etc.)
  - By date range
  - By tag
- Sort options:
  - Name
  - Modified date
  - Size
  - Category

Each file shows:
- Icon (based on mime type)
- Filename
- Category badge
- Size
- Modified date
- Quick actions:
  - Open in Drive (new tab)
  - Link to email (opens modal to select email)
  - Link to timeline item (opens modal)
  - Deep analyze (triggers Tier 3)
  - Download
  - Add tags
```

**Empty State:**
```
When no Drive folders connected:

"Connect Google Drive to manage project files"
[Connect Drive Folder] button

When Drive connected but no files:
"No files in this folder yet. Upload files to Google Drive and they'll appear here."
```

---

## Tier 2: Smart Categorization (Pattern-Based)

### Purpose
Automatically categorize files into useful buckets WITHOUT analyzing content, using only filename, path, and mime type.

### Categories

**Category Taxonomy:**
1. **Contracts** — Legal agreements, riders, terms
2. **Invoices & Finances** — Invoices, settlements, receipts
3. **Itineraries** — Day sheets, travel plans, schedules
4. **Technical** — Tech riders, stage plots, input lists
5. **Artwork** — Covers, banners, logos, press photos
6. **Audio** — Tracks, stems, radio edits, masters
7. **Press** — EPKs, one-sheets, bios, press releases
8. **Correspondence** — Saved emails, message threads
9. **Media** — Videos, photos, social content
10. **Admin** — General docs, notes, meeting minutes
11. **Other** — Uncategorized

### Categorization Rules (Fast, No AI Needed)

**Rule Engine (Evaluated in Order):**

```
Rule 1: Path-Based
IF path contains "/Contracts" OR "/Legal" → Category: Contracts
IF path contains "/Finance" OR "/Invoices" → Category: Invoices & Finances
IF path contains "/Artwork" OR "/Assets" → Category: Artwork
IF path contains "/Audio" OR "/Music" → Category: Audio
IF path contains "/Press" OR "/EPK" → Category: Press
IF path contains "/Tech" OR "/Riders" → Category: Technical
IF path contains "/Itineraries" OR "/Travel" → Category: Itineraries

Rule 2: Filename-Based (Regex Patterns)
IF filename matches /contract|agreement|rider|terms/i → Contracts
IF filename matches /invoice|receipt|settlement|statement/i → Invoices & Finances
IF filename matches /itinerary|daysheet|schedule|timeline/i → Itineraries
IF filename matches /tech.?rider|stage.?plot|input.?list/i → Technical
IF filename matches /artwork|cover|banner|logo|press.?photo/i → Artwork
IF filename matches /epk|press.?kit|one.?sheet|bio|press.?release/i → Press

Rule 3: MIME Type-Based
IF mime_type = "audio/mpeg" OR "audio/wav" OR "audio/flac" → Audio
IF mime_type = "image/png" OR "image/jpeg" → Check filename for "artwork" → Artwork, else → Media
IF mime_type = "video/*" → Media
IF mime_type = "application/pdf" → Check filename patterns → Best match or Admin

Rule 4: File Extension-Based
IF extension = ".mp3" OR ".wav" OR ".flac" OR ".aiff" → Audio
IF extension = ".jpg" OR ".png" OR ".psd" OR ".ai" → Artwork (if in artwork folder), else Media
IF extension = ".mov" OR ".mp4" → Media
IF extension = ".pdf" → Check filename patterns
IF extension = ".doc" OR ".docx" → Admin or Press (based on path)
IF extension = ".xls" OR ".xlsx" → Invoices & Finances (likely)

Rule 5: Default
IF no match → Other
```

**Implementation:**
```
Function: categorize_file(file_metadata)

Input: {name, path, mime_type, extension}
Output: category string

Pseudo-code:
1. Check path patterns (most reliable)
2. Check filename patterns
3. Check mime type
4. Check extension
5. Return best match or "Other"

Performance:
- Pure regex and string matching
- No AI calls
- < 1ms per file
- Can categorize 10,000 files in seconds
```

### Auto-Tagging (Additional Metadata)

**Tag Extraction (Also Pattern-Based):**

```
Extract tags from filename and path:

Artist Tags:
IF name or path contains "Barry Cant Swim" → tag: "Barry Cant Swim"
IF name or path contains "SHEE" → tag: "SHEE" (release name)

Date Tags:
IF name matches /20\d{2}[-_]\d{2}[-_]\d{2}/ → extract date, tag: "date:YYYY-MM-DD"
IF name matches /\d{4}/ → tag: "year:YYYY"

Venue/Location Tags:
IF name contains known venue name → tag: "venue:Fabric"
IF name contains city name → tag: "city:London"
IF name contains country code → tag: "country:GB"

Version Tags:
IF name matches /v\d+|version\d+/i → tag: "version:X"
IF name matches /draft|final|master/i → tag: "status:draft|final|master"
IF name matches /signed|executed/i → tag: "status:signed"

Asset Type Tags (for audio):
IF name matches /radio.?edit/i → tag: "audio_type:radio_edit"
IF name matches /stem/i → tag: "audio_type:stem"
IF name matches /master/i → tag: "audio_type:master"
```

### Confidence Scoring

**For each categorization, compute confidence:**
```
Confidence Score (0-100):

High Confidence (80-100):
- Path explicitly matches category (e.g., /Contracts/xyz.pdf)
- Filename strongly matches pattern (e.g., "Contract - Fabric - 2026.pdf")

Medium Confidence (50-79):
- MIME type matches + weak filename pattern
- Multiple weak signals align

Low Confidence (0-49):
- Only MIME type match
- No path or filename signals
- Assigned to "Other"

Store confidence score in metadata JSONB field
```

**Use Cases for Confidence:**
- High confidence → Auto-categorize silently
- Medium confidence → Auto-categorize but allow easy reclassification
- Low confidence → Suggest category, ask user to confirm

---

## Tier 3: Deep Content Analysis (Selective, On-Demand)

### When to Trigger Deep Analysis

**Automatic Triggers (via Automation Rules):**
1. **Legal contracts** — When file categorized as "Contracts" AND filename contains "draft" or "executed"
2. **Finance documents** — When file categorized as "Invoices & Finances" AND > 50KB
3. **Itineraries** — When file categorized as "Itineraries"
4. **Audio files** — When file categorized as "Audio" AND > 5MB (likely full track)
5. **Press materials** — When file categorized as "Press"

**Manual Triggers:**
- User clicks "Analyze" button on file
- User creates automation rule requesting deep analysis
- User searches for content and file hasn't been analyzed yet

**Rule-Based Triggers:**
```
Example Automation Rule:

Trigger:
- Drive file added to project
- Category = "Contracts"
- Filename contains "signed" OR "executed"

Actions:
1. Deep analyze contract (extract parties, dates, fees, terms)
2. Create timeline item (due date from contract)
3. Create approval task ("Review executed contract")
4. Notify: Email to legal@example.com
```

### Deep Analysis Methods (By File Type)

#### PDF Files (Contracts, Invoices, Itineraries, Press)

**Method: Text Extraction + AI Parsing**

**Steps:**
1. Download PDF from Drive (cache locally for 24 hours)
2. Extract text using OCR if needed (pdf-parse library or Google Document AI)
3. Send text to OpenAI with structured prompt
4. Parse structured response
5. Store extracted data in `drive_files.metadata` JSONB
6. Set `content_analyzed = true`
7. Update `content_summary` with brief description

**Example: Contract Analysis**
```
Input: PDF text (up to 50KB of text)

Prompt to OpenAI:
"Extract the following from this contract:
- Parties (promoter/venue name, artist name)
- Venue name and address
- Event date(s)
- Performance fee (amount and currency)
- Payment terms (deposit %, due dates)
- Key deadlines (rider due, artwork due, contract return due)
- Advance requirements (guest list, tech rider, etc.)
- Special terms or riders

Return as JSON."

Output Example:
{
  "parties": {
    "promoter": "Fabric Nightclub Ltd",
    "artist": "Barry Cant Swim"
  },
  "venue": {
    "name": "Fabric",
    "address": "77A Charterhouse St, London EC1M 6HJ"
  },
  "event_date": "2026-05-10",
  "fee": {
    "amount": 5000,
    "currency": "GBP"
  },
  "payment_terms": {
    "deposit_percent": 50,
    "deposit_due": "2026-04-01",
    "balance_due": "2026-05-03"
  },
  "deadlines": {
    "rider_due": "2026-04-15",
    "artwork_due": "2026-04-20"
  },
  "advance_requirements": ["tech_rider", "guest_list", "hospitality"]
}

Store in metadata JSONB column
Create timeline items for deadlines
Create task: "Submit rider by 2026-04-15"
```

**Example: Invoice Analysis**
```
Prompt: Extract invoice details

Output:
{
  "invoice_number": "INV-2026-042",
  "invoice_date": "2026-05-15",
  "due_date": "2026-06-15",
  "amount": 5000,
  "currency": "GBP",
  "line_items": [
    {"description": "Performance fee", "amount": 5000}
  ],
  "payment_instructions": {
    "bank": "Barclays",
    "account_number": "12345678",
    "sort_code": "20-00-00"
  }
}

Create task: "Pay invoice by 2026-06-15"
Add to finance tracking
```

**Example: Itinerary Analysis**
```
Prompt: Extract schedule details

Output:
{
  "date": "2026-05-10",
  "city": "London",
  "venue": "Fabric",
  "schedule": [
    {"time": "18:00", "activity": "Load in"},
    {"time": "20:00", "activity": "Soundcheck"},
    {"time": "22:00", "activity": "Doors open"},
    {"time": "01:00", "activity": "Performance start"},
    {"time": "03:00", "activity": "Performance end"}
  ],
  "contacts": [
    {"name": "John Smith", "role": "Production Manager", "phone": "+44..."}
  ],
  "special_notes": ["Vegetarian catering requested"]
}

Update timeline item with detailed schedule
Add contacts to project
```

#### Image Files (Artwork, Photos)

**Method: Vision API (Selective)**

**When to Analyze:**
- File categorized as "Artwork" AND used in release
- User explicitly requests analysis
- Automation rule checks for specific image attributes

**Steps:**
1. Download image from Drive (or use thumbnail URL if sufficient)
2. Send to OpenAI Vision API with prompt
3. Extract structured data
4. Store in metadata

**Example: Artwork Analysis**
```
Prompt: "Describe this image. Is it album artwork? What's the dominant color? Are there any text elements? What's the mood/style?"

Output:
{
  "type": "album_artwork",
  "dominant_colors": ["#FF6B6B", "#4ECDC4", "#1A535C"],
  "text_detected": "SHEE",
  "mood": "moody, atmospheric",
  "style": "abstract, electronic",
  "dimensions": "3000x3000",
  "is_square": true,
  "suitable_for": ["streaming", "social_media", "print"]
}

Use for:
- Quick preview in UI
- Duplicate detection (similar colors/composition)
- Artwork completion checklist (have cover, need banner, etc.)
```

**Note:** Vision API is expensive (~$0.01-0.05 per image), so use sparingly. Metadata (dimensions, file size) is often sufficient.

#### Audio Files (Tracks, Stems)

**Method: Audio Analysis (Very Selective)**

**When to Analyze:**
- File categorized as "Audio" AND linked to release
- User explicitly requests analysis (e.g., "What's the BPM?")
- Automation rule needs audio metadata

**Basic Metadata (Free, from File Headers):**
- Duration
- Bitrate
- Sample rate
- Channels (mono/stereo)
- ID3 tags (artist, title, album, etc.)

**Advanced Analysis (Paid, via APIs):**
- BPM detection (use Essentia, librosa, or Audio Analysis APIs)
- Key detection (Essentia, Spotify API)
- Genre classification (Audio Intelligence APIs)
- Loudness/dynamics (EBU R128 loudness)

**Example:**
```
Basic Metadata (from file headers):
{
  "duration_seconds": 245,
  "bitrate": "320kbps",
  "sample_rate": "44100Hz",
  "format": "MP3",
  "id3_tags": {
    "artist": "Barry Cant Swim",
    "title": "SHEE",
    "album": "Singles 2026"
  }
}

Advanced Analysis (if requested):
{
  "bpm": 126,
  "key": "A minor",
  "loudness_lufs": -10.5,
  "genre_tags": ["house", "electronic", "deep house"]
}

Store in metadata
Display in Track Report UI
```

**Cost Considerations:**
- Basic metadata: Free (read file headers)
- BPM/key detection: ~$0.001 per file (Essentia library, self-hosted)
- Advanced analysis: ~$0.01-0.10 per file (third-party APIs)

**Recommendation:** Only run advanced analysis when user explicitly adds audio file to a release (Track Report). Don't auto-analyze every MP3 in Drive.

### Caching & Incremental Updates

**Cache Policy:**
- Downloaded files cached locally for 24 hours (temp directory)
- Analyzed content stored in `drive_files.metadata` JSONB indefinitely
- Mark `content_analyzed = true` and `last_analyzed_at`
- If file modified_at changes, set `content_analyzed = false` to trigger re-analysis

**Incremental Re-Analysis:**
- Only re-analyze if Drive `modified_at` is newer than `last_analyzed_at`
- User can manually trigger "Re-analyze" (forces analysis)
- Automation rules can specify "Always analyze latest version"

---

## File-to-Email Linking

### Automatic Suggestions

**When Email Arrives with Attachments:**
1. Worker extracts attachments from Gmail
2. For each attachment:
   - Check if filename matches any files in Drive (fuzzy match)
   - Check if attachment already exists in project Drive folders
   - If not, suggest filing to appropriate Drive folder
3. Create suggestion in `approvals` table:
   - Type: `file_attachment_suggestion`
   - Payload: {email_id, attachment_name, suggested_project_id, suggested_folder_path, confidence}
4. Show in Project Hub → Approvals tab
5. User approves → Worker uploads attachment to Drive folder

**When Drive File Matches Email Context:**
1. New file added to project Drive folder (via change notification)
2. Worker checks:
   - Are there recent emails in project inbox mentioning this filename?
   - Are there recent emails from file owner's email address?
   - Does file category match any recent email categories (e.g., Contract file + LEGAL/* email)?
3. If match found with confidence > 70%:
   - Create `file_email_link` suggestion
   - Show in UI: "This file seems related to email: [subject]. Link them?"
   - User approves → Create link in `asset_links` table

**Manual Linking:**
- User clicks "Link to Email" on file
- Opens modal with email search
- User selects email
- Link created immediately
- Shows in both email view (attached files section) and file view (related emails section)

### Database Schema for Links

**Table: `asset_links`** (Already Exists)
```
Columns:
- id (UUID)
- project_id (UUID)
- asset_id (UUID, references drive_files.id)
- ref_table (TEXT, e.g., "emails")
- ref_id (TEXT, e.g., email.id)
- source (TEXT, "manual" or "auto")
- confidence (INT, 0-100 if auto)
- created_at (TIMESTAMPTZ)
```

### UI Display

**In Email View:**
```
Email: "Contract for Fabric show - May 2026"

Attachments (from Gmail):
- contract_fabric_may2026.pdf (156 KB) [Download]

Linked Drive Files:
- /Contracts/Fabric - May 2026 - Signed.pdf [Open in Drive]
- /Itineraries/London - May 2026.pdf [Open in Drive]

[+ Link Another File]
```

**In Files Tab:**
```
File: contract_fabric_may2026.pdf

Category: Contracts
Size: 156 KB
Modified: 2 days ago
Tags: Fabric, London, 2026-05-10, signed

Related Emails:
- "Contract for Fabric show - May 2026" (Oran Smith, 2 days ago)
- "Re: Contract amendments" (Fabric Production, 1 day ago)

Related Timeline Items:
- "Fabric Show - London" (2026-05-10)
- "Submit rider for Fabric" (2026-04-15)

[Analyze Content] [Add Tags] [Link to Email] [Link to Timeline]
```

---

## Automation Rule Integration

### File-Based Triggers

**New Trigger Type: Drive File Added/Modified**

**Trigger Fields:**
- File added to project
- File modified in project
- File name matches pattern
- File category equals X
- File size greater than X
- File mime type equals X
- File path contains X
- File tagged with X

**Example Rules:**

**Rule: Contract Auto-Processor**
```
Trigger:
- Drive file added to project
- Category = "Contracts"
- Filename contains "signed" OR "executed"

Actions:
1. Deep analyze contract (extract parties, dates, fees)
2. Create timeline item:
   - Lane: Legal
   - Title: "Contract signed: {{file.metadata.venue.name}}"
   - Date: {{file.metadata.event_date}}
3. Create tasks for deadlines:
   - "Submit rider by {{file.metadata.deadlines.rider_due}}"
   - "Submit artwork by {{file.metadata.deadlines.artwork_due}}"
4. Create approval: "Review contract terms"
5. Notify: Email to legal@example.com with file link
```

**Rule: Invoice Tracker**
```
Trigger:
- Drive file added to project
- Category = "Invoices & Finances"
- Filename contains "invoice"

Actions:
1. Deep analyze invoice (extract amount, due date)
2. Create task:
   - Title: "Pay invoice {{file.metadata.invoice_number}}"
   - Due date: {{file.metadata.due_date}}
   - Assignee: Accountant
3. Create timeline item in Finance lane
4. Notify: Email to accountant@example.com
```

**Rule: Artwork Completion Checker**
```
Trigger:
- Drive file added to project
- Category = "Artwork"
- Project has label "release"

Actions:
1. Check which artwork types exist in project:
   - Cover (3000x3000)
   - Banner (1500x500)
   - Social (1080x1080)
2. Update release checklist:
   - Mark existing types as complete
   - Create tasks for missing types
3. If all artwork complete:
   - Update timeline item "Artwork delivery" to "done"
   - Notify: "All artwork for {{project.name}} is ready!"
```

**Rule: Audio File to Track Report**
```
Trigger:
- Drive file added to project
- Category = "Audio"
- File size > 5 MB (likely full track, not sample)
- File name contains release name

Actions:
1. Analyze audio metadata (BPM, key, duration)
2. Add to Track Report (or create if doesn't exist)
3. Create timeline item: "Review {{file.name}}"
4. Notify artist: "New track version uploaded"
```

### File-Based Actions

**New Action Type: File Operations**

**Action: Upload Attachment to Drive**
```
Config:
- Destination folder (path or auto-detect)
- Filename pattern (template)
- Overwrite if exists (yes/no)

Example:
Upload email attachment to:
/Projects/{{project.name}}/Contracts/{{attachment.name}}
```

**Action: Create Drive Folder**
```
Config:
- Folder path (template)
- Create parent folders if needed (yes/no)

Example:
Create folder:
/Projects/{{project.name}}/Show - {{venue}} - {{date}}/
```

**Action: Move/Rename File**
```
Config:
- Source file (from trigger)
- Destination path
- New filename (optional)

Example:
Move file from /Inbox/ to /Projects/{{project.name}}/Contracts/
Rename to: Contract - {{venue}} - {{date}} - Signed.pdf
```

**Action: Tag File**
```
Config:
- Tags to add (comma-separated or template)

Example:
Add tags: {{project.name}}, {{venue}}, signed, urgent
```

**Action: Link File to Email**
```
Config:
- File (from trigger)
- Email (from current context or search)
- Confidence (manual = 100)
```

**Action: Link File to Timeline Item**
```
Config:
- File (from trigger)
- Timeline item (auto-detect or specify)
```

---

## Performance & Scalability

### Indexing Performance

**Benchmarks (Single Project):**
- 100 files: ~1 second (metadata only)
- 1,000 files: ~10 seconds (metadata only)
- 10,000 files: ~2 minutes (metadata only)

**With Deep Analysis (Selective):**
- 10 contracts analyzed: ~30 seconds (parallel processing)
- 50 images analyzed: ~2 minutes (parallel, Vision API)
- 100 audio files (basic metadata): ~10 seconds
- 100 audio files (full analysis): ~10 minutes

**Optimization Strategies:**
1. **Parallel processing** — Analyze multiple files concurrently (limit: 5-10 concurrent)
2. **Batch API calls** — Group Drive API requests
3. **Incremental indexing** — Only process new/changed files
4. **Background jobs** — Deep analysis in background, don't block user
5. **Caching** — Store analyzed content indefinitely, re-analyze only if modified
6. **Smart triggers** — Only deep-analyze files that matter (contracts, invoices)

### Storage Considerations

**Database Growth:**
- 1,000 files = ~1 MB of metadata (including JSONB)
- 10,000 files = ~10 MB
- 100,000 files = ~100 MB (manageable)

**Temp File Storage:**
- Downloaded PDFs cached for 24 hours
- Max cache size: 10 GB (auto-cleanup oldest first)
- Only download files being analyzed

**Drive API Quotas:**
- Free tier: 20,000 requests/day (sufficient for most users)
- Paid tier: 100,000+ requests/day
- Change notifications: Unlimited (push-based, no polling)

---

## User Experience Scenarios

### Scenario 1: New Contract Arrives via Email

**Flow:**
1. Email arrives: "Signed contract attached"
2. Worker classifies email as LEGAL/Contract_Executed
3. Worker extracts attachment: `contract_fabric_signed.pdf`
4. Automation rule triggers:
   - "When LEGAL/Contract_* email arrives, file attachment to Drive and analyze"
5. Actions execute:
   - Upload attachment to `/Projects/Asian Tour 2026/Contracts/`
   - Trigger deep analysis (extract parties, dates, fees)
   - Create timeline item: "Fabric show confirmed - 2026-05-10"
   - Create tasks: "Submit rider by 2026-04-15", "Submit artwork by 2026-04-20"
   - Create approval: "Review contract terms"
6. Oran sees in Project Hub:
   - New file in Files tab (categorized as "Contracts")
   - New timeline item in Timeline Studio
   - New tasks in Tasks tab
   - New approval in Approvals tab
   - All linked to original email

**Oran's Actions:**
- Reviews approval (sees contract summary with key terms extracted)
- Approves (or requests changes)
- Marks tasks as delegated to team members
- Done in 2 minutes instead of 20 minutes of manual data entry

### Scenario 2: Oran Uploads Artwork to Drive

**Flow:**
1. Oran uploads 3 files to Drive:
   - `/Projects/SHEE Release/Artwork/SHEE_Cover_3000x3000.png`
   - `/Projects/SHEE Release/Artwork/SHEE_Banner_1500x500.png`
   - `/Projects/SHEE Release/Artwork/SHEE_Social_1080x1080.png`
2. Drive change notification triggers
3. Worker receives notification for each file
4. For each file:
   - Index metadata (name, size, modified date)
   - Categorize as "Artwork" (path + mime type)
   - Extract tags: "SHEE", "artwork", auto-detect type from dimensions
5. Automation rule triggers:
   - "When artwork added to release project, check artwork completion"
6. Actions execute:
   - Check required artwork types: Cover (✓), Banner (✓), Social (✓), Press Photo (✗)
   - Update release checklist: 3/4 artwork types complete
   - Create task: "Add press photo for SHEE release"
   - Update timeline item: "Artwork delivery" progress 75%
7. Oran sees in Project Hub:
   - Files appear in Files tab immediately
   - Checklist updated in Overview tab
   - New task in Tasks tab
   - Timeline shows 75% complete

**Oran's Actions:**
- Sees clear status: "3 out of 4 artwork types ready"
- Knows exactly what's missing: press photo
- Uploads press photo
- Checklist auto-completes, timeline item marked done
- No manual tracking needed

### Scenario 3: Finding Old Contracts

**Flow:**
1. Oran needs to find Fabric contract from 2024 (2 years ago)
2. Goes to `/projects/{asian-tour-2024}/files`
3. Searches: "Fabric contract"
4. Search looks for:
   - Filename contains "Fabric" AND "contract"
   - Category = "Contracts"
   - Tags include "Fabric"
   - Content summary contains "Fabric" (if analyzed)
5. Results:
   - `Contract - Fabric - 2024-05-10 - Signed.pdf` (categorized, tagged, analyzed)
6. Oran clicks file:
   - Opens preview modal
   - Shows extracted metadata: parties, dates, fee, terms
   - Shows related emails (2 emails discussing this contract)
   - Shows related timeline items (the show itself)
   - "Open in Drive" button (opens in new tab)
7. Oran finds contract in 10 seconds instead of 10 minutes of Drive folder digging

### Scenario 4: Release Readiness Check

**Flow:**
1. Oran creating project: "SHEE Release - April 2026"
2. Connects Drive folder: `/Releases/SHEE/`
3. System indexes 47 files:
   - 12 audio files (WAVs, MP3s)
   - 8 artwork files
   - 3 press materials (EPK, bio, one-sheet)
   - 24 other files (project files, notes, etc.)
4. Automation rule: "Release Readiness Checker"
5. Actions:
   - Build Track Report:
     - Master WAV (✓)
     - Radio Edit MP3 (✓)
     - Stems (✓ 8 files)
     - Cover artwork 3000x3000 (✓)
     - Press photo (✗ missing)
     - EPK (✓)
     - BPM/Key metadata (✓ extracted from audio)
   - Create release checklist with status
   - Create timeline items for missing items
6. Oran sees in Project Hub → Overview:
   - "Release Readiness: 90% complete"
   - Green checkmarks for complete items
   - Red X for missing press photo
   - Task: "Upload press photo by 2026-03-15"
7. Oran uploads press photo
8. Checklist auto-updates to 100%
9. Timeline item "Release ready" marked done

**Value:**
- Oran knows exactly what's ready and what's missing
- No manual checklist tracking
- No chance of forgetting key deliverables
- Automated from Drive file structure

---

## Implementation Phases

### Phase 1: Metadata Indexing (Week 1-2)
**Goal:** Index Drive files without deep analysis

**Tasks:**
1. Set up Google Drive OAuth integration
2. Build Drive API client wrapper
3. Create `drive_files` table and indexes
4. Build worker job: `index_drive_folder`
5. Implement change notifications (webhooks)
6. Build Files Tab UI in Project Hub:
   - File tree view
   - List view with search/filter/sort
   - Connect Drive folder button
7. Test with 1,000+ files

**Success Metric:** Index 1,000 files in < 10 seconds

### Phase 2: Smart Categorization (Week 3)
**Goal:** Auto-categorize files without AI

**Tasks:**
1. Define category taxonomy (11 categories)
2. Build rule engine (path patterns, filename patterns, mime type)
3. Implement auto-tagging (extract dates, venues, versions)
4. Add confidence scoring
5. Update Files Tab UI to show categories and tags
6. Add "Recategorize" button for user overrides
7. Test categorization accuracy (target: 85%+ correct)

**Success Metric:** 85% of files correctly categorized automatically

### Phase 3: Deep Analysis (Week 4-5)
**Goal:** Selective content extraction for key file types

**Tasks:**
1. Build PDF text extraction (pdf-parse or Google Document AI)
2. Create structured prompts for OpenAI:
   - Contract analysis
   - Invoice analysis
   - Itinerary analysis
3. Implement action: "Deep analyze file"
4. Update Files Tab to show "Analyze" button and display extracted data
5. Add "Re-analyze" button for user-triggered updates
6. Test with 20 sample contracts, invoices, itineraries

**Success Metric:** Extract 90%+ of key fields from contracts

### Phase 4: File-Email Linking (Week 6)
**Goal:** Auto-suggest and manual link files to emails

**Tasks:**
1. Build suggestion engine:
   - When email with attachment arrives, suggest Drive folder
   - When Drive file added, search for related emails
2. Create `asset_links` table (or reuse existing)
3. Update Email view to show linked Drive files
4. Update Files Tab to show related emails
5. Add "Link to Email" button with email search modal
6. Test suggestion accuracy (target: 70%+ confidence)

**Success Metric:** 70% of file-email suggestions accepted by user

### Phase 5: Automation Rule Integration (Week 7-8)
**Goal:** Trigger automation rules based on Drive files

**Tasks:**
1. Add file-based trigger types to automation rules:
   - File added
   - File modified
   - File matches pattern
2. Add file-based actions:
   - Upload attachment to Drive
   - Create folder
   - Move/rename file
   - Tag file
   - Link file to email/timeline
3. Create 5 template automation rules:
   - Contract auto-processor
   - Invoice tracker
   - Artwork completion checker
   - Audio file to track report
   - Itinerary parser
4. Test end-to-end flows
5. Document templates

**Success Metric:** 5 file-based automation templates working end-to-end

---

## Cost Analysis

### Drive API Costs
- **Metadata indexing:** Free (within free tier quotas)
- **Change notifications:** Free (push-based)
- **File downloads:** Free (within Drive storage limits)

### AI Analysis Costs (OpenAI)

**Per-File Costs:**
- Contract analysis: ~$0.05 (50KB text → GPT-4)
- Invoice analysis: ~$0.02 (20KB text → GPT-4)
- Itinerary analysis: ~$0.03 (30KB text → GPT-4)
- Image analysis: ~$0.01-0.05 (Vision API)
- Audio metadata: Free (local libraries)
- Audio advanced: ~$0.001-0.01 (Essentia or third-party)

**Monthly Costs (Estimated):**

**Conservative Scenario (Oran only):**
- 50 contracts/month → $2.50
- 20 invoices/month → $0.40
- 10 itineraries/month → $0.30
- 10 images/month → $0.20
- **Total: ~$3.40/month**

**High Usage Scenario (Multiple users):**
- 200 contracts/month → $10
- 100 invoices/month → $2
- 50 itineraries/month → $1.50
- 50 images/month → $1
- **Total: ~$14.50/month**

**Very manageable costs, especially since analysis is selective (only key files).**

---

## Key Design Principles

### 1. Lazy Analysis
**Don't analyze every file eagerly. Analyze only when:**
- Automation rule requires it
- User explicitly requests it
- File type strongly benefits from it (contracts, invoices)

### 2. Metadata First
**Fast, cheap metadata indexing enables:**
- Quick search (by name, path, date)
- Smart categorization (pattern matching)
- File discovery (tree/list views)
- Link suggestions (filename matching)

**Deep content analysis is a premium feature for select files.**

### 3. Incremental Updates
**Don't re-index everything on every change:**
- Use Drive change notifications (push-based)
- Only update changed files
- Re-analyze only if file content changed (check modified_at)

### 4. User Control
**Let Oran decide depth:**
- Default: Metadata only (fast, free)
- Selective: Auto-analyze contracts/invoices (useful, cheap)
- On-demand: User clicks "Analyze" (flexible, rare)
- Custom rules: Oran defines what to deep-analyze (powerful)

### 5. Smart Defaults, Easy Overrides
**Auto-categorize but allow manual changes:**
- System categorizes based on patterns
- User can recategorize with one click
- User feedback improves categorization (future: learning)

---

## Conclusion

**The Strategy:**
1. **Metadata indexing** (Tier 1) — Fast, free, always on → Enables search, filtering, basic organization
2. **Pattern-based categorization** (Tier 2) — Fast, free, high accuracy → Enables smart organization without AI
3. **Selective deep analysis** (Tier 3) — Slow, paid, high value → Extracts critical data from key files only

**The Result:**
- Oran connects Drive folder → Files indexed in seconds
- Files auto-categorized with 85%+ accuracy → Easy browsing
- Key files (contracts, invoices) auto-analyzed → Structured data extracted
- Files auto-linked to emails and timeline items → Context everywhere
- Automation rules trigger based on file events → Zero manual data entry
- Total cost: ~$3-15/month for AI analysis → Negligible

**This approach scales:**
- 100 projects × 200 files each = 20,000 files
- Metadata indexing: ~3 minutes total
- Deep analysis: Only ~500 files (2.5%) → ~$25/month
- Fast, useful, affordable

**Oran gets:**
- Organized Drive files without manual tagging
- Auto-extracted contract terms, due dates, fees
- Automatic task creation from deadlines
- File-to-email linkage for context
- Zero manual data entry

**You avoid:**
- Analyzing every file (expensive, slow, unnecessary)
- Re-indexing everything on every change (inefficient)
- Building a monolithic file understanding system (overkill)

This is the **smart, scalable path** to Drive integration.
