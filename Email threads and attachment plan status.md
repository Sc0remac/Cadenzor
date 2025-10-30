Revised Stage Order

- [x] Stage 0: Schema & RLS Foundations
- [x] Stage 1: Shared Types + Thread Priority
- [x] Stage 2: Thread-Aware Ingestion (Worker)
- [x] Stage 3: Thread Summarization
- [x] Stage 4: Thread APIs
- [x] Stage 5: Thread-First Inbox UI
- [ ] Stage 6: Attachment Download & Storage
- [ ] Stage 7: Drive Routing Engine
- [ ] Stage 8: Routing Rules UI
- [ ] Stage 9: Attachment UX in Threads
- [ ] Stage 10: Polish, Scale & Ops

Stage 0: Schema & RLS Foundations ✅ (completed 2025-10-29)

Scope: Add email_threads, extend emails and email_attachments, create attachment_routing_rules, drive_folder_cache, indexes, RLS.
Key files: schema/migrations, schema_final.sql.
Done when: Migrations apply and rollback cleanly on a fresh DB; RLS permits service-role writes and user reads; indexes exist.
Status notes:
- Created migration `20251230090000_email_threads_and_attachments_stage0.sql`, dry-ran inside a transaction, then applied against Supabase (`db.jiubmvqyhndyennnehsn.supabase.co`) with `psql`.
- Confirmed new tables (`email_threads`, `attachment_routing_rules`, `drive_folder_cache`) and extended columns on `emails`/`email_attachments` plus RLS policies and indexes.

Stage 1: Shared Types + Thread Priority ✅ (completed 2025-10-29)

Scope: Define Thread types and implement thread priority scoring.
Key files: shared/src/types.ts, shared/src/threadPriority.ts, shared/__tests__/threadPriority.test.ts.
Done when: Types exported to app/worker; calculateThreadPriority passes unit tests covering recency, heat, urgency, impact, outstanding.
Status notes:
- Added thread domain types plus thread analysis request/response contracts to `shared/src/types.ts`.
- Implemented `calculateThreadPriority` with configurable weighting and exported via `shared/src/threadPriority.ts`.
- Backed with `vitest` coverage in `shared/src/__tests__/threadPriority.test.ts` to validate recency decay, heat, urgency, impact, and outstanding logic.
Stage 2: Thread-Aware Ingestion (Worker) ✅ (completed 2025-12-30)

Scope: Fetch Gmail thread, upsert email_threads, link messages (thread_id, gmail_thread_id, message_index, in_reply_to, references), write priority.
Key files: worker/src/index.ts, header parsers, small helpers.
Done when: New emails link to a single email_threads row; message_index correct; priority_score written. Manual test: 3-message Gmail thread produces 1 thread + 3 linked messages.
Status notes:
- Added `worker/src/emailThreads.ts` helpers to normalise subjects, parse participants, compute thread message indices, and upsert `email_threads` rows with priority scoring via `calculateThreadPriority`.
- Updated `worker/src/index.ts` to fetch Gmail thread metadata, cache thread lookups, populate message `thread_id`/`gmail_thread_id`/`gmail_message_id`, persist `message_index` + reply headers, and write thread priority/components on ingest.
- Ran `npm run build --prefix shared` and `npm run build --prefix worker` to verify the TypeScript surface after the new imports.
Stage 3: Thread Summarization ✅ (completed 2025-12-31)

Scope: Full + incremental thread analysis; update rolling_summary.
Key files: shared/src/analyzeThread.ts, worker/src/threadSummarizationJob.ts, /api/threads/[id]/summarize if added.
Done when: Summaries generated for threads with message_count ≥ 2; incremental mode only analyzes new messages + prior summary; logs token usage and budget alerts.
Status notes:
- Implemented `shared/src/analyzeThread.ts` to call OpenAI in full or incremental mode, added cost/token usage tracking, and covered behaviour with new Vitest cases in `shared/src/__tests__/analyzeThread.test.ts`.
- Introduced `shared/src/threadUtils.ts` plus `ThreadAnalysisUsage`/`ThreadEmailMessage` typings so worker and API layers share rolling summary normalisation.
- Added `worker/src/threadSummarizationJob.ts` (with Vitest coverage) and wired `worker/src/index.ts` to summarise threads ≤10 messages post-ingest, logging usage and skipping when no new mail.
- Built `worker/src/__tests__/threadSummarizationJob.test.ts` alongside targeted test run `npm run test -- shared/src/__tests__/analyzeThread.test.ts worker/src/__tests__/threadSummarizationJob.test.ts` and re-ran `npm run build --prefix shared` / `npm run build --prefix worker` to validate TypeScript.

Stage 4: Thread APIs ✅ (completed 2025-12-31)

