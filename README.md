# Kazador

Kazador is an early prototype of an artist‑management tool derived from the “Aura” vision.  This v1 focuses on the **email triage / classifier** portion of the platform.  The system connects to Gmail, classifies unread messages using the detailed LEGAL/… — FINANCE/… — LOGISTICS/… taxonomy, and writes the results into a Supabase database.  A lightweight web interface built with Next.js displays aggregated counts of unread emails by category.  Contact information is also stored so that future features can enrich and de‑duplicate artist relationships.

> **Note:** This project scaffolding is intentionally minimal—there is no authentication or production‑ready error handling.  It is designed as a starting point that you can expand upon.  You will need to provision your own Supabase project, obtain Google OAuth credentials and a Gmail refresh token, and configure environment variables as described below.

## Directory structure

```
kazador/
├── app/               # Next.js 14 dashboard (frontend)
│   ├── app/           # App Router pages and API routes
│   ├── components/    # React components
│   ├── lib/           # Helper utilities (supabase client)
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.json
│   └── package.json
├── worker/            # Node worker for Gmail triage (backend)
│   ├── src/index.ts   # Polls Gmail, classifies messages, writes to DB
│   ├── tsconfig.json
│   └── package.json
├── shared/            # Shared types used by both app and worker
│   └── src/index.ts
├── package.json       # Root workspace configuration
└── README.md          # This file
```

## Environment variables

Both the worker and the dashboard rely on environment variables.  Create a `.env` file at the root of each package or configure your deployment platform accordingly.  At minimum you will need:

- **Supabase (both worker and dashboard)**
  - `SUPABASE_URL` – your Supabase project URL (e.g. `https://xyzcompany.supabase.co`)
  - `SUPABASE_SERVICE_ROLE_KEY` – service key for the worker to write to the database
  - `NEXT_PUBLIC_SUPABASE_URL` – same as `SUPABASE_URL`, but exposed to the browser for the frontend
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` – the public anon key for the frontend

- **Google / Gmail (worker only)**
  - `GOOGLE_CLIENT_ID` – your Google OAuth client ID
  - `GOOGLE_CLIENT_SECRET` – your Google OAuth client secret
  - `GOOGLE_REDIRECT_URI` – optional; set this to the redirect URI used when you minted the refresh token (e.g. `https://developers.google.com/oauthplayground`). Leave unset if you are unsure.
  - `GMAIL_REFRESH_TOKEN` – a refresh token obtained via the OAuth consent flow for the Gmail account you wish to monitor

You can store these variables in a `.env` file inside the `worker/` directory for local development.  For the dashboard, environment variables prefixed with `NEXT_PUBLIC_` will be exposed to the browser; do not expose your service role key in the frontend.

## Supabase database schema

Set up two tables in Supabase to mirror the shapes used in the code:

```sql
create table contacts (
  id uuid default uuid_generate_v4() primary key,
  email text unique not null,
  name text,
  last_email_at timestamp with time zone
);

create table emails (
  id text primary key,       -- Gmail message ID
  from_name text,
  from_email text not null,
  subject text,
  received_at timestamp with time zone,
  category text not null,
  is_read boolean default false
);

-- optional index to accelerate grouping by category and filtering unread
create index emails_category_idx on emails(category);
create index emails_is_read_idx on emails(is_read);
```

You can modify these schemas as you extend Kazador.  For example, you may add columns for thread IDs, snippets, attachments, or linking to timeline entries.

## Running the worker

The worker script polls Gmail for unread messages, fetches the full message body, sends sender/subject/body context to OpenAI for a short summary and multi-label classification, then writes the results (including the first label as the primary category) to Supabase. To run it locally:

```bash
cd worker
npm install
cp .env.example .env  # create and edit with your credentials
npm run build
npm start
```

Required environment variables now include `OPENAI_API_KEY` and optional `MAX_EMAILS_TO_PROCESS` (defaults to `5`) to limit how many unread messages are analysed per run. Ensure your Gmail OAuth consent flow requested either `https://www.googleapis.com/auth/gmail.readonly` or `https://www.googleapis.com/auth/gmail.modify`; the lighter `gmail.metadata` scope cannot fetch full message bodies.

The worker logs each message ID and its assigned labels.  You can schedule this script via a cron job or integrate it into a queue for continuous operation.

## Running the dashboard

> Requires Node.js 20 or later. The repository includes an `.nvmrc` to streamline using the correct runtime.

The Next.js dashboard displays a simple grid showing the count of unread emails per category.  It refreshes every minute.  To start it locally:

```bash
cd app
npm install
npm run dev
```

