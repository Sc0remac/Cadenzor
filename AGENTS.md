# Cadenzor Agent Guide

This document captures the complete shape of the Cadenzor monorepo so future contributors (human or AI) can quickly understand what exists today. It summarises every major directory, feature, integration, and supporting asset in the repository.

## Table of contents
- [1. Repository overview](#1-repository-overview)
- [2. Top-level workspace assets](#2-top-level-workspace-assets)
- [3. Application package (`app/`)](#3-application-package-app)
  - [3.1 Routes and layouts (`app/app/`)](#31-routes-and-layouts-appapp)
  - [3.2 React components (`app/components/`)](#32-react-components-appcomponents)
  - [3.3 Frontend libraries (`app/lib/`)](#33-frontend-libraries-applib)
  - [3.4 Configuration & tooling](#34-configuration--tooling)
- [4. Shared package (`shared/`)](#4-shared-package-shared)
- [5. Worker package (`worker/`)](#5-worker-package-worker)
- [6. Database & migrations](#6-database--migrations)
- [7. Testing & quality](#7-testing--quality)
- [8. Environment & runtime expectations](#8-environment--runtime-expectations)
- [9. Reference documents](#9-reference-documents)

## 1. Repository overview
Cadenzor is organised as a TypeScript monorepo using npm workspaces. There are three first-class packages:

| Package | Role |
| --- | --- |
| `app/` | Next.js 14 web application that exposes dashboards for email triage, project hubs, the Today digest, and admin tooling. |
| `worker/` | Node.js background workers that ingest Gmail, apply classification via OpenAI plus heuristics, enrich Supabase, refresh project metrics, and build a priority digest. |
| `shared/` | Reusable TypeScript domain utilities and types shared by both the frontend and workers (email taxonomy, label helpers, priority engine, timeline conflict detection, etc.). |

The root `package.json` wires workspace build/test scripts and pins Node 20+. `node_modules/` at the repo root hosts shared dependencies such as React, Vitest, and testing libraries.

## 2. Top-level workspace assets
- `.gitignore`, `.nvmrc` – standard tooling defaults.
- `README.md` – high-level product introduction, setup guides, Supabase schema summary, and worker/dashboard run instructions.
- `schema_final.sql` – comprehensive Supabase schema (auth, storage, realtime, application tables for projects, tasks, emails, digests, approvals, assets, etc.). Use it as the canonical migration reference.
- `Project Overview.txt`, `Project Roadmap.txt`, `Contact Enrichment.txt`, `Oran Responses.txt` – narrative design and planning notes that expand on the Cadenzor vision.
- Root npm scripts (`build`, `dev`, `test`, etc.) orchestrate package-level scripts via `npm --prefix`.

## 3. Application package (`app/`)
Next.js 14 App Router project with Tailwind CSS styling. Uses Supabase auth on the client and server.

### 3.1 Routes and layouts (`app/app/`)
- `layout.tsx` – Root layout applying global fonts/styles and mounting the `AuthProvider`.
- `(auth)/login/page.tsx` – Public login form using `LoginForm` to sign in with Supabase email/password.
- `(protected)/layout.tsx` – Suspense-wrapped guard that enforces authentication (`AuthGuard`) and renders `AppShell` navigation.
- `(protected)/page.tsx` – Home route delegating to `HomeDashboard`.
- `(protected)/inbox/page.tsx` – Inbox surface embedding `EmailDashboard` to inspect classified mail.
- `(protected)/today/page.tsx` – Today digest view via `TodayDashboard`.
- `(protected)/projects/page.tsx` – Project listing, search, status filters, creation dialog.
- `(protected)/profile/page.tsx` – Profile management UI (calls Supabase to edit metadata & Drive integration).
- `(protected)/admin/page.tsx` – Admin console with panels for workspace data, projects, users.
- `(protected)/logout/page.tsx` – Sign-out helper (leverages auth context).
- API routes under `app/app/api/` (all `GET`/`POST` handlers run in the Edge Node runtime and require bearer auth):
  - `email-stats` – Aggregates counts of unread/all emails per Cadenzor label using Supabase, ensuring default taxonomy coverage.
  - `emails` – Paginates email records with optional label/source filters and returns metadata & attachments.
  - `classify-emails` – Triggers the worker classification endpoint for manual reruns.
  - `projects` – Lists projects with joined membership/roles and supports text/status filters.
  - `project-templates` – Serves reusable project templates and starter timeline items.
  - `project-approvals`/`approvals` – Exposes approval records for the Today digest & admin review.
  - `digests` – Returns current digest payload and history snapshots.

Global stylesheet lives at `app/app/globals.css`.

### 3.2 React components (`app/components/`)
The component library is grouped by feature area:
- `AppShell`, `AuthGuard`, `AuthProvider`, `LoginForm` – authentication context, protected routing, layout chrome, sign-in workflow.
- `EmailDashboard` – polling email stats, pagination, manual classification trigger, filters (label, scope, seeded/fake sources), status toasts, 60s refresh cadence.
- `home/HomeDashboard` – high-level digest summary, top priorities, upcoming deadlines, seeded email feed.
- `today/TodayDashboard` – rich Today digest including historical runs, per-project metrics, approvals, top actions.
- `projects/` – project cards, creation dialog, timeline studio (multi-lane Gantt view with dependencies, buffers, conflict warnings), files tab for asset management.
- `admin/` – admin dashboard/panels for inspecting seeded data, project registries, user provisioning.
- `ProfileDriveIntegration`, `ProfileTimelinePreferences` (if present) – account integrations & preferences.
- Component test stubs live under `app/components/__tests__/`.

### 3.3 Frontend libraries (`app/lib/`)
Utility modules and API clients:
- `supabaseClient.ts` – fetch helpers for email stats, email lists, projects, digest data, approvals, assets; normalises pagination objects.
- `supabaseBrowserClient.ts` / `serverSupabase.ts` / `serverAuth.ts` – Supabase client factories and bearer token verification used in API handlers.
- `adminAuth.ts`, `projectAccess.ts`, `projectMappers.ts` – gatekeeping & mapping helpers for admin/project APIs.
- `approvalActions.ts` – mutate approval state (approve/decline) and emit audit logs.
- `googleOAuth.ts`, `googleDriveClient.ts`, `driveIndexer.ts` – Google integrations for Drive file surfacing.
- `auditLog.ts` – structured audit logging utilities.
- `__tests__/` – Vitest suites covering API utilities.

### 3.4 Configuration & tooling
- `package.json` / `package-lock.json` – Next.js, Tailwind, Supabase, Google APIs dependencies.
- `tsconfig.json`, `tailwind.config.js`, `postcss.config.js` – TypeScript & styling config.
- `node_modules/` – app-specific dependencies.

## 4. Shared package (`shared/`)
Pure TypeScript library compiled for consumption across packages.
- `src/types.ts` – canonical domain types (emails, contacts, projects, tasks, timeline items, approvals, digests, assets, taxonomy constants, helper enums).
- `analyzeEmail.ts` – orchestrates OpenAI email summarisation with retry/backoff, taxonomy guardrails, playbook instructions, subject/body normalisation, label sanitisation.
- `heuristicLabels.ts` – rule-based label detection used as fallback or for quick classification.
- `labelUtils.ts` – normalisation helpers, default coverage (ensures at least primary label), selection of primary category.
- `projectPriority.ts` – scoring algorithm for project top actions combining urgency, dependencies, buffers, risk.
- `timelineConflicts.ts` – detects schedule conflicts given territory jumps, travel buffers, overlapping items.
- `projectSuggestions.ts` – heuristics to attach incoming emails to existing projects or suggest new ones.
- `projectPriority`, `analyzeEmail`, `heuristicLabels` all have Vitest unit suites under `__tests__/`.
- `index.ts` re-exports all modules for convenient `@cadenzor/shared` imports.

## 5. Worker package (`worker/`)
Node-based background services that operate against Gmail and Supabase.
- `src/index.ts` – Gmail poller:
  - Authenticates via OAuth refresh token.
  - Lists unread messages (configurable `MAX_EMAILS_TO_PROCESS`).
  - Fetches bodies, decodes MIME parts, extracts headers.
  - Reads cached summaries/labels from Supabase, calls `classifyEmail` (using shared AI + heuristics), writes contacts/emails back to Supabase, applies Gmail labels (`Cadenzor/...`).
- `classifyEmail.ts` – orchestrates summary/label reuse, AI calls, heuristic fallback, coverage enforcement; returns metadata on caching vs AI usage.
- `digestJob.ts` – builds the "Today" digest:
  - Pulls projects, tasks, timeline items, approvals, emails.
  - Maps rows to shared types, computes metrics, stores digests & preferences.
- `projectJobs.ts` – refreshes per-project metrics (open tasks, timeline counts, linked emails, sources, members) and writes aggregated profiles plus suggestions for linking emails to projects.
- `projectSuggestions` usage ensures email-project linking.
- `__tests__/classifyEmail.test.ts` covers classification behaviour.
- `package.json` / `tsconfig.json` configure the worker build (`tsc`) and runtime scripts (`npm run build`, `npm start`, `npm run digest`).

## 6. Database & migrations
`schema_final.sql` defines the full Supabase/Postgres setup:
- Supabase auth schemas/extensions (auth, storage, realtime, vault, etc.).
- Application tables: `contacts`, `emails`, `projects`, `project_tasks`, `timeline_items`, `timeline_dependencies`, `project_members`, `project_sources`, `project_email_links`, `project_item_links`, `assets`, `asset_links`, `approvals`, `digests`, `user_preferences`, `action_logs`, supporting indexes & RLS policies.
- Use this file to recreate the database locally or seed Supabase.

## 7. Testing & quality
- Root `vitest.config.ts` scopes test discovery to each package and configures React aliases.
- `vitest.setup.ts` loads Testing Library matchers and polyfills `URLSearchParams.size`.
- Run `npm test` from the repo root to execute all package tests with Vitest.

## 8. Environment & runtime expectations
- Node.js ≥ 20 (see `.nvmrc`).
- Supabase environment variables:
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` for workers.
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the frontend.
- Gmail/OAuth for worker ingestion: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (optional), `GMAIL_REFRESH_TOKEN`.
- OpenAI for classification: `OPENAI_API_KEY` (plus optional retry tunables used in `shared/analyzeEmail`).
- Worker jobs read optional `MAX_EMAILS_TO_PROCESS` to limit batch size.

## 9. Reference documents
Keep the supporting strategy docs in mind when extending functionality:
- `Project Overview.txt` – product narrative and feature framing.
- `Project Roadmap.txt` – milestone planning, backlog ideas.
- `Contact Enrichment.txt` – requirements for contact sync & dedupe.
- `Oran Responses.txt` – stakeholder Q&A guiding UX & automation decisions.

With this guide, contributors should be able to navigate the codebase, identify the right package for their change, and understand how frontend, worker, and shared utilities collaborate.

## Update log

- **2025-10-09T00:33:37Z** – Documented the newly added workspace Timeline Studio feature set: navigation entry, `/api/timeline` aggregation endpoint, Supabase client helpers, and the protected Timeline Studio page with advanced filtering controls.
- **2025-10-09T02:15:00Z** – Reworked the dedicated Timeline Studio into a project-focused, full-screen experience with simplified top filters, entry-type classification, refined API contract, and documented third-party timeline research options.
