-- Enable RLS and define base policies for contacts & emails tables if they exist.
DO $$
BEGIN
  IF to_regclass('public.contacts') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY';

    BEGIN
      EXECUTE 'CREATE POLICY contacts_service_role_all ON public.contacts FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      EXECUTE 'CREATE POLICY contacts_anon_read ON public.contacts FOR SELECT USING (true)';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.emails') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.emails FORCE ROW LEVEL SECURITY';

    BEGIN
      EXECUTE 'CREATE POLICY emails_service_role_all ON public.emails FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;

    BEGIN
      EXECUTE 'CREATE POLICY emails_anon_read ON public.emails FOR SELECT USING (true)';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END
$$;
