# Fire Enrich Integration Plan

This guide outlines how to layer the [Fire Enrich](https://github.com/firecrawl/fire-enrich) multi-agent enrichment workflow on top of Kazador's existing Gmail ingestion, Supabase storage, and contact intelligence surfaces.

## Objectives
- **Automatic contact & relationship enrichment** – run Fire Enrich when a domain or contact lacks external signals *and* pair the result with Kazador's internal history (projects, email threads, approvals).
- **Surface relational context in dashboards** – expose company metadata, previous conversations, regional focus, LinkedIn profiles, and club/association involvement across Inbox, Projects, and Today digest.
- **Preserve auditability** – store Fire Enrich source citations plus internal evidence (email ids, project ids) so users can trace where a fact originated.

## High-Level Architecture
1. **Worker trigger**: extend `worker/src/index.ts` to detect when a Gmail message introduces a domain we have not enriched (or when enrichment is older than a refresh window).
2. **Dual-source enrichment job**: call a Fire Enrich instance (self-hosted or managed) with the target email, requested external fields, and a prompt section containing relevant internal history (see "Context Assembler"). Capture the streaming response and final record payload.
3. **Persistence layer**: map the enriched fields into Supabase tables:
   - `contacts` – add enrichment columns (industry, headquarters region, LinkedIn URL, club affiliations, etc.) or use a JSONB `enrichment` column for flexibility.
   - `contact_relationship_summaries` (new table) – store roll-ups of past conversations, referenced projects, and "have we worked together" flags.
   - `contact_sources` (new table) – store per-field source URLs for external data and reference ids for internal evidence.
   - `contact_enrichment_runs` (new table) – track job metadata (status, timestamps, tool version, and Fire Enrich request ids).
4. **Frontend surfaces**: update shared types and React components (`app/components/*`) to display enrichment data where relevant (Inbox contact panel, Project member cards, Today digest company summaries, relationship chips).

## Running Fire Enrich
Fire Enrich is a Next.js application that orchestrates Firecrawl API searches and GPT-4o synthesis. Run it as a companion service:

```bash
# clone in a sibling directory
git clone https://github.com/firecrawl/fire-enrich.git
cd fire-enrich
cp .env.example .env.local
# set required keys
export FIRECRAWL_API_KEY=...
export OPENAI_API_KEY=...
npm install
npm run dev
```

By default, local development enables **Unlimited Mode**, letting you enrich more rows and fields. You can override the limits via `FIRE_ENRICH_UNLIMITED=false` if you want to mimic the hosted constraints.

Deploy options:
- **Managed**: host Fire Enrich on Vercel and secure it behind authentication or a signed webhook secret.
- **Internal service**: deploy to your existing infrastructure (e.g., Fly.io, Render) with private networking between the worker and Fire Enrich.

## Context Assembler
Before calling Fire Enrich, build a structured summary of what Kazador already knows about the contact. Suggested slices:

- **Identity**: canonical email, full name, company inferred from domain, and any manual overrides.
- **Engagement history**: latest 5 email thread subjects, last-contact timestamp, Gmail labels applied, sentiment/priority tags from classification, and whether the contact ever appeared in a Today digest action.
- **Project touchpoints**: list of project ids/names where the contact is a member, stakeholder, or referenced in project emails/tasks. Include roles if known.
- **Regional & organisational data**: preferred region (from CRM custom fields or email metadata), clubs/associations detected in previous correspondence, past event attendance (if stored).
- **Internal notes**: approvals, comments, or CRM notes that mention working with the contact.

Compose the prompt section with short bullet points and include Supabase record ids so the enrichment output can reference them.

## Worker Integration Steps
1. **Client wrapper**: create `worker/src/fireEnrichClient.ts` that issues POST requests to `/api/enrich` with an email, requested external fields, context summary payload, and correlation id. Handle retries on 429/5xx.
2. **Job orchestration**: extend the Gmail ingestion pipeline to enqueue enrichment jobs when:
   - a new contact domain is discovered,
   - a contact record lacks either external or internal summaries,
   - or the last enrichment timestamp exceeds your freshness SLA (e.g., 30 days) or the relationship status changed (e.g., new project membership).
   Use BullMQ (if already adopted) or a simple in-memory queue to avoid blocking email ingestion.
3. **Schema updates**: write a migration adding enrichment columns/JSONB to `contacts`, the `contact_relationship_summaries` table for internal context, and the `contact_enrichment_runs` table. Ensure row-level security allows the worker insert/update but hides raw source URLs from unauthorized users.
4. **Error handling**: persist Fire Enrich errors (HTTP status, message) and internal context snapshot hashes so you can surface failures in the admin console and retry later when data changes.

## Frontend and Shared Types
- Update `shared/src/types.ts` with `ContactEnrichment` interfaces (industry, headcount, funding, techStack, headquarters, sources) and `ContactRelationshipSummary` (first_seen, last_seen, thread_summaries, worked_with_before, projects, region, clubs, linkedInUrl).
- Extend Supabase client helpers in `app/lib/supabaseClient.ts` to select enrichment and relationship summary fields with contacts, and expose a hook/util for components.
- Add UI treatments:
  - Inbox: show enriched company card with key highlights, "last updated" timestamp, and a "history" drawer summarising previous email topics.
  - Projects: augment member cards or project sources with enrichment quick facts, "worked with before" badges, and LinkedIn buttons.
  - Today digest: surface notable regional focus shifts, club affiliations relevant to current initiatives, or reminders of recent collaborations.
- Include source tooltips/links so users can verify the external data directly and expand to view internal evidence.

## Operational Considerations
- **Rate limiting**: Fire Enrich fans out multiple Firecrawl API calls per request. Introduce a rate limiter in the worker to stay within your Firecrawl quota.
- **Cost controls**: batch enrichment during off-peak hours, and skip free-mail domains (Gmail, Yahoo) to avoid wasted tokens.
- **Observability**: log correlation ids spanning Gmail ingestion, Fire Enrich requests, and Supabase writes. Feed metrics into your existing monitoring stack.
- **Security**: secure the Fire Enrich endpoint with an HMAC signature or bearer token stored in Supabase secrets.
- **Testing**: add Vitest suites mocking the Fire Enrich client to cover success, partial data, and failure scenarios.

## Roadmap Enhancements
- Build a manual "Re-run enrichment" action inside the admin dashboard for individual contacts.
- Trigger enrichment when a user links an email to a project, ensuring project stakeholders inherit the latest company context.
- Experiment with custom Fire Enrich fields (e.g., "partnership opportunities") to tailor outputs to Kazador workflows.
- Add a "relationship confidence" score derived from internal evidence counts so users can quickly assess familiarity.
- Provide timeline diffs showing how enrichment changed after new conversations or external updates.
