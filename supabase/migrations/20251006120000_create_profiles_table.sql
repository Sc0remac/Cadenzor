create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text,
  company text,
  phone text,
  location text,
  bio text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.profiles is 'Stores additional profile information for Cadenzor users';

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as
$$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_profiles_updated_at();

alter table public.profiles enable row level security;

create policy "Users can view their profile"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "Users can create their profile"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "Users can update their profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as
$$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
