-- Les secteurs portent leur propre identifiant, qui n'est pas un uuid nu.
-- Tout copier, tout exécuter. Voir supabase/README.md pour le pourquoi.

-- 1. L'identifiant du secteur vient de l'application

alter table sectors alter column id drop default;
alter table sectors alter column id type text using id::text;

-- 2. Les campagnes et les mois de permanence gardent leur clé applicative
--    dans campaign_key et month_key, déjà en texte : rien à changer.
