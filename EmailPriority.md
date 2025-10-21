# Email Priority Scoring Overview

Kazador assigns every inbox message a numeric `priority_score`. The score is a sum of the following components, all of which can be tuned under **Settings → Priorities**:

## 1. Category weight
- Each primary email label (for example `BOOKING/Offer`, `LEGAL/Contract_Draft`) has a base weight.
- Defaults come from the “Category weights” table; uncategorised mail falls back to the *default category weight*.

## 2. Idle age bonus
- Messages accumulate points the longer they sit without action.
- Three windows control the curve:
  - **Short** – rapid climb during the first hours.
  - **Medium** – steady gain up to the medium end.
  - **Long** – slower climb with an optional cap.
- Snoozed threads apply the `snoozeAgeReduction` factor so sleeping items don’t continue rising aggressively.

## 3. Unread bonus
- Adds a fixed amount (`unreadBonus`) whenever the message is still unread.

## 4. Triage state adjustments
- Manual triage affects the score using the values in the “Triage state adjustments” section:
  - `unassigned` bump
  - `acknowledged` reduction
  - `snoozed` reduction (on top of snooze age handling)
  - `resolved` large drop

## 5. Cross-label boosts
- Secondary labels (such as `approval/`, `risk/`, `status/pending_reply`) can add fixed boosts.
- Configure these in **Cross-label boosts**; each rule defines a prefix, weight, and description.

## 6. Advanced boosts (Phase 3)
- Rich criteria-based boosts. Each boost may target:
  - Specific senders or domains
  - Keywords in the subject
  - Categories or secondary labels
  - Presence/absence of attachments
  - Minimum existing priority
- Ideal for VIP supplier treatment or highlighting attachment-heavy messages.

## 7. Action rules (display only)
- Action rules do **not** modify the score.
- They inspect score, categories, triage state, etc. to show contextual buttons (playbooks, lead creation, external links) on the inbox cards.

---

### How the score is stored
1. The worker applies the configuration (per user, with project overrides if the email belongs to a project) during ingestion.
2. Manual reclassification APIs re-evaluate the score using the current config.
3. The final value is persisted in `emails.priority_score` and used across the inbox, Today digest, and project dashboards.

### Where to tune priorities
Navigate to **Settings → Priorities** for:
- Category weight sliders
- Idle-age & triage adjustments
- Cross-label boosts
- Advanced boosts and inbox action rules
- Preset management, import/export, and scheduling

Every change can be previewed against sample emails before saving. The resulting combination of these components equals the priority each inbox card displays.

