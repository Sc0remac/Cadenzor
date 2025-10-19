-- Google Calendar bidirectional sync migration
-- Run this script in the Supabase SQL editor to align the database schema with the application.

BEGIN;

-- Ensure supporting calendar source tables exist
CREATE TABLE IF NOT EXISTS public.user_calendar_sources (
    id uuid DEFAULT public.gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    calendar_id text NOT NULL,
    account_id uuid NOT NULL,
    summary text NOT NULL,
    timezone text,
    primary_calendar boolean DEFAULT false,
    access_role text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT user_calendar_sources_unique UNIQUE (user_id, calendar_id),
    CONSTRAINT user_calendar_sources_account_fkey FOREIGN KEY (account_id) REFERENCES public.oauth_accounts(id) ON DELETE CASCADE,
    CONSTRAINT user_calendar_sources_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_calendar_sources_user_idx ON public.user_calendar_sources (user_id);
CREATE INDEX IF NOT EXISTS user_calendar_sources_account_idx ON public.user_calendar_sources (account_id);

DROP TRIGGER IF EXISTS user_calendar_sources_set_updated_at ON public.user_calendar_sources;
CREATE TRIGGER user_calendar_sources_set_updated_at
BEFORE UPDATE ON public.user_calendar_sources
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_calendar_sources ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'user_calendar_sources'
          AND policyname = 'user_calendar_sources_owner_select'
    ) THEN
        EXECUTE 'CREATE POLICY user_calendar_sources_owner_select ON public.user_calendar_sources FOR SELECT USING (((auth.role() = ''service_role''::text) OR (auth.uid() = user_id)))';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'user_calendar_sources'
          AND policyname = 'user_calendar_sources_owner_modify'
    ) THEN
        EXECUTE 'CREATE POLICY user_calendar_sources_owner_modify ON public.user_calendar_sources FOR ALL USING (((auth.role() = ''service_role''::text) OR (auth.uid() = user_id))) WITH CHECK (((auth.role() = ''service_role''::text) OR (auth.uid() = user_id)))';
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.calendar_sync_states (
    id uuid DEFAULT public.gen_random_uuid() PRIMARY KEY,
    user_source_id uuid NOT NULL,
    sync_token text,
    last_polled_at timestamptz,
    last_error text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT calendar_sync_states_user_source_unique UNIQUE (user_source_id),
    CONSTRAINT calendar_sync_states_user_source_fkey FOREIGN KEY (user_source_id) REFERENCES public.user_calendar_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS calendar_sync_states_user_source_idx ON public.calendar_sync_states (user_source_id);

DROP TRIGGER IF EXISTS calendar_sync_states_set_updated_at ON public.calendar_sync_states;
CREATE TRIGGER calendar_sync_states_set_updated_at
BEFORE UPDATE ON public.calendar_sync_states
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.calendar_sync_states ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'calendar_sync_states'
          AND policyname = 'calendar_sync_states_owner_select'
    ) THEN
        EXECUTE 'CREATE POLICY calendar_sync_states_owner_select ON public.calendar_sync_states FOR SELECT USING ((auth.role() = ''service_role''::text))';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'calendar_sync_states'
          AND policyname = 'calendar_sync_states_owner_modify'
    ) THEN
        EXECUTE 'CREATE POLICY calendar_sync_states_owner_modify ON public.calendar_sync_states FOR ALL USING ((auth.role() = ''service_role''::text)) WITH CHECK ((auth.role() = ''service_role''::text))';
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.calendar_watch_channels (
    id uuid DEFAULT public.gen_random_uuid() PRIMARY KEY,
    user_source_id uuid NOT NULL,
    resource_id text NOT NULL,
    channel_id text NOT NULL,
    expiration_at timestamptz NOT NULL,
    last_renewed_at timestamptz,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT calendar_watch_channels_user_source_unique UNIQUE (user_source_id),
    CONSTRAINT calendar_watch_channels_channel_unique UNIQUE (channel_id),
    CONSTRAINT calendar_watch_channels_user_source_fkey FOREIGN KEY (user_source_id) REFERENCES public.user_calendar_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS calendar_watch_channels_user_source_idx ON public.calendar_watch_channels (user_source_id);

DROP TRIGGER IF EXISTS calendar_watch_channels_set_updated_at ON public.calendar_watch_channels;
CREATE TRIGGER calendar_watch_channels_set_updated_at
BEFORE UPDATE ON public.calendar_watch_channels
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.calendar_watch_channels ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'calendar_watch_channels'
          AND policyname = 'calendar_watch_channels_owner_select'
    ) THEN
        EXECUTE 'CREATE POLICY calendar_watch_channels_owner_select ON public.calendar_watch_channels FOR SELECT USING ((auth.role() = ''service_role''::text))';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'calendar_watch_channels'
          AND policyname = 'calendar_watch_channels_owner_modify'
    ) THEN
        EXECUTE 'CREATE POLICY calendar_watch_channels_owner_modify ON public.calendar_watch_channels FOR ALL USING ((auth.role() = ''service_role''::text)) WITH CHECK ((auth.role() = ''service_role''::text))';
    END IF;
