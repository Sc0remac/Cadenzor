# Kazador Pivot Plan: From Bespoke to Configurable Shell

**Document Version:** 1.0
**Date:** October 2025
**Purpose:** Strategic pivot from developer-driven customization to user-driven configuration

---

## Executive Summary

### The Problem
Kazador is currently being built with hardcoded logic for priorities, playbooks, lane assignments, and automation rules. Every time Oran (the primary user) wants to adjust how urgent a legal email is, or change what happens when a booking offer arrives, it requires developer intervention. This creates a bottleneck and prevents rapid iteration based on real-world usage.

### The Solution
Transform Kazador from a bespoke application into a **configurable shell** where Oran can:
- Define his own priority weights via sliders and inputs
- Create automation rules through a visual rule builder (no code required)
- Customize timeline lanes and categories to match his workflow
- Clone and modify pre-built templates for common scenarios
- Experiment and iterate without waiting for developer changes

### Core Philosophy
**Configuration over Code** — Shift from "I build features for Oran" to "I build a framework Oran uses to build his own features."

### Expected Outcomes
- **80% reduction in feature requests** — Oran self-configures most needs
- **Faster iteration cycles** — Test different priority weights and automation rules in minutes, not days
- **Cleaner codebase** — Generic automation engine replaces dozens of hardcoded playbooks
- **User empowerment** — Oran becomes his own product manager
- **Scalability** — Future users can configure the system for their own workflows without forking the codebase

---

## Current State Analysis

### What Works Today
1. **Email Triage Pipeline**
   - Gmail integration fetches unread messages
   - OpenAI classifies emails into 40+ categories (LEGAL/Contract_Draft, FINANCE/Settlement, BOOKING/Offer, etc.)
   - Heuristic fallback when AI fails
   - Gmail labels applied automatically
   - Contact enrichment on every email
   - Summary caching to avoid re-processing

2. **Project Hubs**
   - Projects as top-level containers with tabs: Overview, Timeline, Inbox, Tasks, Files, People, Approvals, Settings
   - Email-to-project suggestion engine
   - Approvals workflow for linking emails to projects
   - Template-based project creation (Tour Leg, Single Release, Festival Weekend)

3. **Timeline Studio**
   - Multi-lane visual timeline (Live, Promo, Writing, Brand, Release)
   - Dependencies between items (finish-to-start, start-to-start)
   - Conflict detection (overlapping events, travel buffer violations)
   - Priority scores computed per item

4. **Priority Engine**
   - Scoring algorithm combining: category severity, date proximity, manual priority, conflicts, email age, triage state
   - Top actions computed per project
   - Today digest showing highest-priority items

5. **Worker Jobs**
   - Email classification batch job
   - Project metrics computation
   - Approval suggestion queuing
   - Digest generation

### Critical Gaps
1. **Hardcoded Priorities**
   - All category weights are constants in code (LEGAL/Contract_Executed = 95, FINANCE/Settlement = 88, etc.)
   - Age multipliers, conflict penalties, and other scoring factors are fixed
   - Changing any weight requires code change, test, and deploy

2. **No Playbook Execution**
   - Playbooks are extensively documented (Booking Offer Handler, Promo Request Handler, Legal Summary, etc.)
   - But zero implementation — all manual
   - No draft reply generation, no folder scaffolding, no slot proposals
   - Classification suggests actions but never executes them

3. **Fixed Lane Structure**
   - Timeline lanes are hardcoded: Live, Promo, Writing, Brand, Release
   - Cannot add custom lanes (e.g., "Finance", "Legal", "Brand Partnerships")
   - Auto-assignment logic is baked into code

4. **No User-Driven Automation**
   - No way for Oran to define "When this type of email arrives, do these actions"
   - Every automation scenario requires custom development
   - Cannot experiment with different workflows

### Strategic Insight
The STRATEGIC_INNOVATION.md document identified this as **Gap 3: Hardcoded Priority Config** — the biggest blocker to production readiness. Quote:

> "Instead of dev-tuning priorities, **let Oran configure them**: Store category weights in DB; UI with sliders for each category; Playbooks become threshold-based. Reduces dev work, increases flexibility."

---

## The Pivot: Three-Layer Abstraction

### Layer 1: Priority Configuration System
**Problem:** Priorities are hardcoded constants
**Solution:** User-editable configuration stored in database, exposed via settings UI

### Layer 2: Automation Rule Engine
**Problem:** Playbooks exist in docs but not in code
**Solution:** Visual rule builder where users define trigger conditions and actions

### Layer 3: Customizable Workspace Structure
**Problem:** Lanes, categories, and templates are fixed
**Solution:** User-defined lanes, categories, and reusable templates

---

## Phase 1: Priority Configuration System

### Goal
Enable Oran to adjust all priority weights, age multipliers, and scoring parameters through a settings interface without touching code.

### Success Criteria
- Oran changes a category weight from 80 to 95 and sees inbox priority scores update immediately
- Oran adjusts age urgency multiplier from 1.5 to 2.0 and older emails bubble up
- Priority engine loads all weights from database, not from code constants
- Changes persist across sessions and worker runs

### Components to Build

#### 1.1 Database Schema Extension
**What:** Extend the `user_preferences` table to store priority configuration

**Fields to Add:**
- `priority_config` — JSONB column containing:
  - `category_weights` — Map of category name to weight (0-100)
    - Example: `{"LEGAL/Contract_Executed": 95, "LEGAL/Contract_Draft": 90, "FINANCE/Settlement": 88, ...}`
  - `age_multipliers` — Map of entity type to multiplier
    - Example: `{"email": 1.5, "task": 1.0, "timeline_item": 1.2}`
  - `conflict_penalty` — Numeric value for calendar conflict penalty (default: 25)
  - `manual_priority_weight` — How much manual priority overrides computed priority (0.0-1.0, default: 0.3)
  - `dependency_blocking_boost` — Boost for items blocking others (default: 15)
  - `cross_label_boosts` — Map of cross-labels to priority boosts
    - Example: `{"risk/high_urgency": 20, "approval/required": 15, "confidential/yes": 10}`

**Migration Steps:**
1. Add the new JSONB column with default empty object
2. Seed current user preferences with existing hardcoded values from code
3. Create index on `user_id` for fast lookups
4. Add validation constraints to ensure weights are 0-100

#### 1.2 Settings UI: Priority Configuration Page
**Location:** `/settings/priorities`

**Sections to Build:**

**Section A: Category Weights**
- Display all 40+ primary categories from taxonomy
- Each category shows:
  - Category name and description (e.g., "LEGAL/Contract_Executed — Fully signed contracts and addenda")
  - Slider control (range: 0-100)
  - Current value display (numeric)
  - Reset to default button (per category)
- Group categories by prefix (LEGAL, FINANCE, LOGISTICS, BOOKING, PROMO, ASSETS, FAN, MISC)
- Search/filter bar to quickly find categories
- Visual indicator showing relative urgency (red = high, yellow = medium, green = low)

**Section B: Age & Time Settings**
- Email age urgency multiplier (numeric input, default: 1.5)
  - Help text: "How much more urgent an email becomes per day it sits unread"
- Task age urgency multiplier (numeric input, default: 1.0)
- Timeline item proximity boost (numeric input, default: 1.2)
  - Help text: "Boost priority for items happening soon"
- Overdue penalty multiplier (numeric input, default: 2.0)
  - Help text: "Extra urgency for past-due items"

**Section C: Conflict & Dependency Settings**
- Calendar conflict penalty (numeric input, default: 25)
  - Help text: "Priority deduction for items with scheduling conflicts"
- Dependency blocking boost (numeric input, default: 15)
  - Help text: "Priority increase for items blocking other tasks"
- Travel buffer violation penalty (numeric input, default: 20)
  - Help text: "Penalty for events with insufficient travel time between them"

