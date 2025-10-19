# Calendar Feature Progress (Blocks 3 & 4)

## Block 3 – Read-only Calendar Page
- Added `/calendar` page under the protected app router.
- Enables month/week/day navigation, today shortcut, and prev/next controls.
- Filters by project and lane using existing timeline explorer data.
- Displays timeline items (including imported Google Calendar events) with badges, join links, and metadata.
- Auto-centres the initial view on the earliest event for the selected project.
- Hooked the page into the global navigation via `AppShell`.

## Block 4 – Timeline ↔ Calendar Sync (create/update)
- Extended project timeline form with “Create in Google Calendar” toggle and source picker.
- Added API route `POST/PATCH /api/projects/:projectId/timeline/:itemId/calendar` for calendar mirroring.
- Built helper functions for building/updating Google events; stored sync metadata (`calendarSyncedAt`, `calendarSourceId`).
- Updated `TimelineStudio` cards to show calendar badges, sync timestamps, and an “Update calendar” quick action.
- Wired project settings → calendar sources to surface sync messages and status updates.
- Added Supabase client helpers (`createCalendarEventForTimelineItem`, `updateCalendarEventForTimelineItem`) for UI consumption.
- Logged calendar sync activity via the existing audit trail.

## Notes
- All calendar events are still stored as `project_items` for single-source-of-truth scheduling.
- Follow-up work: background sync job, dedicated calendar view enhancements, recurring event handling.
