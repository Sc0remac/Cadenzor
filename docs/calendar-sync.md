# Calendar Sync Foundation

This note captures the initial state and design decisions before wiring the Google Calendar integration.

## Token inventory (2024-10)

Querying `oauth_accounts` in Supabase shows the currently stored Google scopes:

```
SELECT account_email, scopes
FROM oauth_accounts
WHERE provider = 'google';
```

Outcome (10 Oct 2024):

- `kerrcormac@gmail.com` — Gmail + Drive scopes are present. Calendar scopes will be appended automatically the next time the user reconnects (the callback union logic adds `https://www.googleapis.com/auth/calendar.readonly` and `https://www.googleapis.com/auth/calendar.events`). No other Google accounts are connected yet.

_Action_: after deploying calendar support, re-run the consent flow for each test user so the new scopes are persisted.

## Calendar selection model

- Calendars are linked per project using `project_sources` (`kind = 'calendar'`).
- The user explicitly chooses a calendar from their Google account; no implicit primary-calendar sync.
- Multiple calendars can be attached to the same project (e.g. artist team calendar + agency routing calendar).
- Each source records: Google account e-mail, calendar id, summary, time zone, and the user who connected it.
- Other editors can view sources but only the owner (or anyone with the same Google account connected) can pull events until we add shared service credentials.

## Event mapping (minimum viable fields)

| Google field | Kazador usage |
| --- | --- |
| `summary` | Timeline title |
| `description` (plain text) | Stored as description (HTML stripped) |
| `start` / `end` (dateTime/date) | `start_at` / `end_at`, default to calendar time zone |
| `status` (`confirmed`, `tentative`, `cancelled`) | `TimelineItemStatus` |
| `conferenceData.entryPoints` / description links | `links.meetingUrl` for “Join” button |
| `location` | `labels.city`, `labels.territory` (best-effort parse) |
| `organizer` / `attendees` | Stored in `metadata` for future linking |
| `id` | `links.calendarId` (primary key for updates) |
| `extendedProperties.private` | Reserved for Kazador ↔ Google linking |

Default lane/type heuristics:

- `show`, `gig`, `hold` → `LIVE_HOLDS`
- `travel`, `flight`, `train`, `transfer` → `TRAVEL`
- `interview`, `press`, `radio`, `promo`, `rehearsal` → `PROMO`
- `contract`, `legal`, `review` → `LEGAL`
- otherwise → `PROMO`

These decisions unlock the Block 1–2 implementation without blocking later automation (two-way sync, background polling, approvals).

## UI hotspots for the first release

- **Project hub → Sources**: show connected calendars alongside Drive folders with a “Pull events” CTA and last-sync timestamp.
- **Project timeline (Studio + Calendar view)**: visual badge + "Join" button when `links.meetingUrl` exists.
- **Home dashboard**: replace the placeholder panel with "Today’s meetings" sourced from ingested calendar events.
- **Digest / conflict indicators**: rely on existing priority + conflict plumbing once events are stored as `project_items`.
