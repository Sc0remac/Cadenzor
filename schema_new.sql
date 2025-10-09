-- Timeline Studio refinements: structured entry typing and facet payloads
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type typ
    JOIN pg_namespace nsp ON nsp.oid = typ.typnamespace
    WHERE typ.typname = 'timeline_entry_type'
      AND nsp.nspname = 'public'
  ) THEN
    CREATE TYPE public.timeline_entry_type AS ENUM (
      'milestone',
      'task',
      'email',
      'meeting',
      'interview',
      'promo',
      'note',
      'comment',
      'travel',
      'hold'
    );
  END IF;
END
$$;

ALTER TABLE public.timeline_items
  ADD COLUMN IF NOT EXISTS entry_type public.timeline_entry_type DEFAULT 'task',
  ADD COLUMN IF NOT EXISTS entry_payload jsonb DEFAULT '{}'::jsonb;

UPDATE public.timeline_items
SET entry_type = CASE
  WHEN type = 'milestone' OR type = 'gate' THEN 'milestone'
  WHEN (metadata ->> 'entryType') ILIKE 'email%' THEN 'email'
  WHEN (metadata ->> 'entryType') ILIKE 'meeting%' THEN 'meeting'
  WHEN (metadata ->> 'entryType') ILIKE 'interview%' THEN 'interview'
  WHEN (metadata ->> 'entryType') ILIKE 'promo%' OR type IN ('event', 'lead') THEN 'promo'
  WHEN (metadata ->> 'entryType') ILIKE 'note%' THEN 'note'
  WHEN (metadata ->> 'entryType') ILIKE 'comment%' THEN 'comment'
  WHEN (metadata ->> 'entryType') ILIKE 'travel%' THEN 'travel'
  WHEN type = 'hold' THEN 'hold'
  ELSE 'task'
END
WHERE entry_type = 'task';

CREATE TABLE IF NOT EXISTS public.timeline_entry_facets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_item_id uuid NOT NULL REFERENCES public.timeline_items(id) ON DELETE CASCADE,
  type public.timeline_entry_type NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (timeline_item_id)
);

CREATE INDEX IF NOT EXISTS timeline_entry_facets_type_idx
  ON public.timeline_entry_facets (type);

CREATE OR REPLACE FUNCTION public.touch_timeline_entry_facets()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_touch_timeline_entry_facets ON public.timeline_entry_facets;
CREATE TRIGGER trigger_touch_timeline_entry_facets
  BEFORE UPDATE ON public.timeline_entry_facets
  FOR EACH ROW EXECUTE FUNCTION public.touch_timeline_entry_facets();

CREATE INDEX IF NOT EXISTS timeline_items_entry_type_idx
  ON public.timeline_items (entry_type, project_id, starts_at);

COMMIT;
