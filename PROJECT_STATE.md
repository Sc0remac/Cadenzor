# Kazador Delivery Status – December 2025

## Verified Implementation Snapshot
- **Priority configuration is live** – `/settings/priorities` UI, API (`app/app/api/priority-config/**/*`), shared normalisers, and worker ingestion all read/write `user_preferences.priority_config` so user-tuned weights now drive scoring (`worker/src/digestJob.ts`, `shared/src/projectPriority.ts`).
- **Automation rules are stored, not executed** – `/settings/automations` edits rules and persists them to `automation_rules`, but no worker evaluates triggers or writes to `automation_rule_executions`; workflows remain manual.
- **Configurable timeline lanes ship end to end** – lane CRUD, auto-assignment builder, `/api/timeline-lanes/*`, and task creation auto-route items via `resolveAutoAssignedLane`; reapply endpoint updates existing tasks.
- **Drive integration surfaces in UI/API** – OAuth, folder connect/reindex, asset linking, and filing hooks exist (`app/lib/driveIndexer.ts`, `/api/projects/[projectId]/drive/*`), but the Gmail worker still stores attachments only in Supabase and never calls the Drive routines.
- **Digest generation runs nightly** – worker builds payloads using personalised priority config and logs to `digests`, yet outbound delivery (email/Slack) and digest approvals remain unimplemented.

## Top Engineering Focus – Automation Rule Execution
Deliver the missing execution engine so stored rules actually drive work:
1. **Load enabled rules** from `automation_rules` per user/company inside relevant workers (start with the Gmail poller after classification).
2. **Evaluate triggers & conditions** using the shared normaliser/condition evaluator on message metadata, triage state, labels, and priority scores.
3. **Execute actions** by reusing existing APIs/utilities (create tasks, assign lanes, queue approvals) and record outcomes in `automation_rule_executions`.
4. **Add observability** – write status, error, and payload snapshots for the settings UI to surface run history.

This closes the highest-impact gap: Oran can finally self-configure playbooks without code edits, paving the way for follow-on actions (Drive filing, draft replies, approval routing).

## Remaining High-Impact Deliverables
- **Digest delivery & approvals** – trigger email/Slack sends, allow approvals straight from the digest, and expose per-channel status.
- **Inbox productivity tools** – threaded view, snooze, reply-draft generation with approvals, attachment filing, sentiment/urgency surfacing, and quick actions.
- **Contact & lead enrichment** – implement the reliability/brand-fit pipeline, Fire Enrich client, storage tables, and UI surfaces in Inbox, Projects, and Today.
- **Promo & routing intelligence** – travel-aware conflict checks, slot proposals, calendar hold generation, and timeline what-if helpers.
- **Calendar sync** – OAuth, calendar account storage, event mirroring for holds/confirmed shows, and conflict reconciliation UI.
- **Playbook expansion** – legal & settlement parsers, Drive filing automations, asset workflows, and per-rule approvals on top of the execution engine.
- **Monitoring & integrity hardening** – FK/constraint pass, job run tracking, alerting, and richer audit logging for workers and automation.
- **Voice capture → action engine** – embed mic capture, transcribe with on-device/Realtime ASR, classify intent, and auto-create tasks/projects with safety prompts and audit logs.
- **Drive intelligence upgrade** – extend indexing with embeddings, selective deep parsing, automated filing, and contextual asset surfacing across timeline, inbox, and playbooks.
- **Federated retrieval layer** – stand up pgvector-backed semantic search spanning emails, transcripts, Drive docs, and tasks to power global search, grounding for AI drafts, and context-aware suggestions.
- **Calendar autopilot & predictive insights** – integrate routing-aware calendar sync, live travel buffers, and ML-driven risk scoring so timelines, playbooks, and digests surface proactive guidance in real time.
