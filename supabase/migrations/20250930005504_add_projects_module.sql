-- Projects module core schema and policies

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_status') then
    create type public.project_status as enum ('active', 'paused', 'archived');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_member_role') then
    create type public.project_member_role as enum ('owner', 'editor', 'viewer');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_source_kind') then
    create type public.project_source_kind as enum ('drive_folder', 'sheet', 'calendar', 'external_url');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_link_source') then
    create type public.project_link_source as enum ('manual', 'ai', 'rule');
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'timeline_item_type') then
    create type public.timeline_item_type as enum ('event', 'milestone', 'task', 'hold', 'lead', 'gate');
  end if;
end;
$$;

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand_profile jsonb default '{}'::jsonb,
  default_rubric_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as
$$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid references public.artists(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  status public.project_status not null default 'active',
  start_date date,
  end_date date,
  color text,
  labels jsonb not null default '{}'::jsonb,
  priority_profile jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index projects_artist_id_slug_idx on public.projects (artist_id, slug);

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.project_member_role not null default 'viewer',
  created_at timestamptz not null default timezone('utc', now())
);

create unique index project_members_unique_member on public.project_members (project_id, user_id);

create table if not exists public.project_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind public.project_source_kind not null,
  external_id text not null,
  title text,
  watch boolean not null default false,
  scope text,
  metadata jsonb,
  last_indexed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index project_sources_unique_external on public.project_sources (project_id, kind, external_id);

create table if not exists public.project_item_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  ref_table text not null,
  ref_id text not null,
  confidence numeric(4,3) check (confidence between 0 and 1),
  source public.project_link_source not null default 'manual',
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index project_item_links_unique on public.project_item_links (project_id, ref_table, ref_id);

create table if not exists public.project_email_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email_id text not null,
  confidence numeric(4,3) check (confidence between 0 and 1),
  source public.project_link_source not null default 'manual',
  created_at timestamptz not null default timezone('utc', now())
);

create unique index project_email_links_unique on public.project_email_links (project_id, email_id);

create table if not exists public.timeline_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type public.timeline_item_type not null,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  lane text,
  territory text,
  status text,
  priority integer not null default 0,
  ref_table text,
  ref_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index timeline_items_project_starts_idx on public.timeline_items (project_id, starts_at);
create index timeline_items_project_ends_idx on public.timeline_items (project_id, ends_at);
create index timeline_items_project_priority_idx on public.timeline_items (project_id, priority desc);

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'todo',
  due_at timestamptz,
  priority integer not null default 0,
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index project_tasks_project_status_idx on public.project_tasks (project_id, status);

create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.project_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.project_templates(id) on delete cascade,
  item_type public.timeline_item_type not null,
  title text not null,
  lane text,
  offset_days integer default 0,
  duration_days integer default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.generate_project_slug()
returns trigger
language plpgsql
as
$$
declare
  base_slug text;
  candidate text;
  suffix integer := 1;
  existing uuid;
begin
  if new.slug is not null and length(trim(new.slug)) > 0 then
    new.slug := lower(regexp_replace(trim(new.slug), '[^a-zA-Z0-9]+', '-', 'g'));
    return new;
  end if;

  base_slug := lower(regexp_replace(trim(new.name), '[^a-zA-Z0-9]+', '-', 'g'));
  if base_slug is null or base_slug = '' then
    base_slug := encode(gen_random_bytes(4), 'hex');
  end if;

  candidate := base_slug;
  loop
    select id into existing from public.projects where slug = candidate limit 1;
    exit when existing is null;
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create trigger projects_generate_slug
before insert on public.projects
for each row
execute procedure public.generate_project_slug();

create trigger projects_set_updated_at
before update on public.projects
for each row execute procedure public.set_updated_at();

create trigger project_sources_set_updated_at
before update on public.project_sources
for each row execute procedure public.set_updated_at();

create trigger timeline_items_set_updated_at
before update on public.timeline_items
for each row execute procedure public.set_updated_at();

create trigger project_tasks_set_updated_at
before update on public.project_tasks
for each row execute procedure public.set_updated_at();

