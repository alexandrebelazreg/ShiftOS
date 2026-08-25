-- Combien de temps on garde, et ce qui part quand le délai est passé.
-- Tout copier, tout exécuter. Voir docs/rgpd/README.md pour le pourquoi.

-- 1. La durée de conservation est une DONNÉE, pas une constante du code

create table if not exists retention_policies (
  subject    text primary key,
  months     integer not null check (months > 0),
  anchor     text    not null,
  rationale  text    not null,
  updated_at timestamptz not null default now()
);

comment on table retention_policies is
  'Durées de conservation, lisibles par un contrôle sans lire le code. '
  'Modifier une ligne suffit à changer la politique : aucune migration.';

comment on column retention_policies.anchor is
  'La colonne qui date la ligne concernée. Ce que la donnée DÉCRIT, pas quand '
  'elle a été écrite : une semaine de 2024 corrigée hier reste une semaine de 2024.';

insert into retention_policies (subject, months, anchor, rationale) values
  ('absences', 36, 'end_date',
   'Trois ans, alignés sur la prescription des salaires. Le minimum légal du '
   'décompte du temps de travail est plus court, mais une absence se rediscute '
   'avec une paie. À CONFIRMER avec la convention collective du magasin.'),
  ('plannings', 36, 'week_start',
   'Le planning EST le décompte du temps de travail, dont la conservation est '
   'obligatoire. Trois ans par cohérence avec les absences qui les expliquent.'),
  ('permanences', 36, 'updated_at',
   'Ancré sur l''écriture faute de date de période exploitable : month_key est '
   'du texte applicatif. Conservateur, donc garde plutôt trop que pas assez.'),
  ('paid_leave_campaigns', 36, 'updated_at',
   'Même ancre et même raison que les permanences.')
on conflict (subject) do nothing;

alter table retention_policies enable row level security;

-- Lisible par un manager connecté, modifiable par personne depuis l'application.
-- Changer une durée de conservation est une décision, pas un réglage d'écran :
-- elle se fait en SQL, à la main, et laisse une trace dans updated_at.
drop policy if exists "lisible par tout compte connecté" on retention_policies;
create policy "lisible par tout compte connecté" on retention_policies
  for select using (auth.uid() is not null);

-- 2. Ce qui SERAIT supprimé — et qui ne supprime rien
--
-- Les paramètres de sortie ne portent PAS le nom des colonnes lues. `subject`
-- en sortie et `subject` dans `retention_policies` se ressembleraient assez pour
-- que plpgsql refuse la requête comme ambiguë, à l'exécution seulement.

create or replace function retention_preview()
returns table (concerne text, lignes bigint, plus_ancienne date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  entry record;
begin
  for entry in select * from retention_policies order by retention_policies.subject loop
    return query execute format(
      'select %L::text, count(*)::bigint, min(%I)::date
         from %I
        where %I < (current_date - make_interval(months => %s))',
      entry.subject, entry.anchor, entry.subject, entry.anchor, entry.months
    );
  end loop;
end;
$$;

comment on function retention_preview() is
  'À lancer AVANT retention_purge, et à relire. Une purge se regarde avant de '
  'se faire : ces lignes-là ne reviendront pas.';

-- 3. La purge elle-même

create or replace function retention_purge()
returns table (concerne text, lignes_supprimees bigint)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  entry   record;
  removed bigint;
begin
  for entry in select * from retention_policies order by retention_policies.subject loop
    execute format(
      'delete from %I where %I < (current_date - make_interval(months => %s))',
      entry.subject, entry.anchor, entry.months
    );
    get diagnostics removed = row_count;
    concerne := entry.subject;
    lignes_supprimees := removed;
    return next;
  end loop;
end;
$$;

comment on function retention_purge() is
  'Supprime ce que retention_preview annonce. Ne touche JAMAIS à employees : '
  'un planning enregistré cite ses salariés par identifiant, et supprimer une '
  'fiche viderait de son sens chaque semaine passée où elle apparaît. Le départ '
  'd''un salarié se traite par son statut, pas par une purge automatique.';

-- 4. Les droits

-- `security definer` traverse RLS par construction : ces deux fonctions voient
-- tous les magasins. Les laisser exécutables par `authenticated` donnerait à
-- n'importe quelle session le moyen de vider la base du voisin — et la
-- migration 0001 accorde justement `execute on all functions` à ce rôle. Ce
-- retrait annule cet héritage pour les deux seules fonctions destructrices du
-- schéma. La purge se lance depuis la console, par quelqu'un qui l'a décidé.
--
-- Le garde sur `pg_roles` reprend celui de 0001 : la migration doit rester
-- rejouable sur un Postgres nu, où le rôle `authenticated` n'existe pas.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on retention_policies to authenticated';
    execute 'revoke all on function retention_preview() from authenticated';
    execute 'revoke all on function retention_purge() from authenticated';
  end if;
end;
$$;

revoke all on function retention_preview() from public;
revoke all on function retention_purge() from public;
