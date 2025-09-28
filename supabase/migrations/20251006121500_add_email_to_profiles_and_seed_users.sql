alter table public.profiles
  add column if not exists email text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as
$$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce((new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        updated_at = timezone('utc', now());

  return new;
end;
$$;

update public.profiles as p
set email = u.email
from auth.users as u
where p.id = u.id
  and (p.email is distinct from u.email);

do
$$
declare
  oran_id uuid;
begin
  select id into oran_id
  from auth.users
  where email = 'oran@cadenzor.com';

  if oran_id is null then
    insert into auth.users (
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_user_meta_data,
      raw_app_meta_data
    )
    values (
      gen_random_uuid(),
      'authenticated',
      'authenticated',
      'oran@cadenzor.com',
      '$2y$12$NkgiTQh471zGvCiSZ.Zy6OegGyY4sK1JcJ4o/bMQQCldDf.502DdG',
      timezone('utc', now()),
      jsonb_build_object('full_name', 'Oran Team Member'),
      jsonb_build_object('provider', 'email', 'providers', array['email'])
    )
    returning id into oran_id;
  end if;

  insert into public.profiles (id, email, full_name, company, role)
  values (
    oran_id,
    'oran@cadenzor.com',
    'Oran Team Member',
    'Cadenzor',
    'Admin'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        company = excluded.company,
        role = excluded.role,
        updated_at = timezone('utc', now());
end;
$$;

alter table public.profiles
  add constraint profiles_email_unique unique (email);