**Section D: Cross-Label Priority Boosts**
- List of cross-label prefixes (risk/, approval/, confidential/, status/, etc.)
- Each label shows slider for boost amount (0-50)
- Add custom cross-label button (for future labels Oran defines)

**Section E: Manual Priority Weight**
- Slider (0.0-1.0, default: 0.3)
- Help text: "How much manually set priority overrides computed priority. 0.0 = ignore manual, 1.0 = manual only"

**Section F: Presets & Actions**
- Preset buttons:
  - "Release Week" — Boosts PROMO/ and ASSETS/ categories, reduces BOOKING/
  - "Touring Season" — Boosts BOOKING/ and LOGISTICS/, reduces PROMO/
  - "Off Season" — Balanced weights
  - "Legal Focus" — Boosts all LEGAL/ categories
- Save button (stores to database)
- Reset all to defaults button (with confirmation)
- Export configuration button (download JSON)
- Import configuration button (upload JSON)

**User Flow:**
1. Oran goes to `/settings/priorities`
2. Sees current weights loaded from database
3. Adjusts "LEGAL/Contract_Draft" from 90 to 95 using slider
4. Clicks "Save Configuration"
5. System updates database and invalidates priority cache
6. Next time priority engine runs, it uses new weight
7. Inbox view refreshes showing updated priority scores

#### 1.3 API Endpoints
**Endpoint 1: Get Priority Configuration**
- Method: GET
- Path: `/api/user/priority-config`
- Response: Current user's priority configuration object
- Use case: Settings page loads current config on mount

**Endpoint 2: Update Priority Configuration**
- Method: PUT
- Path: `/api/user/priority-config`
- Body: Complete priority configuration object
- Validation: Ensure weights are 0-100, multipliers are positive, no invalid fields
- Response: Updated configuration + success message
- Use case: Settings page saves changes

**Endpoint 3: Reset Priority Configuration**
- Method: POST
- Path: `/api/user/priority-config/reset`
- Body: Optional list of specific categories to reset (or empty for full reset)
- Response: Default configuration
- Use case: "Reset to defaults" button

**Endpoint 4: Get Priority Presets**
- Method: GET
- Path: `/api/user/priority-config/presets`
- Response: List of preset configurations (Release Week, Touring Season, etc.)
- Use case: Load preset options

**Endpoint 5: Apply Priority Preset**
- Method: POST
- Path: `/api/user/priority-config/presets/:presetName`
- Response: Updated configuration
- Use case: User clicks "Release Week" preset button

#### 1.4 Priority Engine Refactor
**Current State:** Priority engine loads hardcoded constants from `shared/src/projectPriority.ts`

**Target State:** Priority engine loads configuration from database per user

**Changes Required:**

**Step 1: Configuration Loader**
- Add function to load user's priority config from database
- Cache configuration in memory with TTL (5 minutes)
- Invalidate cache when user saves changes
- Fall back to default configuration if user has no custom config

**Step 2: Update Scoring Functions**
- Replace every hardcoded constant with config value
- Example changes:
  - OLD: `const categoryWeight = CATEGORY_SEVERITY_WEIGHTS[email.category] ?? 40;`
  - NEW: `const categoryWeight = userConfig.category_weights[email.category] ?? 50;`
  - OLD: `const ageUrgency = ageInDays * 1.5;`
  - NEW: `const ageUrgency = ageInDays * userConfig.age_multipliers.email;`
  - OLD: `const conflictPenalty = 25;`
  - NEW: `const conflictPenalty = userConfig.conflict_penalty;`

**Step 3: Update Function Signatures**
- Add `userConfig: PriorityConfig` parameter to all priority functions
- Update call sites in worker and API routes to load config first

**Step 4: Priority Computation Flow**
```
1. Worker/API receives email or task
2. Load user's priority configuration from database (with cache)
3. Pass configuration to priority scoring function
4. Compute priority using user's weights
5. Store priority score in database
6. Return score + rationale
```

**Step 5: Rationale Generation**
- Priority engine currently generates rationale strings like "+22", "Due in 3d (+18)"
- Update rationale to show which config values were used
- Example: "Category weight: 95 (LEGAL/Contract_Draft), Age: 2 days (+15), Manual override: +10"

#### 1.5 Testing Strategy
**Unit Tests:**
- Test priority engine with different configurations
- Verify category weight changes affect scores correctly
- Verify age multipliers work as expected
- Verify conflict penalties apply correctly

**Integration Tests:**
- Load config from database
- Update config via API
- Verify worker picks up new config after cache invalidation
- Verify inbox reorders after config change

**User Acceptance Tests:**
- Oran adjusts weight and verifies score changes
- Oran applies preset and verifies multiple categories update
- Oran exports config, resets, and imports to restore

---

## Phase 2: Automation Rule Engine

### Goal
Enable Oran to create "when this happens, do that" automation rules through a visual interface, replacing hardcoded playbooks with user-defined workflows.

### Success Criteria
- Oran creates a rule: "When email category is LEGAL/Contract_*, strip PII and create approval task"
- Rule executes automatically on next matching email
- Oran can disable, edit, or delete rules without code changes
- Rule execution is auditable (logs showing what happened when)
- Rules can trigger multiple actions in sequence

### Components to Build

#### 2.1 Database Schema: Automation Rules
**New Table: `automation_rules`**

**Purpose:** Store user-defined automation rules

**Columns:**
- `id` — UUID primary key
- `user_id` — UUID reference to auth.users(id)
- `name` — Text, user-friendly name (e.g., "Legal Contract Handler")
- `description` — Text, optional longer explanation
- `trigger_conditions` — JSONB, the conditions that must be met
- `actions` — JSONB, ordered list of actions to perform
- `enabled` — Boolean, whether rule is active (default: true)
- `priority` — Integer, execution order if multiple rules match (default: 0)
- `created_at` — Timestamp with timezone
- `updated_at` — Timestamp with timezone
- `last_triggered_at` — Timestamp with timezone, when rule last ran
- `execution_count` — Integer, how many times rule has run

**Indexes:**
- Index on `(user_id, enabled, priority)` for fast rule lookup
- Index on `user_id` for user dashboard queries
- Index on `enabled` for active rules filtering

**Trigger Conditions Structure (JSONB):**
```
Logical operators: "all" (AND), "any" (OR), "none" (NOT)

Example 1: Simple condition
{
  "all": [
    {"field": "category", "operator": "starts_with", "value": "LEGAL/"}
  ]
}

Example 2: Complex condition
{
  "all": [
    {"field": "category", "operator": "starts_with", "value": "LEGAL/"},
    {"field": "priority_score", "operator": "gt", "value": 70},
    {
      "any": [
        {"field": "labels.risk", "operator": "eq", "value": "high_urgency"},
        {"field": "from_email", "operator": "contains", "value": "@lawfirm.com"}
      ]
    }
  ]
}

Example 3: Exclusion condition
{
  "all": [
    {"field": "category", "operator": "eq", "value": "BOOKING/Offer"},
    {"none": [
      {"field": "subject", "operator": "contains", "value": "spam"}
    ]}
  ]
}
```

**Supported Operators:**
- `eq` — Equals
- `ne` — Not equals
- `gt` — Greater than
- `gte` — Greater than or equal
- `lt` — Less than
- `lte` — Less than or equal
- `contains` — String contains substring (case-insensitive)
- `starts_with` — String starts with prefix
- `ends_with` — String ends with suffix
- `matches_regex` — String matches regular expression
- `in` — Value is in list
- `not_in` — Value is not in list

