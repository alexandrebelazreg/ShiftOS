# Le socle — pourquoi il est fait ainsi

Les décisions qui expliquent `migrations/0001_socle.sql`. Le fichier SQL, lui,
ne porte que des repères numérotés : une migration se lit en diagonale au moment
où l'on doute, pas comme un article.

Pour l'appliquer : [PROCEDURE.md](PROCEDURE.md).

## Hybride, pas tout normalisé

Ce qu'on filtre, trie ou relie est une colonne. La configuration riche reste en
`jsonb`, validée par les 948 lignes de Zod qui tournent déjà en production.

Une fiche salarié porte environ **70 champs**, un secteur en a 18 dont 5
structures imbriquées. Les retranscrire en colonnes aurait dupliqué la règle à
deux endroits — et perdre un réglage en le traduisant était le risque numéro un
du plan de la mission 2.

Le coût assumé : la configuration à l'intérieur d'un `jsonb` est moins
interrogeable en SQL. Pour un magasin et cinq salariés, l'échange est favorable.

## `store_id` partout, dès la première table

Le multi-magasin n'est pas activé et n'aura pas d'écran avant longtemps. Mais
posée maintenant sur des tables vides, cette colonne coûte une heure ; ajoutée
plus tard sur des tables pleines, elle impose une migration de toutes les
données, la réécriture de chaque requête et un audit de sécurité complet.

## Un seul rôle, mais le type existe

`app_role` n'a qu'une valeur : `manager`. Les salariés lisent la feuille
publiée, ils ne se connectent pas. Le type est néanmoins créé, pour que le jour
où un salarié devra consulter son planning ne commence pas par une migration.

## Deux serrures, pas une

Les politiques RLS **doublent** la barrière applicative, elles ne la remplacent
pas. Chaque dépôt recevra son `store_id` d'une session vérifiée :

```
verifySession() → { userId, storeId } → createXRepository(db, storeId)
```

Une base qui refuse vaut mieux qu'une requête qui pense à filtrer.

## Ce qui a été vérifié, et comment

Migration appliquée sur un Postgres 16 jetable, avec un talon pour `auth.users`
et `auth.uid()`. Résultat : 10 tables, RLS active sur les dix, 10 politiques,
8 déclencheurs, 21 index.

Puis l'isolation elle-même, éprouvée **sous un rôle ordinaire** — un
superutilisateur contourne RLS et n'aurait rien prouvé :

| Tentative | Résultat |
|---|---|
| Le compte A liste les salariés | ne voit que les siens |
| A insère chez B | `new row violates row-level security policy` |
| A cherche un salarié de B | 0 ligne |
| A renomme le magasin de B | 0 ligne touchée, le nom survit |

## Détails qui ont coûté une erreur

**Les droits avant les politiques.** RLS décide qui voit quoi ; les `grant`
décident qui a le droit de demander. Une table sans droits répond
`permission denied` avant qu'aucune politique soit consultée, et l'erreur ne
ressemble en rien à un problème de cloisonnement. Supabase les pose par défaut ;
la migration les redit pour rester rejouable ailleurs.

**`create type` n'accepte pas `if not exists`.** Sans garde, une migration
interrompue ne se rejoue pas : la seconde tentative meurt sur un type déjà
présent.

**`clip` casse les accents** sous Windows — 14 893 caractères pour un fichier de
12 900. Utiliser `Set-Clipboard` via PowerShell, comme dans la procédure.
