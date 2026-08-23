-- Corrections révélées en branchant les plannings et les absences.
-- Tout copier, tout exécuter. Voir supabase/README.md pour le pourquoi.

-- 1. Les identifiants de secteur ne sont pas des uuid nus

alter table plannings
  alter column sector_ids type text[] using sector_ids::text[];

-- 2. Un planning porte un libellé, une fin de période et une date d'enregistrement

alter table plannings add column if not exists label       text;
alter table plannings add column if not exists period_end  date;
alter table plannings add column if not exists saved_at    timestamptz;

-- 3. Une absence est enregistrée un jour, pas à un instant

alter table absences
  alter column recorded_on type date using recorded_on::date,
  alter column recorded_on set default current_date;

-- 4. Les absences se cherchent par salarié et par état

create index if not exists absences_store_status_idx on absences(store_id, status);