**Supported Fields:**
- `category` — Email category (LEGAL/Contract_Draft, etc.)
- `subject` — Email subject line
- `from_email` — Sender email address
- `from_name` — Sender name
- `body` — Email body text (use sparingly, expensive)
- `priority_score` — Computed priority score
- `received_at` — When email arrived
- `labels.*` — Any cross-label (e.g., `labels.risk`, `labels.territory`)
- `project_id` — Associated project ID (if linked)
- `has_attachments` — Boolean, whether email has attachments
- `attachment_count` — Number of attachments
- `is_reply` — Boolean, whether email is a reply
- `thread_length` — Number of messages in thread

**Actions Structure (JSONB):**
```
Ordered array of actions to perform sequentially

Example:
[
  {
    "type": "strip_pii",
    "config": {}
  },
  {
    "type": "generate_report",
    "config": {
      "template": "legal_summary",
      "store_in": "email_metadata"
    }
  },
  {
    "type": "create_timeline_item",
    "config": {
      "lane": "Legal",
      "title_template": "Review contract: {{subject}}",
      "starts_at": "now",
      "duration_days": 7
    }
  },
  {
    "type": "create_approval",
    "config": {
      "type": "legal_review",
      "approver_role": "admin",
      "message_template": "New contract requires review: {{subject}}"
    }
  },
  {
    "type": "notify",
    "config": {
      "channel": "email",
      "to": "legal@example.com",
      "subject_template": "New contract: {{subject}}",
      "body_template": "Please review attached contract."
    }
  }
]
```

**Supported Action Types:**
1. **strip_pii** — Remove personally identifiable information from email body
2. **generate_report** — Use AI to generate summary report
3. **create_timeline_item** — Add item to project timeline
4. **create_task** — Create task in project
5. **create_approval** — Queue approval for user review
6. **draft_reply** — Generate draft email response (never auto-send)
7. **notify** — Send notification (email, Slack, webhook)
8. **attach_to_project** — Link email to project
9. **apply_label** — Add cross-label to email
10. **set_priority** — Override priority score
11. **snooze** — Snooze email until specified time
12. **create_folder** — Create Drive folder structure
13. **file_attachment** — Move email attachment to Drive folder
14. **extract_entities** — Parse structured data (dates, amounts, venues)
15. **wait** — Pause before next action (for throttling)

**New Table: `automation_rule_executions`**

**Purpose:** Audit log of rule executions

**Columns:**
- `id` — UUID primary key
- `rule_id` — UUID reference to automation_rules(id)
- `email_id` — Text reference to emails(id)
- `executed_at` — Timestamp with timezone
- `status` — Text (success, partial_success, failed)
- `actions_performed` — JSONB, list of actions that completed
- `actions_failed` — JSONB, list of actions that failed with error messages
- `duration_ms` — Integer, how long execution took
- `context` — JSONB, snapshot of email data at execution time

#### 2.2 Automation Rule Builder UI
**Location:** `/settings/automations`

**Main Page: Rule List View**

**Display Elements:**
- Page header: "Automation Rules"
- "Create New Rule" button (primary action)
- List of existing rules in cards/table:
  - Rule name and description
  - Status indicator (enabled/disabled toggle)
  - Last triggered timestamp
  - Execution count
  - Quick action buttons: Edit, Duplicate, Delete, View Logs
- Filter controls:
  - Filter by status (All, Enabled, Disabled)
  - Filter by trigger type (Email category, Priority, Label, etc.)
  - Search by name or description
- Sort controls:
  - Sort by priority (execution order)
  - Sort by creation date
  - Sort by last triggered
  - Sort by execution count

**Empty State:**
- Message: "No automation rules yet. Create your first rule to automate repetitive workflows."
- "Browse Templates" button
- "Create New Rule" button

**Location:** `/settings/automations/new` (Create Mode)
**Location:** `/settings/automations/:ruleId/edit` (Edit Mode)

**Page Structure:**

**Section 1: Rule Basics**
- Name input (required)
- Description textarea (optional)
- Enabled toggle (default: enabled)
- Priority input (default: 0, help text: "Lower numbers run first if multiple rules match")

**Section 2: Trigger Builder**

**Visual Representation:**
- Tree-like structure showing logical conditions
- Drag-and-drop interface for reordering conditions
- Add condition buttons for "AND", "OR", "NOT" groups

**Condition Editor:**
- Field selector (dropdown):
  - Category
  - Subject
  - From email
  - From name
  - Priority score
  - Received at
  - Labels (expandable tree)
  - Project ID
  - Has attachments
  - Custom fields
- Operator selector (changes based on field type):
  - Text fields: equals, contains, starts with, ends with, matches regex
  - Number fields: equals, greater than, less than, between
  - Boolean fields: is true, is false
  - Date fields: before, after, between, within last X days
- Value input (changes based on field type):
  - Text input for strings
  - Number input for numbers
  - Date picker for dates
  - Toggle for booleans
  - Multi-select for enums (categories)

**Example Visual Flow:**
```
Trigger when ALL of the following are true:
  ✓ Email category starts with "LEGAL/"
  ✓ Priority score is greater than 70
  ✓ ANY of the following are true:
      ✓ Label "risk" equals "high_urgency"
      ✓ From email contains "@lawfirm.com"

[+ Add AND condition] [+ Add OR condition] [+ Add NOT condition]
```

**Section 3: Actions Builder**

**Visual Representation:**
- Ordered list of actions (numbered steps)
- Drag handles to reorder actions
- Expandable cards for each action showing configuration

**Action Selector:**
- Dropdown or card grid showing available action types
- Each action type shows:
  - Name and icon
  - Short description
  - Example use case

**Action Configuration:**
Each action type has its own configuration form:

**Action: Strip PII**
- No configuration needed
- Shows warning: "This will redact sensitive information from email body"

**Action: Generate Report**
- Template selector (dropdown):
  - Legal summary
  - Finance summary
  - Booking details
  - Custom template
- Custom template input (if custom selected)
- Output destination:
  - Email metadata
  - Separate document
  - Attach to timeline item