Then visit [http://localhost:3000](http://localhost:3000) in your browser.  Ensure that the environment variables in `.env.local` (or your hosting platform) supply `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` so the frontend can connect to Supabase.

## Timeline Studio

The project hub now includes a timeline workspace that mirrors the specification. Key capabilities:

- Multi-lane visualisation for Live, Promo, Writing, Brand, Release and ad-hoc lanes.
- Finish-to-start and start-to-start dependency edges rendered directly on the timeline.
- Tunable travel buffer with automatic conflict alerts for overlapping slots or territory jumps.
- Unscheduled backlog list so items without dates remain visible until placed.

## Gmail labels in your inbox

Kazador now applies Gmail labels to messages it classifies so you can see them directly in your inbox:

- Labels are created under a parent label `Kazador`, e.g. `Kazador/LEGAL/Contract_Draft` or `Kazador/FINANCE/Settlement` plus any cross-tag metadata such as `Kazador/artist/Barry_Cant_Swim`.
- If a label does not exist yet, it is created automatically.
- Ensure the refresh token was granted the `https://www.googleapis.com/auth/gmail.modify` scope so labels can be added.

## Email taxonomy

Kazador’s classifier now aligns with the detailed taxonomy supplied by the artist management team. Primary labels (one is required per email) are:

- LEGAL/Contract_Draft — Draft agreements, redlines, tracked changes.
- LEGAL/Contract_Executed — Fully signed contracts and addenda.
- LEGAL/Addendum_or_Amendment — Changes to terms, fees, or dates.
- LEGAL/NDA_or_Clearance — NDAs, image/recording clearances, sync licences.
- LEGAL/Insurance_Indemnity — Certificates of insurance and liability clauses.
- LEGAL/Compliance — GDPR, data requests, policy updates.
- FINANCE/Settlement — Post-show settlements covering fees, costs, taxes, and net payouts.
- FINANCE/Invoice — Invoices to or from promoters, agencies, brands.
- FINANCE/Payment_Remittance — Payment confirmations and remittance advice.
- FINANCE/Banking_Details — IBAN/SWIFT updates and payee changes.
- FINANCE/Tax_Docs — W-8/W-9, VAT, withholding certificates.
- FINANCE/Expenses_Receipts — Reimbursables, per diems, travel receipts.
- FINANCE/Royalties_Publishing — Statements from labels/publishers.
- LOGISTICS/Itinerary_DaySheet — Day schedules, contacts, set times.
- LOGISTICS/Travel — Flights, trains, ferries, ticket changes.
- LOGISTICS/Accommodation — Hotels/Airbnbs and confirmations.
- LOGISTICS/Ground_Transport — Drivers, pickups, ride shares.
- LOGISTICS/Visas_Immigration — Visa letters, approvals, appointments.
- LOGISTICS/Technical_Advance — Tech rider, stage plot, backline.
- LOGISTICS/Passes_Access — Accreditation, wristbands, AAA lists.
- BOOKING/Offer — Initial offers with city, venue, fee, terms.
- BOOKING/Hold_or_Availability — Date holds and availability checks.
- BOOKING/Confirmation — Pre-contract confirmation emails.
- BOOKING/Reschedule_or_Cancel — Date or term changes and cancellations.
- PROMO/Promo_Time_Request — Interviews, guest mixes, press slots.
- PROMO/Press_Feature — Articles, reviews, photo requests.
- PROMO/Radio_Playlist — Radio plays, playlist adds, premieres.
- PROMO/Deliverables — Liners, bios, quotes, promo copy requests.
- PROMO/Promos_Submission — Tracks and promos submitted for listening.
- ASSETS/Artwork — Covers, banners, social crops.
- ASSETS/Audio — WAVs, masters, radio edits, stems.
- ASSETS/Video — Teasers, trailers, live clips, reels.
- ASSETS/Photos — Press shots and live photos.
- ASSETS/Logos_Brand — Logos, lockups, style guides.
- ASSETS/EPK_OneSheet — Press kits and one-pagers.
- FAN/Support_or_Thanks — General appreciation from fans.
- FAN/Request — Birthday, wedding, giveaway requests.
- FAN/Issues_or_Safety — Sensitive or urgent community issues.
- MISC/Uncategorized — Used only when nothing else fits.

Cross-tag prefixes (optional and applied alongside primary labels) include: `artist/{name}`, `project/{slug}`, `territory/{ISO2}`, `city/{name}`, `venue/{name}`, `date/{YYYY-MM-DD}`, `tz/{IANA}`, `approval/{type}`, `confidential/{flag}`, `status/{state}`, `assettype/{kind}`, and `risk/{flag}`.

Existing email classifications are reset to `MISC/Uncategorized` by the accompanying migration so you can re-run the classifier with the new taxonomy.

## Extending Kazador

This project only scratches the surface of the larger Kazador vision.  Next steps might include:

* Authenticating users and scoping data per artist/manager.
* Surfacing individual email details and enabling actions (snooze, reply drafts, timeline creation).
* Replacing the keyword‐based classifier with a proper machine learning model or more nuanced rule engine.
* Adding automation to mark messages as read (label application is already implemented).
* Building out the Timeline Studio and Playbooks described in the specification.

## Priority Engine digest

This update adds a workspace-wide "Today" view that rolls up the highest priority tasks, timeline items, and unresolved email threads across every project you collaborate on. The scoring combines category severity, manual priority values, dependency conflicts, and unread/triage state so the most urgent work floats to the top.

You can open the digest at `/today` inside the Next.js app or trigger the scheduled worker job:

```bash
npm --prefix shared run build
npm --prefix worker run build
npm --prefix worker run digest
```

The job stores results in the new `user_preferences`, `digests`, and `action_logs` tables. Preferences default to a daily cadence and record delivery channels (`web`, `email`, or `slack`). The Supabase migration at `supabase/migrations/20251101120000_priority_digest.sql` must be applied before running the worker.

Pull requests are welcome—enjoy hacking on Kazador!
