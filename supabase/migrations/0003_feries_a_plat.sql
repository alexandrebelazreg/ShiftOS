-- Les jours fériés se rangent par date, pas par année.
-- Tout copier, tout exécuter. Voir supabase/README.md pour le pourquoi.

-- 1. Une seule ligne par magasin

alter table holidays drop constraint if exists holidays_store_id_year_key;
alter table holidays drop column if exists year;
alter table holidays drop column if exists id;

alter table holidays add primary key (store_id);
alter table holidays alter column days set default '{}'::jsonb;

-- 2. Le contenu est un objet indexé par date, plus une liste

update holidays set days = '{}'::jsonb where jsonb_typeof(days) <> 'object';
