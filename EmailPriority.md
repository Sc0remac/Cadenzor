# Email Priority Scoring Overview

Kazador assigns every inbox message a numeric `priority_score` on a **0-100 scale**. The score is calculated by summing multiple components, with the final result capped at 100 to ensure consistent prioritization. All components can be configured under **Settings → Priorities**, with different levels of control for administrators and regular users.

## 1. Category weight
- Each primary email label (for example `BOOKING/Offer`, `LEGAL/Contract_Draft`) has a base weight (10-35 range).
- Most urgent categories (LEGAL/Contract_Executed, FINANCE/Banking_Details, BOOKING/Reschedule_or_Cancel, LOGISTICS/Visas_Immigration) default to 35.
- Moderate priority categories (BOOKING/Offer, LEGAL/Contract_Draft, FINANCE/Invoice) range from 30-33.
- Lower priority categories (PROMO, ASSETS) range from 20-29.
- Uncategorised mail falls back to the *default category weight* of 18.
- **User privilege**: Regular users can adjust weights ±10 from defaults; admins have full 0-100 control.

## 2. Idle age bonus
- Messages accumulate points the longer they sit without action.
- Three windows control the curve:
  - **Short** (0-4h): Multiplier of 2.0 → adds up to ~8 points
  - **Medium** (4-24h): Base 6 + 0.9×hours → adds up to ~24 points total
  - **Long** (24h+): Base 16 + 0.6×hours (capped at +12) → adds up to ~28 points max
- Snoozed threads apply the `snoozeAgeReduction` factor (0.65) so sleeping items don't continue rising aggressively.
- **User privilege**: Admin-only setting. Regular users cannot modify idle age calculations.

## 3. Unread bonus
- Adds a fixed amount (default: 8 points) whenever the message is still unread.
- **User privilege**: User setting. All users can adjust this value (0-20 range recommended).

## 4. Triage state adjustments
- Manual triage affects the score:
  - `unassigned`: +5 points (new/unprocessed)
  - `acknowledged`: -3 points (seen but not actioned)
  - `snoozed`: -10 points (deliberately deferred)
  - `resolved`: -30 points (completed/archived)
- **User privilege**: Admin-only setting.

## 5. Cross-label boosts
- Secondary labels (such as `approval/`, `risk/`, `status/pending_reply`) add fixed boosts:
  - `approval/`: +10 points (requires approval)
  - `risk/`: +10 points (flagged risk)
  - `status/escalated`: +8 points (escalated thread)
  - `status/pending_reply`: +6 points (awaiting reply)
- **User privilege**: Admin-only setting.

## 6. Advanced boosts
- Rich criteria-based boosts targeting:
  - Specific senders or domains (e.g., VIP senders: +5 points)
  - Keywords in the subject
  - Categories or secondary labels
  - Presence/absence of attachments (e.g., attachments: +3 points)
  - Minimum existing priority threshold
- Ideal for VIP supplier treatment or highlighting attachment-heavy messages.
- **User privilege**: Admin-only setting.

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
- **Category weight sliders** (User: ±10 from defaults | Admin: full 0-100 control)
- **Unread bonus & manual weighting** (User settings)
- **Idle-age & triage adjustments** (Admin-only)
- **Cross-label boosts** (Admin-only)
- **Advanced boosts and inbox action rules** (Admin-only)
- **Preset management, import/export, and scheduling** (User can select | Admin can create/modify)

Every change can be previewed against sample emails before saving. The resulting combination of these components equals the priority each inbox card displays.

---

## User Privileges Summary

### **Regular Users**
Can configure:
- **Category weights**: Adjust ±10 from system defaults
- **Unread bonus**: Full control (0-20 recommended)
- **Model priority weight**: Blend AI scores (0-1)
- **Snooze reduction**: How much to de-prioritize snoozed items (0-1)
- **Preset selection**: Choose from admin-defined presets
- **Scheduled presets**: Auto-apply presets by day/time

Cannot configure:
- Idle age formulas (complex system-wide calculations)
- Triage state adjustments
- Cross-label boost rules
- Advanced boost criteria
- Action rules
- Conflict & dependency penalties

### **Administrators**
Full access to all settings, including:
- Category weights (full 0-100 range)
- All system-wide formulas and multipliers
- Advanced boost criteria (VIP lists, domain rules)
- Cross-label boost definitions
- Preset creation and modification
- Timeline conflict & dependency penalties

---

## Example Priority Calculation (0-100 Scale)

**Sample email:** Legal contract draft from VIP sender, unread, received 6 hours ago, has attachment

**Components:**
1. Category weight (`LEGAL/Contract_Draft`): **33**
2. Idle age (6 hours in medium window): 6 + (6-4)×0.9 = **7.8** → **8**
3. Unread bonus: **8**
4. Triage state (`unassigned`): **+5**
5. Cross-label boost (none): **0**
6. Advanced boost (VIP sender): **+5**
7. Advanced boost (has attachment): **+3**

**Total:** 33 + 8 + 8 + 5 + 0 + 5 + 3 = **62**

✅ **Final priority: 62** (within 0-100 range, no capping needed)

---

**Sample email 2:** Old booking offer from regular sender, read and acknowledged, received 48 hours ago

**Components:**
1. Category weight (`BOOKING/Offer`): **32**
2. Idle age (48 hours in long window): 16 + min(12, (48-24)×0.6) = 16 + 12 = **28**
3. Unread bonus (read): **0**
4. Triage state (`acknowledged`): **-3**
5. Cross-label boost (none): **0**
6. Advanced boost (none): **0**

**Total:** 32 + 28 + 0 - 3 = **57**

✅ **Final priority: 57** (balanced priority for an acknowledged but aging offer)

