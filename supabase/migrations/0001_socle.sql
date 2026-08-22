-- ShiftOS — le socle : magasins, comptes, et les neuf familles de données.
--
-- Deux partis pris, qui expliquent presque tout ce fichier.
--
-- 1. HYBRIDE, PAS TOUT NORMALISÉ. Ce qu'on filtre, trie ou relie devient une
--    colonne ; la configuration riche reste en `jsonb`, validée par les schémas
--    Zod qui existent déjà et qui tournent en production. Retranscrire 948
--    lignes de validation en colonnes aurait dupliqué la règle à deux endroits
--    — et c'est très exactement le risque numéro un du plan : perdre un réglage
--    en le traduisant.
--
-- 2. `store_id` PARTOUT, DÈS LA PREMIÈRE TABLE. Le multi-magasin n'est pas
--    activé et n'aura pas d'écran avant longtemps. Mais posée maintenant sur
--    des tables vides, cette colonne coûte une heure ; ajoutée plus tard sur
--    des tables pleines, elle impose une migration de toutes les données, la
--    réécriture de chaque requête et un audit de sécurité complet.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- Magasins et comptes
-- ─────────────────────────────────────────────────────────────────────────────

create table stores (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  brand        text,
  address      text        not null,
  city         text        not null,
  postal_code  text        not null,
  country      text        not null,
  timezone     text        not null default 'Europe/Paris',
  -- Horaires d'ouverture, mode de planification, politique de coupure et règles
  -- générales : `storeSchema` les valide, et lui seul sait comment.
  config       jsonb       not null default '{}'::jsonb,
  first_run_completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Un seul rôle existe, et c'est un choix produit assumé : le manager se
-- connecte, les salariés lisent la feuille publiée. La colonne est néanmoins
-- créée avec son type, parce que trente minutes aujourd'hui valent mieux que la
-- migration du jour où un salarié devra consulter son planning.
-- `create type` n'accepte pas `if not exists`. Sans ce garde, une migration
-- interrompue à mi-chemin ne se rejoue pas : la deuxième tentative meurt sur un
-- type déjà présent, et il faut aller nettoyer à la main pour réessayer.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum ('manager');
  end if;
end;
$$;

-- Le pont vers `auth.users`, que Supabase possède. On n'y touche pas : on
-- l'étend. Un compte appartient à un magasin, et c'est cette ligne qui porte le
-- cloisonnement dont tout le reste dépend.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  store_id   uuid        not null references stores(id) on delete cascade,
  role       app_role    not null default 'manager',
  email      text        not null,
  full_name  text,
  created_at timestamptz not null default now()
);

create index profiles_store_id_idx on profiles(store_id);

-- Le magasin de celui qui demande, lu une fois par requête.
--
-- `stable` et non `volatile` : le planificateur peut alors l'évaluer une seule
-- fois au lieu d'une fois par ligne, ce qui change tout sur une table de
-- plannings. `security definer` parce que la politique de `profiles` ne doit pas
-- avoir à s'auto-interroger pour se résoudre.
create or replace function current_store_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select store_id from profiles where id = auth.uid()
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Configuration du magasin
-- ─────────────────────────────────────────────────────────────────────────────

create table sectors (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid        not null references stores(id) on delete cascade,
  name         text        not null,
  status       text        not null default 'active',
  -- Sorti du blob parce que le moteur en dépend pour choisir son chemin : une
  -- zone marché ne se résout pas comme un secteur isolé.
  market_zone  boolean     not null default false,
  position     integer     not null default 0,
  -- Demande horaire, compétences, présence minimale, règles de coupure,
  -- équité des fermetures. La structure la plus riche du produit.
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
  -- Jamais supprimé, seulement désactivé : une fiche retirée emporterait
  -- l'histoire des plannings qui la citent.
  status        text        not null default 'active',
  contract_type text,
  weekly_minutes integer,
  -- Les ~70 champs de la fiche : disponibilités, droits d'ouverture et de
  -- fermeture, dimanche, permanence, aménagements temporaires.
  profile       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index employees_store_id_idx on employees(store_id);
create index employees_store_status_idx on employees(store_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- Opérations
-- ─────────────────────────────────────────────────────────────────────────────

create table absences (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid        not null references stores(id) on delete cascade,
  employee_id uuid        not null references employees(id) on delete cascade,
  type        text        not null,
  -- En colonnes, pas dans le blob : tout écran qui demande « qui est absent
  -- cette semaine » interroge cet intervalle.
  start_date  date        not null,
  end_date    date        not null,
  -- `cancel` marque, il ne retire pas : une absence saisie puis annulée est
  -- exactement ce qu'on cherche à reconstituer six mois plus tard.
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
  -- Semaine ISO, « 2026-W34 ». La clé par laquelle chaque écran cherche.
  week_key     text        not null,
  week_start   date        not null,
  status       text        not null default 'draft',
  sector_ids   uuid[]      not null default '{}',
  -- L'état complet de l'éditeur : créneaux, affectations, verrous, édition
  -- manuelle. Ce que `serializePlanning` produisait déjà.
  state        jsonb       not null default '{}'::jsonb,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Plusieurs plannings peuvent coexister sur la même semaine — un publié, un
-- brouillon issu de « modifier le publié ». L'index accélère sans interdire.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- `updated_at`, tenu par la base
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Confié à la base plutôt qu'au code : une seule écriture qui oublie de le
-- poser suffit à rendre la colonne inutilisable pour trier « les plus récents
-- d'abord », et cet oubli ne lève rien.

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

-- ─────────────────────────────────────────────────────────────────────────────
-- Cloisonnement : la deuxième serrure
-- ─────────────────────────────────────────────────────────────────────────────
--
-- L'application scelle déjà chaque dépôt avec le `store_id` de la session
-- vérifiée. Ces politiques ne remplacent pas cette barrière, elles la doublent
-- au cas où une requête serait un jour écrite en l'oubliant — et une base qui
-- refuse est infiniment préférable à une base qui répond les données du voisin.

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

-- Les droits, avant les politiques.
--
-- RLS décide qui voit QUOI ; les droits décident qui a le droit de demander.
-- Une table sans `grant` renvoie « permission denied » avant même qu'une
-- politique soit consultée — et l'erreur ne ressemble alors en rien à un
-- problème de cloisonnement, ce qui coûte une heure à comprendre.
--
-- Supabase pose des droits par défaut qui couvrent déjà ce cas. On les redit
-- quand même : une migration qui dépend d'un réglage invisible de la plateforme
-- est une migration qu'on ne peut pas rejouer ailleurs. Gardé par l'existence
-- des rôles, pour qu'un Postgres nu — celui des tests — l'ignore sans broncher.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema public to authenticated';
    execute 'grant select, insert, update, delete on all tables in schema public to authenticated';
    execute 'grant execute on all functions in schema public to authenticated';
  end if;
end;
$$;

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