create or replace function public.ensure_project_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as
$$
begin
  insert into public.project_members (project_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (project_id, user_id) do update set role = excluded.role;
  return new;
end;
$$;

create trigger projects_insert_owner
after insert on public.projects
for each row when (new.created_by is not null)
execute procedure public.ensure_project_owner();

create or replace function public.is_project_member(project_id uuid, required_roles project_member_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as
$$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = project_id
      and pm.user_id = auth.uid()
      and (required_roles is null or pm.role = any(required_roles))
  );
$$;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_sources enable row level security;
alter table public.project_item_links enable row level security;
alter table public.project_email_links enable row level security;
alter table public.timeline_items enable row level security;
alter table public.project_templates enable row level security;
alter table public.project_template_items enable row level security;
alter table public.project_tasks enable row level security;

create policy projects_service_role_all on public.projects
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy projects_member_select on public.projects
  for select using (public.is_project_member(id));

create policy projects_owner_modify on public.projects
  for update using (
    public.is_project_member(id, ARRAY['owner']::public.project_member_role[])
  )
  with check (
    public.is_project_member(id, ARRAY['owner']::public.project_member_role[])
  );

create policy projects_owner_delete on public.projects
  for delete using (
    public.is_project_member(id, ARRAY['owner']::public.project_member_role[])
  );

create policy projects_owner_insert on public.projects
  for insert with check (auth.uid() = created_by);

create policy project_members_service_role_all on public.project_members
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy project_members_member_select on public.project_members
  for select using (public.is_project_member(project_id));

create policy project_members_owner_modify on public.project_members
  for insert with check (
    public.is_project_member(project_id, ARRAY['owner']::public.project_member_role[])
  );

create policy project_members_owner_update on public.project_members
  for update using (
    public.is_project_member(project_id, ARRAY['owner']::public.project_member_role[])
  )
  with check (
    public.is_project_member(project_id, ARRAY['owner']::public.project_member_role[])
  );

create policy project_members_owner_delete on public.project_members
  for delete using (
    public.is_project_member(project_id, ARRAY['owner']::public.project_member_role[])
  );

create policy project_sources_service_role_all on public.project_sources
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy project_sources_member_select on public.project_sources
  for select using (public.is_project_member(project_id));

create policy project_sources_editor_modify on public.project_sources
  for insert with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_sources_editor_update on public.project_sources
  for update using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  )
  with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_sources_editor_delete on public.project_sources
  for delete using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_item_links_service_role_all on public.project_item_links
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy project_item_links_member_select on public.project_item_links
  for select using (public.is_project_member(project_id));

create policy project_item_links_editor_modify on public.project_item_links
  for insert with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_item_links_editor_update on public.project_item_links
  for update using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  )
  with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_item_links_editor_delete on public.project_item_links
  for delete using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_email_links_service_role_all on public.project_email_links
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy project_email_links_member_select on public.project_email_links
  for select using (public.is_project_member(project_id));

create policy project_email_links_editor_modify on public.project_email_links
  for insert with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_email_links_editor_update on public.project_email_links
  for update using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  )
  with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_email_links_editor_delete on public.project_email_links
  for delete using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy timeline_items_service_role_all on public.timeline_items
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy timeline_items_member_select on public.timeline_items
  for select using (public.is_project_member(project_id));

create policy timeline_items_editor_insert on public.timeline_items
  for insert with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy timeline_items_editor_update on public.timeline_items
  for update using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  )
  with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy timeline_items_editor_delete on public.timeline_items
  for delete using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_templates_service_role_all on public.project_templates
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy project_templates_member_select on public.project_templates
  for select using (true);

create policy project_template_items_service_role_all on public.project_template_items
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy project_template_items_member_select on public.project_template_items
  for select using (true);

create policy project_tasks_service_role_all on public.project_tasks
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy project_tasks_member_select on public.project_tasks
  for select using (public.is_project_member(project_id));

