 Main Benefits of the Timeline/Projects Separation

  1. Cognitive Load Management

  - Timeline: Deep focus mode for execution. When Oran needs to coordinate a complex Asian tour with 15 shows across
  6 countries, he needs immersion — dependencies, conflicts, travel buffers, promo slots all visible in one
  continuous narrative.
  - Projects: Command center for prioritization. When deciding which of 5 active projects needs attention today, he
  needs breadth — health scores, pending approvals, upcoming deadlines across all contexts.

  2. Different Mental Models

  - Timeline: "What's the story of this tour leg? Where are the gaps? What blocks what?"
  - Projects: "Which fire do I put out first? What's stuck? Who needs my input?"

  3. Performance & Scope

  - Timeline: Rendering a dense Gantt chart with dependencies for a single project is compute-intensive. Trying to
  show 5 projects simultaneously would be cluttered and slow.
  - Projects: Aggregate metrics (task counts, email links, health scores) are lightweight and scannable.

  4. Aligns with the Priority Engine

  Your strategic_innovation.md emphasizes moving from "dev-driven" to "Oran-driven" configuration. This separation
  supports that:
  - Projects tab surfaces the Priority Engine's top actions across the workspace
  - Timeline tab lets Oran drill into why something is urgent (dependencies, conflicts, routing issues)

  ---
  Timeline Tab Enhancement Ideas

  Tier 1: Interactive Depth

  1. Annotations & Inline Notes
    - Click any timeline item → add a note (e.g., "Promoter flaky, confirm 48h before")
    - Voice memo attachment (future: Telegram integration)
    - Show annotation badges on timeline items
  2. Live Filtering
    - Filter by: lane (Live/Promo/Writing), territory, status (confirmed/hold/lead), stakeholder
    - "Show only conflicts" mode
    - Date range zoom (next 7/14/30/90 days)
  3. Dependency Editor
    - Visual link creation: drag from one item to another → select FS/SS/FF/SF
    - Dependency impact preview: "If you move this show 2 days earlier, 3 other items shift"
    - Critical path highlighting (items that block the most downstream work)
  4. Scenario Planning
    - "What-if" mode: tentatively move items, see conflict warnings before committing
    - Snapshot comparison: "Show me timeline state from last week vs. today"
    - Versioning: save timeline drafts (e.g., "Plan A: Japan first, Plan B: Korea first")
  5. Smart Scheduling Assistant
    - "Suggest open slots for 2-hour promo block in London between Oct 10-15"
    - Routing optimizer: "Reorder these 5 shows to minimize travel time"
    - Buffer violations alert: "This itinerary has 3 risky <12hr gaps between long flights"

  Tier 2: Context & Intelligence

  6. Email Thread Linking
    - Timeline item → click → see all related email threads
    - Inline "Last update: 2 days ago from promoter" badges
  7. Asset Attachment
    - Timeline item → attach contracts, riders, tech specs from Drive
    - Visual indicator: "3 files linked" with quick preview
  8. Playbook Triggers from Timeline
    - Right-click a "Show Offer" lead → "Run Booking Playbook"
    - Auto-generate folder scaffolding, reply draft, contract checklist
  9. Real-time Collaboration
    - Multi-user presence: see if someone else is viewing/editing the timeline
    - Comment threads on timeline items (Supabase Realtime)

  ---
  Projects Tab Enhancement Ideas

  Tier 1: Overview Intelligence

  1. Performance Metrics Dashboard
    - Per-project cards show:
        - Health score (from Priority Engine)
      - Progress bars: tasks (3/12 done), emails (5 unread), approvals (2 pending)
      - Trend indicators: ↑ improving, ↓ slipping, ⚠️ blocked
    - Workspace rollup: "You have 47 open tasks across 6 projects, 12 are overdue"
  2. Relationship Mapping
    - "People" section per project card shows avatars of key stakeholders
    - Click → see all projects involving this promoter/venue/agent
    - Network graph view (future): visualize collaborator overlap across projects
  3. Quick-Action Panels
    - Hover project card → quick actions:
        - "View Timeline" (jumps to Timeline tab, filtered to this project)
      - "Check Inbox" (shows linked emails)
      - "Approve 2 pending items"
      - "Add task/event"
    - Batch operations: select 3 projects → "Mark all as Active" or "Export combined report"
  4. Smart Sorting & Grouping
    - Sort by: priority, start date, health score, territory, artist
    - Group by: status (planning/active/done), quarter, territory
    - Custom views: "Show only projects with unread legal emails"

  Tier 2: Automation & Insights

  5. Project Templates with AI Suggestions
    - "Create from template" → choose "Tour Leg" → AI suggests:
        - Based on last Asian tour, you'll need: 12 flights, 8 hotels, 15 tech advances, 10 promo slots
      - Auto-populate timeline with typical lead times (contracts T-60d, tech advance T-14d)
  6. Risk Indicators
    - Per-project warnings:
        - "⚠️ No executed contract 30 days before show"
      - "⚠️ Visa appointment not booked, show in 45 days"
      - "⚠️ 5 unanswered promo emails >7 days old"
  7. Cross-Project Conflict Detection
    - "Barry has overlapping holds: London show (Project A) and Paris interview (Project B) both on Oct 12"
    - "You have 3 projects competing for the same Drive folder"
  8. Financial Rollup (future)
    - Show projected revenue/costs per project
    - Settlements status: "£15k pending, £8k overdue"
    - Link to FINANCE/* email threads
  9. Digest Integration
    - Projects tab shows same data as /today digest, but always live (not daily snapshot)
    - "Top 5 actions today" widget pulls from Priority Engine across all projects

  ---
  Architectural Recommendations

  Data Model Alignment

  Based on your schema (from AGENTS.md and strategic_innovation.md):

  Timeline Tab (single-project focus):
  -- Query: all timeline items + dependencies for project X
  SELECT * FROM timeline_entries WHERE project_id = $1 ORDER BY starts_at;
  SELECT * FROM timeline_dependencies WHERE project_id = $1;

  Projects Tab (multi-project overview):
  -- Query: aggregated metrics for all projects
  SELECT
    p.*,
    COUNT(DISTINCT pt.id) as open_tasks,
    COUNT(DISTINCT pe.email_id) as linked_emails,
    COUNT(DISTINCT a.id) FILTER (WHERE a.status='pending') as pending_approvals,
    -- health_score from Priority Engine
  FROM projects p
  LEFT JOIN project_tasks pt ON pt.project_id = p.id AND pt.status != 'done'
  LEFT JOIN project_email_links pe ON pe.project_id = p.id
  LEFT JOIN approvals a ON a.project_id = p.id
  GROUP BY p.id;

  Navigation Flow

  User lands on Projects tab (default)
    ↓
  Sees "Asian Tour 2026" has ⚠️ 3 conflicts
    ↓
  Clicks "View Timeline" quick action
    ↓
  Timeline tab opens, auto-filtered to "Asian Tour 2026"
    ↓
  User resolves conflicts, adds notes
    ↓
  Clicks "Projects" in nav → returns to overview

  URL Structure

  - /projects — multi-project overview
  - /timeline?project={id} — single-project timeline
  - /timeline?project={id}&focus={item_id} — deep-link to specific timeline item

  ---
  Prioritization Based on strategic_innovation.md Gaps

  Your strategic doc identifies these as CRITICAL gaps blocking production:
  1. ❌ Calendar integration
  2. ❌ Hardcoded priority config
  3. ❌ No playbooks execution
  4. ❌ Relational integrity issues

  So I'd recommend:

  Phase 1 (Timeline enhancements)

  - Live filtering (already fast to build, high impact)
  - Dependency editor (closes gap from strategic doc: "no UI to add/remove dependencies")
  - Calendar sync integration (CRITICAL per strategic doc)

  Phase 2 (Projects enhancements)

  - Performance metrics dashboard (surfaces Priority Engine insights)
  - Quick-action panels (reduces clicks to get to Timeline)
  - Risk indicators (closes sentiment/urgency gap)

  Phase 3 (Advanced)

  - Scenario planning (Timeline)
  - Cross-project conflict detection (Projects)
  - Relationship mapping (Projects)

  ---
  The Killer Feature Combo

  Here's where this separation really shines:

  Scenario: Oran wakes up, checks /today digest (or Projects tab):
  1. Priority Engine says: "Asian Tour 2026 — ⚠️ HIGH: Visa deadline in 3 days, no appointment booked"
  2. He clicks the project card → sees it's a LOGISTICS/Visas_Immigration email from 5 days ago
  3. Clicks "View Timeline" → Timeline tab opens, filtered to Asian Tour
  4. He sees the visa appointment timeline item is red (overdue dependency)
  5. He drags it to tomorrow, adds annotation: "Embassy appt booked for Oct 15"
  6. Returns to Projects tab → health score improves, ⚠️ clears

  This flow leverages:
  - Projects tab for triage (Priority Engine decides what's urgent)
  - Timeline tab for execution (visual context to fix the issue)
  - Separation allows each view to excel at its job