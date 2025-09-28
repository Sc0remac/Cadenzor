# Cadenzor

Cadenzor is an early prototype of an artist‑management tool derived from the “Aura” vision.  This v1 focuses on the **email triage / classifier** portion of the platform.  The system connects to Gmail, classifies unread messages into high‑level categories (e.g. booking, promo, logistics) and writes the results into a Supabase database.  A lightweight web interface built with Next.js displays aggregated counts of unread emails by category.  Contact information is also stored so that future features can enrich and de‑duplicate artist relationships.

> **Note:** This project scaffolding is intentionally minimal—there is no authentication or production‑ready error handling.  It is designed as a starting point that you can expand upon.  You will need to provision your own Supabase project, obtain Google OAuth credentials and a Gmail refresh token, and configure environment variables as described below.

## Directory structure

```
cadenzor/
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
  - `GOOGLE_REDIRECT_URI` – the redirect URI configured for your OAuth client (not used directly but required by the API client)
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

You can modify these schemas as you extend Cadenzor.  For example, you may add columns for thread IDs, snippets, attachments, or linking to timeline entries.

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

The Next.js dashboard displays a simple grid showing the count of unread emails per category.  It refreshes every minute.  To start it locally:

```bash
cd app
npm install
npm run dev
```

Then visit [http://localhost:3000](http://localhost:3000) in your browser.  Ensure that the environment variables in `.env.local` (or your hosting platform) supply `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` so the frontend can connect to Supabase.

## Extending Cadenzor

This project only scratches the surface of the larger Cadenzor vision.  Next steps might include:

* Authenticating users and scoping data per artist/manager.
* Surfacing individual email details and enabling actions (snooze, reply drafts, timeline creation).
* Replacing the keyword‐based classifier with a proper machine learning model or more nuanced rule engine.
* Adding automation to mark messages as read and apply Gmail labels based on the assigned category.
* Building out the Timeline Studio and Playbooks described in the specification.

Pull requests are welcome—enjoy hacking on Cadenzor!