create policy project_tasks_editor_insert on public.project_tasks
  for insert with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_tasks_editor_update on public.project_tasks
  for update using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  )
  with check (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

create policy project_tasks_editor_delete on public.project_tasks
  for delete using (
    public.is_project_member(project_id, ARRAY['owner','editor']::public.project_member_role[])
  );

insert into public.project_templates (name, slug, description, payload)
values
  ('Tour Leg', 'tour-leg', 'Seed timeline for a touring leg including travel and promo windows.', jsonb_build_object('default_lane', 'Live')),
  ('Single Release', 'single-release', 'Seed release milestones and promo send-outs.', jsonb_build_object('default_lane', 'Release')),
  ('Festival Weekend', 'festival-weekend', 'Plan a festival appearance with soundcheck and logistics.', jsonb_build_object('default_lane', 'Promo'))
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  payload = excluded.payload,
  updated_at = timezone('utc', now());

insert into public.project_template_items (id, template_id, item_type, title, lane, offset_days, duration_days, metadata)
select gen_random_uuid(), pt.id, 'event', 'Travel Day', 'Live', -1, 0, '{}'::jsonb
from public.project_templates pt
where pt.slug = 'tour-leg'
  and not exists (
    select 1 from public.project_template_items pti
    where pti.template_id = pt.id and pti.title = 'Travel Day'
  );

insert into public.project_template_items (id, template_id, item_type, title, lane, offset_days, duration_days, metadata)
select gen_random_uuid(), pt.id, 'event', 'Show Night', 'Live', 0, 0, '{}'::jsonb
from public.project_templates pt
where pt.slug = 'tour-leg'
  and not exists (
    select 1 from public.project_template_items pti
    where pti.template_id = pt.id and pti.title = 'Show Night'
  );

insert into public.project_template_items (id, template_id, item_type, title, lane, offset_days, duration_days, metadata)
select gen_random_uuid(), pt.id, 'milestone', 'Press Push', 'Promo', -7, 0, '{}'::jsonb
from public.project_templates pt
where pt.slug = 'tour-leg'
  and not exists (
    select 1 from public.project_template_items pti
    where pti.template_id = pt.id and pti.title = 'Press Push'
  );

insert into public.project_template_items (id, template_id, item_type, title, lane, offset_days, duration_days, metadata)
select gen_random_uuid(), pt.id, 'gate', 'Upload Masters', 'Release', -21, 0, '{}'::jsonb
from public.project_templates pt
where pt.slug = 'single-release'
  and not exists (
    select 1 from public.project_template_items pti
    where pti.template_id = pt.id and pti.title = 'Upload Masters'
  );

insert into public.project_template_items (id, template_id, item_type, title, lane, offset_days, duration_days, metadata)
select gen_random_uuid(), pt.id, 'milestone', 'Promo Send-Out', 'Promo', -14, 0, '{}'::jsonb
from public.project_templates pt
where pt.slug = 'single-release'
  and not exists (
    select 1 from public.project_template_items pti
    where pti.template_id = pt.id and pti.title = 'Promo Send-Out'
  );

insert into public.project_template_items (id, template_id, item_type, title, lane, offset_days, duration_days, metadata)
select gen_random_uuid(), pt.id, 'event', 'Release Day', 'Release', 0, 0, '{}'::jsonb
from public.project_templates pt
where pt.slug = 'single-release'
  and not exists (
    select 1 from public.project_template_items pti
    where pti.template_id = pt.id and pti.title = 'Release Day'
  );

insert into public.project_template_items (id, template_id, item_type, title, lane, offset_days, duration_days, metadata)
select gen_random_uuid(), pt.id, 'event', 'Soundcheck', 'Live', -1, 0, '{}'::jsonb
from public.project_templates pt
where pt.slug = 'festival-weekend'
  and not exists (
    select 1 from public.project_template_items pti
    where pti.template_id = pt.id and pti.title = 'Soundcheck'
  );

insert into public.project_template_items (id, template_id, item_type, title, lane, offset_days, duration_days, metadata)
select gen_random_uuid(), pt.id, 'event', 'Festival Set', 'Live', 0, 0, '{}'::jsonb
from public.project_templates pt
where pt.slug = 'festival-weekend'
  and not exists (
    select 1 from public.project_template_items pti
    where pti.template_id = pt.id and pti.title = 'Festival Set'
  );

insert into public.project_template_items (id, template_id, item_type, title, lane, offset_days, duration_days, metadata)
select gen_random_uuid(), pt.id, 'task', 'Capture Assets', 'Brand', 1, 0, '{}'::jsonb
from public.project_templates pt
where pt.slug = 'festival-weekend'
  and not exists (
    select 1 from public.project_template_items pti
    where pti.template_id = pt.id and pti.title = 'Capture Assets'
  );
