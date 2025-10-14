-- Schema and seed data for configurable timeline lane definitions.

create table if not exists public.lane_definitions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users (id) on delete cascade,
    name text not null,
    slug text not null,
    description text,
    color text,
    icon text,
    sort_order integer not null default 0,
    auto_assign_rules jsonb,
    is_default boolean not null default true,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

do
$$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'lane_definitions_owner_slug_key'
    ) then
        alter table public.lane_definitions
            add constraint lane_definitions_owner_slug_key unique (user_id, slug);
    end if;
end
$$;

create unique index if not exists lane_definitions_global_slug_key
    on public.lane_definitions (slug)
    where user_id is null;

create index if not exists lane_definitions_user_id_idx
    on public.lane_definitions (user_id);

do
$$
begin
    if not exists (
        select 1 from pg_trigger
        where tgname = 'set_lane_definitions_updated_at'
    ) then
        create trigger set_lane_definitions_updated_at
            before update on public.lane_definitions
            for each row execute function public.set_updated_at();
    end if;
end
$$;

alter table public.lane_definitions enable row level security;

do
$$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'lane_definitions'
<<<<<<< ours
          and polname = 'Lane definitions are viewable by owner or global'
    ) then
        execute $$create policy "Lane definitions are viewable by owner or global"
            on public.lane_definitions
            for select
            using (user_id is null or auth.uid() = user_id)$$;
=======
          and policyname = 'Lane definitions are viewable by owner or global'
    ) then
        execute format(
            'create policy %I on public.lane_definitions for select using (user_id is null or auth.uid() = user_id);',
            'Lane definitions are viewable by owner or global'
        );
>>>>>>> theirs
    end if;
end
$$;

do
$$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'lane_definitions'
<<<<<<< ours
          and polname = 'Lane definitions are insertable by owner'
    ) then
        execute $$create policy "Lane definitions are insertable by owner"
            on public.lane_definitions
            for insert
            with check ((user_id is null and auth.role() = 'service_role') or auth.uid() = user_id)$$;
=======
          and policyname = 'Lane definitions are insertable by owner'
    ) then
        execute format(
            'create policy %I on public.lane_definitions for insert with check ((user_id is null and auth.role() = ''service_role'') or auth.uid() = user_id);',
            'Lane definitions are insertable by owner'
        );
>>>>>>> theirs
    end if;
end
$$;

do
$$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'lane_definitions'
<<<<<<< ours
          and polname = 'Lane definitions are updatable by owner'
    ) then
        execute $$create policy "Lane definitions are updatable by owner"
            on public.lane_definitions
            for update
            using (auth.uid() = user_id)
            with check (auth.uid() = user_id)$$;
=======
          and policyname = 'Lane definitions are updatable by owner'
    ) then
        execute format(
            'create policy %I on public.lane_definitions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);',
            'Lane definitions are updatable by owner'
        );
>>>>>>> theirs
    end if;
end
$$;

do
$$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'lane_definitions'
<<<<<<< ours
          and polname = 'Lane definitions are deletable by owner'
    ) then
        execute $$create policy "Lane definitions are deletable by owner"
            on public.lane_definitions
            for delete
            using (auth.uid() = user_id)$$;
=======
          and policyname = 'Lane definitions are deletable by owner'
    ) then
        execute format(
            'create policy %I on public.lane_definitions for delete using (auth.uid() = user_id);',
            'Lane definitions are deletable by owner'
        );
>>>>>>> theirs
    end if;
end
$$;

insert into public.lane_definitions (name, slug, description, color, icon, sort_order, auto_assign_rules, is_default, user_id)
select * from (values
    ('Live / Holds', 'LIVE_HOLDS', 'Active show bookings and confirmed holds', '#7c3aed', null, 100, null, true, null),
    ('Travel', 'TRAVEL', 'Flights, hotels, and itinerary segments', '#0284c7', null, 200, null, true, null),
    ('Promo', 'PROMO', 'Press, promo slots, and marketing beats', '#0f766e', null, 300, null, true, null),
    ('Release', 'RELEASE', 'Release milestones and content drops', '#f97316', null, 400, null, true, null),
    ('Legal', 'LEGAL', 'Contracts, compliance, and legal checkpoints', '#dc2626', null, 500, null, true, null),
    ('Finance', 'FINANCE', 'Budgeting, payments, and financial tasks', '#06b6d4', null, 600, null, true, null)
) as seed(name, slug, description, color, icon, sort_order, auto_assign_rules, is_default, user_id)
where not exists (
    select 1
    from public.lane_definitions existing
    where existing.slug = seed.slug
      and ((existing.user_id is null and seed.user_id is null) or existing.user_id = seed.user_id)
);
