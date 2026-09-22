-- Un planning est unique DANS SON MAGASIN, plus dans le monde.
-- Tout copier, tout exécuter. Voir supabase/README.md pour le pourquoi.
--
-- À APPLIQUER EN MÊME TEMPS que le changement de `onConflict` dans
-- `planning.supabase-repository.ts`. Les deux moitiés ne fonctionnent qu'ensemble,
-- et chacune sans l'autre casse tout enregistrement de planning — bruyamment,
-- ce qui est la bonne façon d'échouer.

-- Le nom de la contrainte n'est pas supposé : il est lu. Une clé primaire créée
-- en ligne s'appelle `plannings_pkey` par convention, mais une base reprise d'un
-- dump ou d'un outil de migration peut en porter un autre, et un `drop
-- constraint` sur un nom inexistant ferait échouer tout le script.
do $$
declare
  nom text;
begin
  select conname into nom
    from pg_constraint
   where conrelid = 'plannings'::regclass
     and contype = 'p';

  if nom is not null then
    execute format('alter table plannings drop constraint %I', nom);
  end if;
end $$;

alter table plannings
  add constraint plannings_pkey primary key (store_id, id);

-- Aucun index supplémentaire sur `id` seul : les politiques de cloisonnement
-- ajoutent `store_id = …` à CHAQUE requête, donc la colonne de tête de la clé
-- primaire est toujours fournie. Un index sur `id` ne servirait qu'à une requête
-- que personne ne peut écrire.