**Action: Create Timeline Item**
- Lane selector (dropdown of user's lanes)
- Title template (text input with variable placeholders):
  - Available variables: `{{subject}}`, `{{from_name}}`, `{{date}}`, `{{venue}}`, etc.
  - Example: "Review contract: {{subject}}"
- Start date:
  - Now
  - Date from email (extracted)
  - Specific date (date picker)
  - Relative (X days from now)
- Duration (number of days)
- Status (dropdown: planned, confirmed, tentative)
- Project selector (if multiple projects)

**Action: Create Approval**
- Approval type (dropdown: legal review, finance review, general)
- Approver role (dropdown: admin, manager, owner)
- Message template (textarea with variables)
- Timeout (optional, number of days before auto-decline)

**Action: Draft Reply**
- Reply tone (dropdown: professional, friendly, formal, brief)
- Include context (checkboxes):
  - Original email
  - Related timeline items
  - Project information
- Template (dropdown or custom):
  - Acknowledgement
  - Request more info
  - Decline politely
  - Accept with conditions
  - Custom
- Custom template (textarea if custom selected)

**Action: Notify**
- Channel selector (dropdown):
  - Email
  - Slack
  - Webhook
  - In-app notification
- Recipient configuration (based on channel):
  - Email: email address input
  - Slack: channel selector
  - Webhook: URL input
- Message template (with variables)

**Action: Attach to Project**
- Project selector (dropdown or auto-detect rules):
  - Specific project (dropdown)
  - Auto-detect based on labels
  - Suggest to user (creates approval instead)
- Confidence threshold (slider: 0-100)

**Example Visual Flow:**
```
Actions to perform (in order):

1. Strip PII ⚠️
   Remove sensitive information from email body
   [Configure] [Remove]

2. Generate Report 📄
   Template: Legal summary
   Output: Email metadata
   [Configure] [Remove]

3. Create Timeline Item 📅
   Lane: Legal
   Title: Review contract: {{subject}}
   Start: Now
   Duration: 7 days
   [Configure] [Remove]

4. Create Approval ✅
   Type: Legal review
   Approver: Admin
   Message: New contract requires review: {{subject}}
   [Configure] [Remove]

[+ Add Action]
```

**Section 4: Test Mode**

**Purpose:** Preview what the rule would do without actually executing

**Elements:**
- "Test Rule" button
- Sample email selector:
  - Load from recent emails (dropdown)
  - Paste sample data (textarea)
- Test execution panel:
  - Shows whether trigger conditions match (✓ or ✗ for each condition)
  - Shows which actions would execute
  - Shows what values would be used (with template variable substitution)
  - Shows estimated execution time
  - Shows any warnings (e.g., "This action requires approval")

**Example Output:**
```
Test Results:

✓ Trigger Conditions: MATCH
  ✓ Category "LEGAL/Contract_Draft" starts with "LEGAL/"
  ✓ Priority score 85 is greater than 70
  ✓ Label "risk" equals "high_urgency"

Actions to Execute:

1. ✓ Strip PII
   Would redact: phone numbers, SSN, bank accounts

2. ✓ Generate Report
   Would create legal summary using template
   Estimated cost: $0.05

3. ✓ Create Timeline Item
   Lane: Legal
   Title: "Review contract: Example Contract - ACME Corp"
   Start: 2025-10-11 15:30:00
   Duration: 7 days

4. ✓ Create Approval
   Type: Legal review
   Approver: Oran (admin)
   Message: "New contract requires review: Example Contract - ACME Corp"

⚠️ Note: Test mode does not actually create these items. Click "Save & Enable" to activate rule.
```

**Section 5: Save Actions**
- Save button (stores rule to database)
- Save & Test button (saves and runs test mode)
- Cancel button (discards changes)
- Delete button (if editing existing rule, with confirmation)

#### 2.3 Automation Templates System
**Location:** `/settings/automations/templates`

**Purpose:** Pre-built automation rules users can clone and customize

**Template Categories:**
1. **Legal Workflows** — Contract handling, NDA processing, compliance
2. **Finance Workflows** — Settlement parsing, invoice routing, payment tracking
3. **Booking Workflows** — Offer handling, hold creation, confirmation tracking
4. **Promo Workflows** — Interview requests, press features, asset distribution
5. **Logistics Workflows** — Itinerary parsing, travel coordination, rider management
6. **Asset Workflows** — File organization, asset distribution, version control

**New Table: `automation_templates`**

**Columns:**
- `id` — UUID primary key
- `name` — Text
- `description` — Text
- `category` — Text (legal, finance, booking, promo, logistics, assets)
- `is_system` — Boolean (true for built-in templates, false for user-created)
- `created_by` — UUID reference to auth.users(id), null for system templates
- `template_data` — JSONB (complete rule structure ready to clone)
- `tags` — Text array (for filtering: "advanced", "beginner", "popular")
- `usage_count` — Integer (how many times cloned)
- `created_at` — Timestamp with timezone

**Template Gallery UI:**

**Display:**
- Grid of template cards
- Each card shows:
  - Template name
  - Category badge
  - Short description
  - "Popular" or "Advanced" tags
  - Usage count ("Used 23 times")
  - "Preview" button
  - "Use This Template" button
- Filter sidebar:
  - Filter by category
  - Filter by tags
  - Search by name or description
- Sort options:
  - Most popular
  - Newest
  - Category

**Template Preview Modal:**
- Shows complete rule configuration
- Displays trigger conditions
- Lists all actions with configurations
- Shows example execution flow
- "Use This Template" button
- "Customize First" button (opens in rule builder)

**Template Use Flow:**
1. User clicks "Use This Template"
2. System clones template data to new rule
3. Opens rule in edit mode
4. User can customize name, triggers, actions
5. User saves as their own rule

**Pre-Built System Templates:**

**Template 1: Legal Contract Handler**
- Trigger: Email category starts with "LEGAL/" AND priority > 70
- Actions:
  1. Strip PII
  2. Generate legal summary report
  3. Create timeline item in "Legal" lane
  4. Create approval task for admin
  5. Notify: Email to legal@example.com

**Template 2: Booking Offer Processor**
- Trigger: Email category = "BOOKING/Offer"
- Actions:
  1. Extract entities (venue, date, fee)
  2. Create timeline item in "Live" lane (type: offer)
  3. Attach to relevant project (auto-detect)
  4. Draft reply: "Thank you for the offer..."
  5. Create approval: "Review booking offer"

**Template 3: Finance Settlement Parser**
- Trigger: Email category = "FINANCE/Settlement" OR subject contains "settlement"
- Actions:
  1. Extract amounts and dates
  2. Generate finance summary
  3. Create task: "Review settlement"
  4. Create timeline item in "Finance" lane
  5. Notify: Email to accountant@example.com

**Template 4: Promo Time Request Handler**
- Trigger: Email category = "PROMO/Promo_Time_Request"
- Actions:
  1. Extract requested date and duration
  2. Check timeline for conflicts
  3. Propose 3 alternative slots (if conflicts exist)
  4. Draft reply with slot options
  5. Create tentative hold on timeline
  6. Create approval: "Confirm promo slot"

**Template 5: Assets Request Responder**
- Trigger: Email category starts with "ASSETS/"
- Actions:
  1. Identify requested asset type
  2. Find canonical assets in library
  3. Draft reply with asset links
  4. Log distribution event
  5. Notify: If first time recipient, flag for review

**Template 6: High-Priority Alert**
- Trigger: Priority score > 90 OR label "risk" = "high_urgency"
- Actions:
  1. Create immediate approval
  2. Notify: Slack #urgent-alerts
  3. Notify: Email to manager
  4. Create timeline item with "urgent" status

**Template 7: Project Auto-Linker**
- Trigger: Email contains project name in subject OR from known project contact
- Actions:
  1. Attach to project (auto-detect)
  2. Apply project labels to email
  3. Add to project inbox
  4. Notify project members (if configured)

**Template 8: Logistics Update Processor**
- Trigger: Email category starts with "LOGISTICS/"
- Actions:
  1. Extract itinerary details
  2. Update event checklist items
  3. File attachment to project folder
  4. Create task for missing info
  5. Update timeline item status

#### 2.4 Automation Execution Engine (Worker)
**Location:** `worker/src/automationEngine/`

**Purpose:** Evaluate rules and execute actions when emails arrive

**Core Components:**

**Component 1: Rule Evaluator**

**Functionality:**
- Load all enabled automation rules for user from database
- For each rule, evaluate trigger conditions against email
- Return list of matching rules sorted by priority
- Cache rules in memory with 5-minute TTL

**Condition Evaluation Logic:**
- Support logical operators: AND (all), OR (any), NOT (none)
- Support nested conditions
- Access email fields via dot notation (e.g., `labels.risk`)
- Type-safe comparisons (string vs string, number vs number)
- Handle missing fields gracefully (treat as null/undefined)

**Component 2: Action Executor**

**Functionality:**
- Execute actions sequentially in order defined by rule
- Pass context between actions (e.g., extracted entities from action 1 used in action 2)
- Handle failures gracefully:
  - Continue to next action on non-critical failures
  - Stop execution on critical failures
  - Log all failures for review
- Respect approval gates (never auto-execute sensitive actions)

**Action Handlers:**

**Handler: Strip PII**
- Use regex or AI to identify and redact:
  - Phone numbers
  - Social Security Numbers
  - Bank account numbers
  - Credit card numbers
  - Email addresses (selectively)
- Update email body in database with redacted version
- Log what was redacted (count, not actual values)

**Handler: Generate Report**
- Load report template (pre-defined prompts)
- Call OpenAI API with email context
- Parse structured response
- Store report in email metadata or separate document
- Return report ID for use in subsequent actions

**Handler: Create Timeline Item**
- Parse title template, substitute variables
- Determine start date based on configuration
- Calculate end date from duration
- Assign to lane based on configuration or auto-detect
- Link to email via `ref_table='emails'`, `ref_id=email.id`
- Insert into `timeline_items` table
- Return timeline item ID

**Handler: Create Task**
- Similar to timeline item but inserts into `project_tasks`
- Assign to user if specified
- Set due date
- Link to email

**Handler: Create Approval**
- Insert into `approvals` table
- Set status to "pending"
- Set approver based on role or specific user
- Include payload with email context and proposed action
- Return approval ID

**Handler: Draft Reply**
- Call OpenAI API with:
  - Email context (subject, body, sender)
  - Reply template or tone instructions
  - Related project/timeline context if available
- Generate draft reply
- Store in `email_drafts` table with status "pending"
- Never send automatically (approval required)
- Return draft ID

**Handler: Notify**
- Support multiple channels:
  - **Email:** Use Supabase Edge Functions or SendGrid API
  - **Slack:** Use Slack Webhook API
  - **Webhook:** POST to arbitrary URL
  - **In-app:** Create notification record in database
- Parse message template, substitute variables
- Send notification
- Log delivery status

**Handler: Attach to Project**
- Determine project ID:
  - From configuration (specific project)
  - Auto-detect based on email labels, sender, subject
  - Use project suggestion algorithm
- Insert into `project_email_links` table
- Apply project labels to email
- Create audit log entry
- Return link ID

**Handler: Apply Label**
- Add cross-label to email's `labels` JSONB column
- Update Gmail labels if configured
- Log label application

**Handler: Set Priority**
- Override computed priority score
- Update email priority in database
- Invalidate priority cache
- Log override reason

**Handler: Snooze**
- Set email `triage_state` to "snoozed"
- Set `snoozed_until` timestamp
- Remove from active inbox views
- Schedule un-snooze job

**Handler: Create Folder**
- Use Google Drive API to create folder structure
- Follow template (e.g., `/Projects/{ProjectName}/Contracts/`)
- Store folder ID in `project_sources` or `folders` table
- Return folder ID

**Handler: File Attachment**
- Download email attachment from Gmail API
- Upload to Google Drive folder
- Create record in `assets` table
- Link to email via `asset_links` table
- Return asset ID

**Handler: Extract Entities**
- Use AI or regex to extract:
  - Dates (show dates, deadlines)
  - Venues and locations
  - Amounts and currencies
  - Contact names and roles
- Store in email metadata
- Return extracted entities for use in subsequent actions

**Handler: Wait**
- Pause execution for specified duration
- Use for rate limiting or throttling
- Example: Wait 1 minute between sending multiple emails

**Component 3: Execution Context Manager**

**Purpose:** Pass data between actions in a rule

**Context Object Structure:**
```
{
  email: EmailRecord,
  user: UserRecord,
  config: UserPreferencesRecord,
  project?: ProjectRecord (if auto-detected or specified),
  extractedEntities: Record<string, any>, (populated by extract_entities action)
  createdItems: {
    timeline_item_id?: string,
    task_id?: string,
    approval_id?: string,
    draft_id?: string,
    folder_id?: string,
    asset_ids?: string[]
  },
  metadata: Record<string, any> (custom data passed between actions)
}
```

**Usage:**
- Each action handler receives context as input
- Each action handler can update context with new data
- Subsequent actions can reference context data
- Example: Action 1 extracts venue name, Action 2 uses venue name in timeline item title

**Component 4: Error Handling & Logging**

**Error Types:**
- **Critical Errors:** Stop execution, require user intervention
  - Example: Database connection failure
  - Example: Required field missing in action config
- **Recoverable Errors:** Log warning, continue to next action
  - Example: API rate limit on notification service
  - Example: Project auto-detection failed (skip attach action)
- **Expected Conditions:** Not errors, just different code paths
  - Example: Email doesn't match trigger conditions (no action taken)

**Logging Strategy:**
- Log every rule evaluation (matched or not)
- Log every action execution (success, failure, duration)
- Store in `automation_rule_executions` table
- Include full context snapshot for debugging
- Retention: 90 days

**Component 5: Integration with Email Classification**

**Worker Flow Update:**
```
Current Flow:
1. Fetch unread emails from Gmail
2. Classify each email (category, labels, summary)
3. Write to database
4. Apply Gmail labels

New Flow:
1. Fetch unread emails from Gmail
2. Classify each email (category, labels, summary)
3. Compute priority score
4. Write to database
5. Apply Gmail labels
6. Load user's automation rules
7. Evaluate rules against classified email
8. Execute matching rules' actions
9. Log execution results
```

**Performance Considerations:**
- Evaluate rules in parallel for multiple emails (batch processing)
- Cache rule definitions to avoid repeated database queries
- Limit concurrent action executions (max 5 at a time)
- Timeout individual actions after 30 seconds
- Timeout entire rule execution after 5 minutes

#### 2.5 Execution Logs & Monitoring UI
**Location:** `/settings/automations/:ruleId/logs`

**Purpose:** Show history of rule executions for debugging and auditing

**Display Elements:**
- Filter controls:
  - Date range picker
  - Status filter (All, Success, Partial Success, Failed)
  - Email category filter
- Execution list (table or timeline view):
  - Timestamp
  - Email subject and sender
  - Status icon (✓ success, ⚠️ partial, ✗ failed)
  - Duration
  - Actions completed count
  - "View Details" button
- Summary statistics:
  - Total executions (last 30 days)
  - Success rate (%)
  - Average duration
  - Most common failure reason

**Execution Detail Modal:**
- Email preview (subject, sender, snippet)
- Trigger evaluation results:
  - Each condition with ✓ or ✗
  - Explanation of why rule matched
- Action execution results:
  - List of actions with status
  - Duration per action
  - Output/result data (e.g., "Created timeline item #123")
  - Error messages if failed
- Context snapshot (JSON view)
- "Re-run Rule" button (for testing)

**Global Execution Log:**
**Location:** `/settings/automations/logs`

- Shows executions across all rules
- Same filters and display as per-rule logs
- Additional filter: Rule selector dropdown

#### 2.6 Testing Strategy
**Unit Tests:**
- Test condition evaluator with various operators
- Test each action handler in isolation
- Test error handling (missing fields, API failures)
- Test context passing between actions

**Integration Tests:**
- Load rules from database
- Execute rule on sample email
- Verify actions create expected database records
- Verify error logging works

**End-to-End Tests:**
- Create rule via UI
- Trigger rule with real email
- Verify actions execute
- Check execution log
- Disable rule
- Verify rule no longer executes

**User Acceptance Tests:**
- Oran creates first automation rule
- Oran tests rule in test mode
- Oran enables rule
- Oran verifies rule executes on next matching email
- Oran reviews execution log
- Oran edits rule to adjust triggers
- Oran clones template and customizes

---

## Phase 3: Customizable Workspace Structure

### Goal
Enable Oran to define his own timeline lanes, category groupings, and workspace structure instead of using hardcoded lanes (Live, Promo, Writing, Brand, Release).

### Success Criteria
- Oran creates a new lane called "Finance" and assigns it a color
- Oran sets auto-assignment rules so FINANCE/* emails go to Finance lane
- Oran reorders lanes in his preferred sequence
- Timeline Studio renders custom lanes instead of hardcoded lanes
- Other users can define their own lane structures

### Components to Build

#### 3.1 Database Schema: Lane Definitions
**New Table: `lane_definitions`**

**Purpose:** User-defined timeline lanes

**Columns:**
- `id` — UUID primary key
- `user_id` — UUID reference to auth.users(id)
- `name` — Text, lane name (e.g., "Finance", "Legal", "Travel")
- `description` — Text, optional explanation
- `color` — Text, hex color code (e.g., "#ef4444")
- `icon` — Text, optional icon name or emoji
- `sort_order` — Integer, display order (lower = higher on timeline)
- `auto_assign_rules` — JSONB, rules for auto-assigning items to this lane
- `is_default` — Boolean, whether lane is shown by default
- `created_at` — Timestamp with timezone
- `updated_at` — Timestamp with timezone

**Auto-Assign Rules Structure:**
```
{
  "any": [
    {"field": "category", "operator": "starts_with", "value": "FINANCE/"},
    {"field": "labels.type", "operator": "eq", "value": "finance"}
  ]
}
```

**Pre-Seed System Lanes:**
When user signs up, create default lanes:
1. Live (red, BOOKING/* emails)
2. Promo (blue, PROMO/* emails)
3. Writing (purple, no auto-assign)
4. Brand (green, no auto-assign)
5. Release (orange, no auto-assign)
6. Legal (gray, LEGAL/* emails)
7. Logistics (yellow, LOGISTICS/* emails)

**New Table: `category_groupings`**

**Purpose:** User-defined groupings of email categories for filtering

**Columns:**
- `id` — UUID primary key
- `user_id` — UUID reference to auth.users(id)
- `name` — Text, group name (e.g., "High Priority", "Finance", "Tour Logistics")
- `category_patterns` — Text array, patterns to match (e.g., ["LEGAL/*", "FINANCE/*"])
- `color` — Text, display color
- `sort_order` — Integer
- `created_at` — Timestamp with timezone

#### 3.2 Lane Management UI
**Location:** `/settings/timeline-lanes`

**Page Layout:**

**Section 1: Lane List**
- Table or card list showing all lanes
- Each lane row/card shows:
  - Drag handle (for reordering)
  - Color swatch
  - Icon (if set)
  - Lane name
  - Description
  - Auto-assign rule summary (e.g., "FINANCE/* emails")
  - Item count (how many timeline items in this lane)
  - Default toggle (show by default in timeline)
  - Edit button
  - Delete button (with confirmation, only if no items in lane)
- "Add Lane" button (primary action)

**Section 2: Add/Edit Lane Modal**

**Form Fields:**
- Name input (required, max 50 characters)
- Description textarea (optional)
- Color picker (with preset colors and custom hex input)
- Icon picker:
  - Emoji selector
  - Icon library (if available)
  - Or text input for icon name
- Sort order input (or automatically assigned based on current order)
- Default toggle (show in timeline by default)

**Auto-Assign Rules Builder:**
- Same condition builder as automation rules
- Fields available:
  - Email category
  - Email labels
  - Project ID
  - Item type (event, task, milestone, etc.)
  - Priority score
- Help text: "Items matching these conditions will be automatically assigned to this lane"
- "Test Rules" button to preview which existing items would match

**Section 3: Lane Templates**
- Pre-built lane configurations users can add:
  - "Finance" (red, FINANCE/*)
  - "Legal" (gray, LEGAL/*)
  - "Marketing" (purple, PROMO/*)
  - "Operations" (yellow, LOGISTICS/*)
  - "Artist Development" (green, no auto-assign)
  - "Brand Partnerships" (blue, no auto-assign)

**Section 4: Category Groups**
- List of category groupings
- Each group shows:
  - Name
  - Color
  - Category patterns
  - Edit/Delete buttons
- "Add Group" button

**Add/Edit Group Modal:**
- Name input
- Color picker
- Category pattern builder:
  - Add pattern button
  - Each pattern shows input field with autocomplete from taxonomy
  - Support wildcards (e.g., "LEGAL/*")
- Preview: Shows matching categories

#### 3.3 Timeline Studio Refactor
**Current State:** Timeline Studio has hardcoded lanes

**Target State:** Timeline Studio loads lanes from database per user

**Changes Required:**

**Step 1: Load Lanes from Database**
- On Timeline Studio mount, fetch user's lane definitions
- Sort by `sort_order`
- Filter by `is_default` if user hasn't customized view
- Cache lanes for session duration

**Step 2: Render Dynamic Lanes**
- Replace hardcoded lane list with database lanes
- Use lane color from database for styling
- Show lane icon if set
- Maintain same drag-drop and interaction logic

**Step 3: Lane Filtering**
- Add "Customize Lanes" button in timeline header
- Opens lane selector modal
- User can toggle lanes on/off
- User can reorder lanes (drag-drop)
- Save as view preference

**Step 4: Auto-Assignment**
- When creating timeline item (manually or via automation):
  - Load lane auto-assign rules
  - Evaluate rules against item data (email category, labels, project)
  - Assign to first matching lane
  - If multiple lanes match, use highest priority (lowest sort_order)
  - If no lanes match, assign to default lane or leave unassigned

**Step 5: Lane Color Consistency**
- Use lane color for:
  - Timeline item background
  - Lane header background
  - Category badges in inbox
  - Priority score indicators

#### 3.4 Project Template Enhancement
**Current State:** Project templates seed timeline items but don't specify lanes

**Enhancement:** Allow templates to reference custom lanes

**Template Structure Update:**
```
{
  "name": "Tour Leg",
  "timeline_items": [
    {
      "type": "event",
      "title": "Show 1",
      "lane_pattern": "Live", // matches lane name
      "offset_days": 0,
      "duration_days": 1
    },
    {
      "type": "milestone",
      "title": "Contracts due",
      "lane_pattern": "Legal", // matches lane name
      "offset_days": -14,
      "duration_days": 1
    },
    {
      "type": "task",
      "title": "Send promo pack",
      "lane_pattern": "Promo",
      "offset_days": -7,
      "duration_days": 1
    }
  ]
}
```

**Template Application Logic:**
- When user creates project from template
- Load template timeline items
- For each item, find lane by name pattern
- If lane doesn't exist, prompt user to create it or choose different lane
- Create timeline items with correct lane assignments

#### 3.5 Category Management UI
**Location:** `/settings/categories`

**Purpose:** Allow users to customize email category taxonomy

**Note:** This is advanced functionality, consider Phase 4

**Features:**
- View all 40+ categories
- Enable/disable categories
- Rename categories (custom display names)
- Merge categories (e.g., combine "LEGAL/Contract_Draft" and "LEGAL/Contract_Executed" into "LEGAL/Contracts")
- Add custom categories
- Set category icons and colors

**Use Cases:**
- Oran doesn't care about "FAN/Support_or_Thanks" → disables it
- Oran wants to split "BOOKING/Offer" into "BOOKING/Offer_Festival" and "BOOKING/Offer_Club" → creates custom subcategories
- Oran wants to group all LEGAL/* categories under single "Legal" category for simplicity → creates category group

#### 3.6 Testing Strategy
**Unit Tests:**
- Test lane auto-assignment logic
- Test lane sorting
- Test category pattern matching

**Integration Tests:**
- Create lane via UI
- Verify lane appears in Timeline Studio
- Create timeline item, verify auto-assignment
- Delete lane, verify items remain (orphaned or moved to default)

**User Acceptance Tests:**
- Oran creates "Finance" lane
- Oran sets auto-assign rule for FINANCE/*
- Oran receives finance email
- Worker creates timeline item automatically assigned to Finance lane
- Oran sees item in Finance lane in Timeline Studio
- Oran reorders lanes via drag-drop
- Oran's preferred order persists across sessions

---

## Phase 4: Advanced Features & Polish

### Goal
Add features that make the configurable shell more powerful and user-friendly.

### Components to Build

#### 4.1 Template Marketplace
**Purpose:** Share automation rules and project templates with community

**Features:**
- Public template gallery
- User submissions (with review queue)
- Rating and comments
- Usage statistics
- One-click install

**Use Cases:**
- Oran creates excellent "Booking Offer Handler" rule
- Oran publishes to marketplace
- Other artist managers find and install it
- They customize for their own needs

#### 4.2 Variable System
**Purpose:** User-defined variables for templates and automation rules

**Features:**
- Define custom variables at user/project level
- Use variables in:
  - Email templates
  - Timeline item titles
  - Task descriptions
  - Notification messages
- Examples:
  - `{{manager.name}}` → "Oran"
  - `{{artist.primary}}` → "Barry Cant Swim"
  - `{{project.tour_name}}` → "Asian Tour 2026"

#### 4.3 Conditional Actions
**Purpose:** Execute different actions based on extracted data

**Example:**
```
IF extracted_fee > 5000 THEN
  - Create high-value approval
  - Notify: Slack #high-value-offers
ELSE
  - Create standard approval
  - Notify: Email only
```

#### 4.4 Multi-Step Workflows
**Purpose:** Chain multiple automation rules together

**Example:**
```
Rule 1: "Booking Offer Received"
  → Creates offer record
  → Triggers Rule 2

Rule 2: "Enrich Offer Details"
  → Fetches venue info from database
  → Computes brand-fit score
  → Triggers Rule 3

Rule 3: "Evaluate & Route Offer"
  IF brand_fit_score > 80 THEN
    → Draft acceptance reply
    → Create timeline hold
  ELSE
    → Draft decline reply
```

#### 4.5 Approval Workflows
**Purpose:** Multi-stage approvals with escalation

**Features:**
- Define approval chains (e.g., Manager → Artist → Legal)
- Set timeouts and escalation rules
- Approval delegation
- Approval audit trail

#### 4.6 Batch Operations
**Purpose:** Apply automation rules retroactively

**Features:**
- "Apply rule to existing emails" button
- Preview affected emails before executing
- Batch execution with progress indicator
- Undo capability

#### 4.7 Rule Scheduling
**Purpose:** Run automation rules on schedule, not just on email arrival

**Examples:**
- "Every Monday at 9am, generate weekly digest"
- "Every day at 8am, check for upcoming deadlines and create reminders"
- "Every Friday at 5pm, send summary of week's bookings to artist"

#### 4.8 Custom Actions (Webhooks)
**Purpose:** Integrate with external services

**Features:**
- Webhook action type
- HTTP method, URL, headers, body customization
- Response parsing and storage
- Retry logic

**Use Cases:**
- Send booking offer to external CRM
- Update artist's website with tour dates
- Post to social media when new release announced
- Sync with accounting software

#### 4.9 AI Action Builder
**Purpose:** Use AI to generate automation rules from natural language

**User Flow:**
1. User types: "When I get a legal contract, strip sensitive info, create a summary, and ask me to review it"
2. AI generates rule with:
   - Trigger: Category starts with "LEGAL/Contract"
   - Actions: Strip PII, Generate Report, Create Approval
3. User reviews and saves

#### 4.10 Analytics Dashboard
**Location:** `/analytics`

**Purpose:** Insights into email patterns, automation effectiveness, productivity

**Metrics:**
- Email volume by category (time series)
- Average response time
- Automation rule execution stats
- Time saved by automation (estimated)
- Priority distribution
- Project health scores over time
- Top contacts by email volume
- Busiest days/times

**Visualizations:**
- Line charts for trends
- Bar charts for comparisons
- Heatmaps for time-of-day patterns
- Sankey diagrams for email flow (inbox → classification → action)

#### 4.11 Mobile App
**Purpose:** Triage on the go

**Features:**
- View top priorities
- Approve/decline actions
- Quick reply to emails
- Voice note capture
- Push notifications for urgent items

#### 4.12 Collaboration Features
**Purpose:** Multiple users working together

**Features:**
- Shared automation rules at organization level
- Team lanes on timeline
- Task assignment to other users
- Comments and mentions
- Activity feed

#### 4.13 Version Control for Rules
**Purpose:** Track changes to automation rules over time

**Features:**
- Automatically save rule versions on edit
- View diff between versions
- Revert to previous version
- Audit trail of who changed what when

#### 4.14 Import/Export
**Purpose:** Backup and migration

**Features:**
- Export all rules as JSON
- Import rules from JSON
- Export project templates
- Export priority configuration
- Bulk export for entire workspace

---

## Implementation Timeline

### Month 1: Priority Configuration System
**Week 1-2:**
- Database schema extension (priority_config in user_preferences)
- API endpoints (get, update, reset, presets)
- Seed default values from current hardcoded constants

**Week 3-4:**
- Settings UI: Priority Configuration page
- All sections (Category Weights, Age Settings, Conflicts, Cross-Labels)
- Presets (Release Week, Touring Season, etc.)

**Week 4:**
- Refactor priority engine to load from database
- Update all function signatures and call sites
- Testing and validation

**Success Metric:** Oran adjusts legal contract priority and sees inbox reorder

---

### Month 2-3: Automation Rule Engine
**Week 1:**
- Database schema (automation_rules, automation_rule_executions)
- Basic rule structure design and validation

**Week 2-3:**
- Automation Rule Builder UI skeleton
- Trigger builder (condition editor)
- Field selector, operator selector, value input

**Week 4-5:**
- Action builder UI
- Action type selector
- Configuration forms for each action type

**Week 6:**
- Test mode functionality
- Sample email selector
- Execution preview

**Week 7-8:**
- Worker execution engine
- Rule evaluator (condition matching)
- Action executor framework
- First 5 action handlers:
  - Strip PII
  - Generate Report
  - Create Timeline Item
  - Create Approval
  - Notify

**Week 9:**
- More action handlers:
  - Draft Reply
  - Attach to Project
  - Apply Label
  - Create Task
  - Extract Entities

**Week 10:**
- Execution logs UI
- Per-rule logs
- Global execution log
- Error handling and debugging

**Week 11:**
- Automation templates system
- Template gallery UI
- Pre-built system templates (8 templates)
- Template cloning

**Week 12:**
- Testing and refinement
- User acceptance testing with Oran
- Bug fixes and polish

**Success Metric:** Oran creates "Legal Contract Handler" rule that auto-executes

---

### Month 4: Customizable Workspace Structure
**Week 1-2:**
- Database schema (lane_definitions, category_groupings)
- Lane Management UI
- Add/edit/delete lanes
- Auto-assign rule builder

**Week 3:**
- Timeline Studio refactor
- Load lanes from database
- Dynamic rendering
- Lane filtering

**Week 4:**
- Auto-assignment implementation
- Worker integration
- Category groups

**Week 5:**
- Project template enhancement
- Lane pattern matching
- Template migration

**Week 6:**
- Testing and polish
- User acceptance testing

**Success Metric:** Oran creates "Finance" lane with custom color and auto-assign rules

---

### Month 5-6: Advanced Features (Prioritized)
**High Priority:**
- Template marketplace (Month 5, Week 1-2)
- Variable system (Month 5, Week 3)
- Conditional actions (Month 5, Week 4)
- Analytics dashboard (Month 6, Week 1-3)

**Medium Priority:**
- Approval workflows (Month 6, Week 4)
- Batch operations (Month 6, Week 4)
- Version control for rules (Month 6, Week 4)

**Lower Priority (Phase 5):**
- Multi-step workflows
- Rule scheduling
- Custom actions (webhooks)
- AI action builder
- Mobile app
- Collaboration features
- Import/export

---

## Success Metrics & KPIs

### Phase 1: Priority Configuration
- ✅ 100% of priority weights loaded from database, not code
- ✅ Oran makes 5+ config changes without developer help
- ✅ Config changes apply immediately (< 1 minute)
- ✅ Zero priority-related feature requests from Oran

### Phase 2: Automation Rules
- ✅ 5+ automation rules created by Oran
- ✅ 80%+ of rules execute successfully on first try
- ✅ 50%+ reduction in manual email triage time
- ✅ Oran creates custom rule (not from template)
- ✅ Zero automation rule execution errors requiring dev intervention

### Phase 3: Custom Lanes
- ✅ Oran creates 2+ custom lanes
- ✅ 90%+ of timeline items auto-assigned to correct lanes
- ✅ Oran reorders lanes to match his workflow
- ✅ Zero lane-related feature requests from Oran

### Overall Product Metrics
- **Feature Request Reduction:** 80% fewer dev-dependent requests
- **Configuration Time:** < 10 minutes to create complex automation rule
- **User Satisfaction:** 9/10 or higher rating from Oran
- **Time to Value:** New users can configure basic automation in < 30 minutes
- **System Reliability:** 99%+ automation rule execution success rate
- **Performance:** Automation rules execute within 5 seconds of email arrival

---

## Migration Strategy

### Migrating Existing Data
**Challenge:** Current system has hardcoded values, existing timeline items use hardcoded lanes

**Solution:**

**Step 1: User Preferences Migration**
- When deploying Phase 1, run migration script
- For each user, populate `priority_config` with current hardcoded values
- Ensures no behavioral change on first deploy
- Users can then customize from there

**Step 2: Lane Migration**
- When deploying Phase 3, run migration script
- For each user, create default lane definitions matching current hardcoded lanes
- Update existing timeline items to reference lane IDs instead of hardcoded strings
- Add foreign key constraint: `timeline_items.lane_id` → `lane_definitions.id`

**Step 3: Automation Rule Gradual Rollout**
- Phase 2 is purely additive (new features)
- No migration needed
- Document existing playbook logic in automation templates
- Users can opt-in by creating rules

### Backward Compatibility
**API Versioning:**
- Maintain `/api/v1/` for old endpoints
- Add `/api/v2/` for new config-driven endpoints
- Deprecation timeline: 6 months

**Database:**
- Keep old columns during transition period
- Example: `timeline_items.lane` (text) coexists with `timeline_items.lane_id` (UUID)
- After 3 months, migrate all data and drop old columns

### Rollback Plan
**If Phase 1 Fails:**
- Revert priority engine to load from code constants
- Keep database tables but ignore them
- No data loss

**If Phase 2 Fails:**
- Disable automation engine in worker
- Rules still stored in database, just not executed
- Can re-enable after fixing bugs

**If Phase 3 Fails:**
- Timeline Studio falls back to hardcoded lanes
- Custom lanes still in database but not used
- No data loss

---

## Risk Assessment & Mitigation

### Risk 1: Performance Degradation
**Risk:** Loading config from database on every email adds latency

**Mitigation:**
- Cache config in memory with 5-minute TTL
- Use Redis for shared cache across worker instances
- Pre-load config on worker startup
- Monitor query performance with indexes

### Risk 2: Overly Complex Rules
**Risk:** Users create rules that conflict or have unintended consequences

**Mitigation:**
- Test mode catches issues before enabling rule
- Execution logs provide debugging info
- Rule priority system resolves conflicts
- Add "dry run" mode to preview actions without executing
- Provide templates and documentation
- Add rule validation (e.g., warn if condition is too broad)

### Risk 3: User Learning Curve
**Risk:** Oran struggles to understand rule builder and gives up

**Mitigation:**
- Comprehensive templates library (start with template, customize)
- Interactive tutorial on first use
- Tooltips and help text throughout UI
- Video walkthroughs
- Example rules with explanations
- Simplified mode (basic options only) vs advanced mode

### Risk 4: Action Handler Failures
**Risk:** Third-party APIs (OpenAI, Slack, Google Drive) fail or rate limit

**Mitigation:**
- Retry logic with exponential backoff
- Graceful degradation (continue to next action)
- Queue system for rate-limited operations
- Detailed error messages in execution logs
- Fallback behaviors (e.g., if Draft Reply fails, create manual task)

### Risk 5: Database Bloat
**Risk:** Execution logs and rule history grow too large

**Mitigation:**
- Retention policy: 90 days for execution logs
- Archive old logs to cold storage
- Pagination and filtering in UI
- Database partitioning by date

### Risk 6: Migration Complexity
**Risk:** Migrating existing data to new schema breaks things

**Mitigation:**
- Phased rollout (test with one user first)
- Dry-run migrations with rollback
- Maintain backward compatibility during transition
- Comprehensive testing suite
- Gradual migration (coexist old and new for 3 months)

---

## Documentation Requirements

### User Documentation
**Getting Started Guide:**
- Introduction to Kazador's configuration system
- Creating your first priority configuration
- Creating your first automation rule
- Creating your first custom lane

**Priority Configuration Guide:**
- Understanding category weights
- Age and time multipliers
- Conflict detection settings
- Using presets
- Best practices for different workflows (touring vs off-season)

**Automation Rules Guide:**
- Understanding triggers and actions
- Building your first rule step-by-step
- Using templates
- Testing rules
- Common patterns and recipes
- Troubleshooting failed executions

**Lane Customization Guide:**
- Creating custom lanes
- Auto-assignment rules
- Reordering lanes
- Lane best practices

**Video Tutorials:**
- 5-minute: Adjusting priority weights
- 10-minute: Creating automation rule from template
- 15-minute: Building custom automation rule from scratch
- 10-minute: Customizing timeline lanes
- 20-minute: Complete workflow setup (priorities + rules + lanes)

### Developer Documentation
**Architecture Overview:**
- Three-layer abstraction explanation
- Database schema documentation
- API reference
- Worker architecture

**Action Handler Development:**
- How to add new action types
- Action handler interface
- Error handling requirements
- Testing requirements

**Extending the System:**
- Adding new trigger field types
- Adding new operators
- Adding new template types
- Adding new variable types

**Deployment Guide:**
- Migration instructions
- Environment variables
- Monitoring setup
- Rollback procedures

---

## Post-Launch Iteration Plan

### First 30 Days After Each Phase
**Week 1:**
- Monitor execution logs for errors
- Collect user feedback (surveys, interviews with Oran)
- Track usage metrics (how many rules created, which templates most popular)
- Fix critical bugs

**Week 2-3:**
- Implement quick wins from feedback
- Optimize performance based on monitoring
- Update documentation based on user questions
- Add requested templates or presets

**Week 4:**
- Plan next phase based on learnings
- Retrospective with team
- Update roadmap

### Continuous Improvement
**Monthly:**
- Review execution logs for patterns
- Add new system templates based on user needs
- Optimize slow queries
- Update documentation

**Quarterly:**
- Major feature additions from Phase 4
- User satisfaction surveys
- Performance reviews
- Security audits

**Annually:**
- Major architecture improvements
- Technology upgrades
- Competitive analysis
- Strategic roadmap update

---

## Conclusion

This pivot transforms Kazador from a bespoke application requiring constant developer intervention into a configurable shell where users build their own workflows. By implementing these three layers:

1. **Priority Configuration System** — Users control what's urgent
2. **Automation Rule Engine** — Users define what happens when
3. **Customizable Workspace** — Users structure their workspace

Oran becomes his own product manager, able to iterate rapidly based on real-world usage without waiting for developer changes. This approach:

- **Reduces development bottlenecks** by 80%
- **Increases user satisfaction** through self-service
- **Improves product-market fit** through rapid iteration
- **Scales to multiple users** with different workflows
- **Future-proofs the codebase** with generic, extensible architecture

The 6-month implementation timeline is aggressive but achievable, with clear milestones and success metrics for each phase. The risk mitigation strategies and comprehensive documentation ensure a smooth rollout.

Most importantly, this pivot aligns with modern product thinking: **Build platforms, not products. Enable users, don't prescribe workflows. Configuration over code.**

This is the path to a truly scalable, user-empowered AI assistant for artist management.
