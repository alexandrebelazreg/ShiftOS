-- Les identifiants viennent de l'application, pas de la base.
-- Tout copier, tout exécuter. Voir supabase/README.md pour le pourquoi.

-- 1. Les salariés gardent l'identifiant que leurs plannings citent

alter table absences drop constraint if exists absences_employee_id_fkey;

alter table employees alter column id drop default;
alter table employees alter column id type text using id::text;

alter table absences alter column employee_id type text using employee_id::text;

alter table absences
  add constraint absences_employee_id_fkey
  foreign key (employee_id) references employees(id) on delete cascade;

-- 2. Les plannings aussi : leur identifiant est dans les adresses

alter table plannings alter column id drop default;
alter table plannings alter column id type text using id::text;