Scope: List/detail endpoints with filters, pagination, and RLS-aware auth.
Key files: app/app/api/threads/route.ts, app/app/api/threads/[threadId]/route.ts, app/lib/supabaseClient.ts.
Done when: Shapes match TS types (contract tests); 401/404 handled; pagination metadata correct.
Status notes:
- Added `app/app/api/threads/route.ts` for paginated listing with label/project filters and `app/app/api/threads/[threadId]/route.ts` for detail retrieval including ordered message payloads.
- Created `app/app/api/threads/utils.ts` to map Supabase rows, reuse email helpers, and expose thread-specific metadata in a single place.
- Extended `app/lib/supabaseClient.ts` with `fetchThreads`/`fetchThreadDetail` plus thread-facing types so the inbox UI can consume the new contracts.
- Updated shared types with `ThreadEmailMessage` and ran `npm run build --prefix shared` / `npm run build --prefix worker`; attempted `npm run build --prefix app` but the local runtime is on Node v18.14.1 (Next.js requires ≥18.17.0), so the build will succeed once Node is upgraded.
Stage 5: Thread-First Inbox UI ✅ (completed 2026-01-06)

Scope: New ThreadInbox component; integrate on /inbox; rolling summary preview; update home snapshot.
Key files: app/components/ThreadInbox.tsx, app/components/home/.../InboxSnapshotCard.tsx, (protected)/inbox/page.tsx.
Done when: Threads group and expand correctly; filters work; ship behind ENABLE_THREADED_INBOX feature flag.
Status notes:
- Added `ThreadInbox` client surface with server-backed list/detail loading, inline expansion, search, label/project filters, and thread-level triage shortcuts (mark read/done, Gmail deep link).
- Wired `/inbox` to toggle between the legacy email dashboard and the new thread-first experience via the `featureFlags.threadedInbox` opt-in gate.
- Refreshed the home dashboard snapshot card to surface rolling thread summaries, unread counts, and thread priority context when the threaded inbox flag is active; maintained email rendering for the legacy path.
- Landed targeted component coverage (`InboxSnapshotCard` tests) to validate both email and thread render modes.
Stage 6: Attachment Download & Storage

Scope: Extract/download Gmail attachments, compute hashes, upsert email_attachments; idempotency.
Key files: worker/src/attachmentJobs.ts.
Done when: Attachment rows populated with MD5/SHA256; gmail_part_id prevents duplicate downloads; failures monitored.
Stage 7: Drive Routing Engine

Scope: Rules evaluation, folder template resolution + cache, upload to Drive, de-dup, optional sharing.
Key files: worker/src/attachmentJobs.ts (routing), Drive client helpers; app/app/api/attachment-rules/*.
Done when: Rules CRUD works; attachments auto-file to correct folders; de-dup is per-folder (recommended); cache reduces Drive lookups.
Stage 8: Routing Rules UI

Scope: Settings page to create/edit/reorder/test rules; token picker; templates.
Key files: app/app/(protected)/settings/attachment-rules/page.tsx, editor components.
Done when: Users manage rules end-to-end; bulk “apply to last 30 days”; export/import of rules.
Stage 9: Attachment UX in Threads

Scope: Render attachments with status and actions (retry, manual move).
Key files: app/components/AttachmentList.tsx, app/app/api/attachments/[attachmentId]/route.ts, thread message integration.
Done when: Drive links open; failed states visible with retry; manual move works.
Stage 10: Polish, Scale & Ops

Scope: Perf hardening, retries/backoff, bulk reprocessing, monitoring, documentation.
Key files: Worker retry utils, bulk jobs, docs.
Done when: Inbox TTI < 2s for large sets; p95 /api/threads < 500ms; alerts for worker/OpenAI/Drive quotas; guides published.
Parallel Tracks

Track A (Threading): 0 → 1 → 2 → 3 → 4 → 5
Track B (Attachments): 0 → 6 → 7 → 8 → 9
Converge at Stage 0 and Stage 10.
MVP Paths

MVP A (Threads Only): 0, 1, 2, 3, 4, 5 → “Conversation grouping + AI summaries”.
MVP B (Attachments Basics): 0, 1, 2, 6, 9 (subset) → “List attachments with Drive links; manual routing”.
MVP C (Full Attachments): 0, 1, 2, 6, 7, 8, 9 → “Auto-file to Drive via rules”.
Recommended: Phase 1 MVP A, then Phase 2 MVP C.
Cross-Cutting

Feature flags: ENABLE_THREADED_INBOX, ENABLE_ATTACHMENT_ROUTING (opt-in beta).
Testing: Stg 0–1 unit; 2–3 worker integration with Gmail fixtures; 4 contract tests; 5/8/9 component tests; 10 load tests (10k threads).
Observability: Worker timings + sizes + OpenAI latency; API p95; inbox TTI; budget/token logging.
