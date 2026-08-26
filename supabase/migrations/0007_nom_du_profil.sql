-- ÉCRIRE SON PROPRE NOM, ET RIEN D'AUTRE
--
-- `profiles` n'avait qu'une politique SELECT : chacun lisait son profil, et
-- personne ne pouvait l'écrire. La conséquence était pire qu'un refus — RLS ne
-- lève pas, elle ne fait simplement RIEN correspondre. Un `update` bloqué
-- revient donc sans la moindre erreur, l'application annonce « enregistré », et
-- le nom n'a jamais bougé. C'est le genre de panne qui se découvre au moment où
-- l'on cherche qui a imprimé une feuille, des semaines plus tard.
--
-- DEUX VERROUS, PARCE QU'UN SEUL NE SUFFIT PAS.
--
-- La politique dit QUELLE LIGNE : la sienne, dans les deux sens — `using` pour
-- celle qu'on a le droit de viser, `with check` pour celle qu'on a le droit de
-- laisser derrière. Sans `with check`, on pourrait déplacer sa propre ligne
-- vers un autre compte.
--
-- Le `grant` dit QUELLE COLONNE, et c'est lui qui compte vraiment ici. RLS
-- travaille à la ligne, jamais à la colonne : une politique d'écriture seule
-- aurait autorisé à changer aussi `role` et `store_id`. Or `store_id` est la
-- clé que TOUTES les autres politiques utilisent pour cloisonner les magasins —
-- se l'attribuer soi-même donnerait accès aux données du voisin, et `role` est
-- une élévation de privilège pure. Le droit d'écriture est donc retiré en bloc,
-- puis rendu sur la seule colonne `full_name`.

create policy "modifier son propre profil" on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;
