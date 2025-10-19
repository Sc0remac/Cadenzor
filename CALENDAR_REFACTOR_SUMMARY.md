# Calendar Integration Refactor - User-Level Calendars

## Problem

After completing Google Calendar OAuth, users couldn't sync calendars because the system required calendars to be connected to **specific projects**, but there was no automatic flow to create these connections.

## Solution

Refactored calendar integration from **project-level** to **user-level**:

- ✅ Calendars are now connected to users, not projects
- ✅ After OAuth, all user calendars are automatically connected
- ✅ "Sync Calendar" works immediately without additional configuration
- ✅ View all calendar events in one place at `/calendar/inbox`

## Changes Made

### 1. Database Migration

**File:** `supabase/migrations/20251219120000_user_calendar_sources.sql`

Creates:
- New `user_calendar_sources` table for user-level calendar connections
- Updates `calendar_events` to support both project and user sources
- Adds RLS policies for security
- Indexes for performance

**To apply:** Run this SQL in your Supabase SQL Editor:
```sql
-- Copy the contents of supabase/migrations/20251219120000_user_calendar_sources.sql
-- and execute in Supabase SQL Editor
```

### 2. Type Updates

**File:** `shared/src/types.ts`

Added:
- `UserCalendarSourceRecord` interface
- Updated `CalendarEventRecord` to include `userSourceId` and `userSource`

### 3. API Endpoints Created

#### `/api/integrations/google-calendar/sources` (New)
- `GET` - List all user-level calendar sources
- `POST` - Connect a calendar to the user
- `DELETE` - Disconnect a calendar

#### `/api/integrations/google-calendar/sync` (New)
- `POST` - Sync all user calendars (fetches events from last 30 days to 90 days ahead)

#### `/api/calendar/sources` (Updated)
- Now returns user-level sources instead of project-level

### 4. OAuth Callback Enhancement

**File:** `app/app/api/integrations/google-calendar/oauth/callback/route.ts`

After successful OAuth, automatically:
1. Fetches all user's Google Calendars
2. Creates `user_calendar_sources` records for each calendar
3. User can immediately sync and view events

### 5. Calendar Inbox Page Updates

**File:** `app/app/(protected)/calendar/inbox/page.tsx`

- Updated to use user-level calendar sources
- "Sync calendars" button now calls `/api/integrations/google-calendar/sync`
- Shows sync summary (X new, Y updated)

## How It Works Now

### User Flow

1. **Connect Google Calendar**
   - User goes to Settings → Integrations
   - Clicks "Connect Google Calendar"
   - Completes OAuth flow
   - ✅ **All calendars are automatically connected!**

2. **View & Sync Events**
   - User navigates to Calendar Inbox (`/calendar/inbox`)
   - Clicks "Sync calendars"
   - ✅ **All events are fetched and displayed immediately!**

3. **Manage Events** (working as before)
   - View all events from all calendars
   - Filter by calendar, assigned/unassigned, show/hide ignored
   - Assign events to projects (optional)
   - Ignore events

### API Flow

```
OAuth Complete
    ↓
Auto-fetch Google Calendars
    ↓
Create user_calendar_sources records
    ↓
User clicks "Sync Calendar"
    ↓
POST /api/integrations/google-calendar/sync
    ↓
For each user_calendar_source:
  - Fetch events from Google Calendar
  - Upsert to calendar_events table
    ↓
Return summary (X new, Y updated)
    ↓
Reload and display events
```

## Database Schema

### `user_calendar_sources` Table

```sql
CREATE TABLE user_calendar_sources (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  calendar_id text NOT NULL,
  account_id uuid NOT NULL REFERENCES oauth_accounts(id),
  summary text NOT NULL,
  timezone text,
  primary_calendar boolean DEFAULT false,
  access_role text,
  metadata jsonb,
  last_synced_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  UNIQUE(user_id, calendar_id)
);
```

### `calendar_events` Table Updates

```sql
ALTER TABLE calendar_events
  ADD COLUMN user_source_id uuid REFERENCES user_calendar_sources(id),
  ALTER COLUMN source_id DROP NOT NULL;

-- Constraint: events must have exactly one source
ALTER TABLE calendar_events
  ADD CONSTRAINT calendar_events_one_source_check
  CHECK (
    (source_id IS NOT NULL AND user_source_id IS NULL) OR
    (source_id IS NULL AND user_source_id IS NOT NULL)
  );
```

## Migration Steps

### Step 1: Apply Database Migration

Run the SQL migration in Supabase SQL Editor:

```bash
# Open Supabase Dashboard → SQL Editor
# Copy and paste contents of:
# supabase/migrations/20251219120000_user_calendar_sources.sql
```

### Step 2: Rebuild Shared Package

```bash
cd /Users/cormackerr/Desktop/Cadenzor
npm run build --workspace=shared
```

### Step 3: Restart Next.js Dev Server

```bash
cd /Users/cormackerr/Desktop/Cadenzor/app
npm run dev
```

### Step 4: Test the Flow

1. Go to Settings → Integrations
2. Click "Connect Google Calendar"
3. Complete OAuth
4. Go to Calendar Inbox (`/calendar/inbox`)
5. Click "Sync calendars"
6. ✅ See your events!

## Future Enhancements (Optional)

### Project-Level Calendar Integration

You mentioned you may want project-specific calendars later. The architecture supports this:

**Option A:** Keep both user and project calendars
- User calendars: Global view of all events
- Project calendars: Project-specific calendar sources (already supported via `project_sources`)

**Option B:** Link user calendar events to projects
- Events start as user-level
- Users can assign them to projects via the inbox
- Already supported! (see `assigned_project_id` column)

### Create Events from App → Google Calendar

To push events TO Google Calendar:

1. Create API endpoint: `POST /api/integrations/google-calendar/events`
2. Use `googleCalendarClient.createCalendarEvent()` (already implemented)
3. Add "Create Event" button in Calendar page
4. Select which calendar to create in
5. Push to Google Calendar

Example implementation:

```typescript
// app/app/api/integrations/google-calendar/events/route.ts
export async function POST(request: Request) {
  const { calendarId, summary, start, end, description, location } = await request.json();

  const account = await getCalendarAccount(supabase, { userId: user.id });
  const authClient = await ensureCalendarOAuthClient(supabase, account);
  const calendar = createCalendarClient(authClient);

  const event = await createCalendarEvent(calendar, calendarId, {
    summary,
    description,
    location,
    start: { dateTime: start },
    end: { dateTime: end },
  });

  // Optionally store in calendar_events table
  return NextResponse.json({ event });
}
```

## Files Modified/Created

### Created
- `supabase/migrations/20251219120000_user_calendar_sources.sql`
- `app/app/api/integrations/google-calendar/sources/route.ts`
- `app/app/api/integrations/google-calendar/sync/route.ts`
- `CALENDAR_REFACTOR_SUMMARY.md` (this file)

### Modified
- `shared/src/types.ts`
- `app/app/api/integrations/google-calendar/oauth/callback/route.ts`
- `app/app/api/calendar/sources/route.ts`
- `app/app/(protected)/calendar/inbox/page.tsx`
- `app/lib/supabaseClient.ts`

## Summary

The calendar integration now works **immediately after OAuth** with zero additional configuration:

**Before:**
1. Connect Google Calendar OAuth ✅
2. Manually connect each calendar to each project ❌ (confusing!)
3. Sync calendar events

**After:**
1. Connect Google Calendar OAuth ✅
2. ✅ **All calendars auto-connected, ready to sync!**
3. Sync calendar events ✅

The error "No calendars are connected yet" is now fixed because calendars are automatically connected during the OAuth callback flow.
