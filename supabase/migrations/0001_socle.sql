-- ShiftOS — socle. Tout copier, tout exécuter. Voir supabase/README.md pour le pourquoi.

-- 1. Extensions

create extension if not exists "pgcrypto";

-- 2. Magasins

create table stores (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  brand        text,
  address      text        not null,
  city         text        not null,
  postal_code  text        not null,
  country      text        not null,
  timezone     text        not null default 'Europe/Paris',
  config       jsonb       not null default '{}'::jsonb,
  first_run_completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 3. Rôles et comptes

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum ('manager');
  end if;
end;
$$;

create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  store_id   uuid        not null references stores(id) on delete cascade,
  role       app_role    not null default 'manager',
  email      text        not null,
  full_name  text,
  created_at timestamptz not null default now()
);

create index profiles_store_id_idx on profiles(store_id);

create or replace function current_store_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select store_id from profiles where id = auth.uid()
$$;

-- 4. Configuration du magasin

create table sectors (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid        not null references stores(id) on delete cascade,
  name         text        not null,
  status       text        not null default 'active',
  market_zone  boolean     not null default false,
  position     integer     not null default 0,
  config       jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index sectors_store_id_idx on sectors(store_id);

create table employees (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid        not null references stores(id) on delete cascade,
  first_name    text        not null,
  last_name     text        not null,
  email         text,
  phone         text,
  status        text        not null default 'active',
  contract_type text,
  weekly_minutes integer,
  profile       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index employees_store_id_idx on employees(store_id);
create index employees_store_status_idx on employees(store_id, status);

-- 5. Opérations

create table absences (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid        not null references stores(id) on delete cascade,
  employee_id uuid        not null references employees(id) on delete cascade,
  type        text        not null,
  start_date  date        not null,
  end_date    date        not null,
  status      text        not null default 'active',
  detail      jsonb       not null default '{}'::jsonb,
  recorded_on timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index absences_store_range_idx on absences(store_id, start_date, end_date);
create index absences_employee_idx on absences(employee_id);

create table absence_rules (
  store_id   uuid primary key references stores(id) on delete cascade,
  rules      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table holidays (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid        not null references stores(id) on delete cascade,
  year       integer     not null,
  days       jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (store_id, year)
);

create table plannings (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid        not null references stores(id) on delete cascade,
  week_key     text        not null,
  week_start   date        not null,
  status       text        not null default 'draft',
  sector_ids   uuid[]      not null default '{}',
  state        jsonb       not null default '{}'::jsonb,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index plannings_store_week_idx on plannings(store_id, week_key);
create index plannings_store_updated_idx on plannings(store_id, updated_at desc);

create table permanences (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid        not null references stores(id) on delete cascade,
  month_key  text        not null,
  state      jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, month_key)
);

create table paid_leave_campaigns (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid        not null references stores(id) on delete cascade,
  campaign_key text        not null,
  label        text,
  status       text        not null default 'draft',
  is_active    boolean     not null default false,
  state        jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (store_id, campaign_key)
);

-- 6. Horodatage automatique

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'stores', 'sectors', 'employees', 'absence_rules', 'holidays',
    'plannings', 'permanences', 'paid_leave_campaigns'
  ] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function touch_updated_at()', t, t);
  end loop;
end;
$$;

-- 7. Droits

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema public to authenticated';
    execute 'grant select, insert, update, delete on all tables in schema public to authenticated';
    execute 'grant execute on all functions in schema public to authenticated';
  end if;
end;
$$;

-- 8. Cloisonnement par magasin

alter table stores               enable row level security;
alter table profiles             enable row level security;
alter table sectors              enable row level security;
alter table employees            enable row level security;
alter table absences             enable row level security;
alter table absence_rules        enable row level security;
alter table holidays             enable row level security;
alter table plannings            enable row level security;
alter table permanences          enable row level security;
alter table paid_leave_campaigns enable row level security;

create policy "son propre profil" on profiles
  for select using (id = auth.uid());

create policy "son magasin" on stores
  for all using (id = current_store_id())
  with check (id = current_store_id());

do $$
declare t text;
begin
  foreach t in array array[
    'sectors', 'employees', 'absences', 'absence_rules', 'holidays',
    'plannings', 'permanences', 'paid_leave_campaigns'
  ] loop
    execute format(
      'create policy "cloisonne par magasin" on %I
         for all using (store_id = current_store_id())
         with check (store_id = current_store_id())', t);
  end loop;
end;
$$;