END
$$;

-- Calendar event enrichment for Google sync
ALTER TABLE public.calendar_events
    ALTER COLUMN source_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calendar_events'
          AND column_name = 'user_source_id'
    ) THEN
        ALTER TABLE public.calendar_events ADD COLUMN user_source_id uuid;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calendar_events'
          AND column_name = 'origin'
    ) THEN
        ALTER TABLE public.calendar_events ADD COLUMN origin text DEFAULT 'google'::text;
    END IF;
    ALTER TABLE public.calendar_events ALTER COLUMN origin SET DEFAULT 'google'::text;
    ALTER TABLE public.calendar_events ALTER COLUMN origin SET NOT NULL;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calendar_events'
          AND column_name = 'sync_status'
    ) THEN
        ALTER TABLE public.calendar_events ADD COLUMN sync_status text DEFAULT 'pending'::text;
    END IF;
    ALTER TABLE public.calendar_events ALTER COLUMN sync_status SET DEFAULT 'pending'::text;
    ALTER TABLE public.calendar_events ALTER COLUMN sync_status SET NOT NULL;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calendar_events'
          AND column_name = 'sync_error'
    ) THEN
        ALTER TABLE public.calendar_events ADD COLUMN sync_error text;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calendar_events'
          AND column_name = 'last_synced_at'
    ) THEN
        ALTER TABLE public.calendar_events ADD COLUMN last_synced_at timestamptz;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calendar_events'
          AND column_name = 'last_google_updated_at'
    ) THEN
        ALTER TABLE public.calendar_events ADD COLUMN last_google_updated_at timestamptz;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calendar_events'
          AND column_name = 'last_kazador_updated_at'
    ) THEN
        ALTER TABLE public.calendar_events ADD COLUMN last_kazador_updated_at timestamptz;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calendar_events'
          AND column_name = 'google_etag'
    ) THEN
        ALTER TABLE public.calendar_events ADD COLUMN google_etag text;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'calendar_events'
          AND column_name = 'pending_action'
    ) THEN
        ALTER TABLE public.calendar_events ADD COLUMN pending_action text;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS calendar_events_origin_idx ON public.calendar_events (origin);
CREATE INDEX IF NOT EXISTS calendar_events_sync_status_idx ON public.calendar_events (sync_status);
CREATE INDEX IF NOT EXISTS calendar_events_user_source_idx ON public.calendar_events (user_source_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'calendar_events_unique_user_event'
    ) THEN
        ALTER TABLE public.calendar_events
            ADD CONSTRAINT calendar_events_unique_user_event UNIQUE (user_source_id, event_id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'calendar_events_one_source_check'
    ) THEN
        ALTER TABLE public.calendar_events
            ADD CONSTRAINT calendar_events_one_source_check CHECK (
                (source_id IS NOT NULL AND user_source_id IS NULL)
                OR (source_id IS NULL AND user_source_id IS NOT NULL)
            );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'calendar_events_user_source_id_fkey'
    ) THEN
        ALTER TABLE public.calendar_events
            ADD CONSTRAINT calendar_events_user_source_id_fkey FOREIGN KEY (user_source_id) REFERENCES public.user_calendar_sources(id) ON DELETE CASCADE;
    END IF;
END
$$;

COMMIT;
