-- Add AI summary and multi-label support to emails table
DO $$
BEGIN
  IF to_regclass('public.emails') IS NOT NULL THEN
    ALTER TABLE public.emails
      ADD COLUMN IF NOT EXISTS summary text;

    ALTER TABLE public.emails
      ADD COLUMN IF NOT EXISTS labels jsonb;
  END IF;
END
$$;
