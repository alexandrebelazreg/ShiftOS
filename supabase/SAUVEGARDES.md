# Sauvegardes — et la seule qui compte

Tout ShiftOS vit désormais dans une base. Un incident qui l'atteint atteint tout :
le magasin, l'équipe, les absences, chaque planning passé.

**Une sauvegarde jamais restaurée n'est pas une sauvegarde.** Tant qu'une
restauration n'a pas été faite pour de vrai, on ne sait pas si le fichier est
lisible, si la procédure fonctionne, ni combien de temps elle prend — et on
l'apprend le jour où c'est urgent.

---

## Ce que Supabase fait, et ne fait pas

| Formule | Sauvegardes gérées | Restauration à un instant précis |
|---|---|---|
| **Free** | **aucune** | non |
| Pro | quotidiennes, 7 jours de rétention | en option payante |

La ligne qui compte est la première. **Sur la formule gratuite, il n'existe
aucune sauvegarde à restaurer** : ni dans le tableau de bord, ni ailleurs. Le
projet peut être suspendu après une inactivité prolongée, et rien ne le
rattraperait.

Exporter n'est donc pas une précaution supplémentaire : c'est la seule qui
existe.

## Fabriquer l'export

La chaîne de connexion contient le mot de passe de la base. **Elle ne se colle
nulle part qu'ici, et surtout pas dans une conversation.**

`Project Settings` → `Database` → `Connection string` → onglet `URI`.

### Depuis un poste où l'outil Supabase est disponible

```
npx supabase db dump --db-url "LA_CHAINE_DE_CONNEXION" -f shiftos-AAAA-MM-JJ.sql
```

### Ou depuis n'importe quelle machine dotée de Docker

Sans rien installer, en empruntant `pg_dump` à une image Postgres :

```
docker run --rm postgres:16-alpine pg_dump "LA_CHAINE_DE_CONNEXION" > shiftos-AAAA-MM-JJ.sql
```

Le fichier se garde **ailleurs que sur la machine de travail**. Un export posé à
côté de ce qu'il protège ne protège de rien.

## L'exercice de restauration

À faire **une fois**, tranquillement, pas le jour de l'incident.

1. Créer un **second projet Supabase**, en région européenne, nommé
   `shiftos-restauration`.
2. Y appliquer l'export : `SQL Editor`, coller le contenu du fichier, exécuter.
3. Copier les deux valeurs de connexion de ce projet dans un `.env.local` de
   test, puis `npm run dev`.
4. Recréer un compte dans ce projet (`Authentication` → `Add user`, avec
   « Auto Confirm ») et le rattacher — voir la section suivante.
5. Se connecter, ouvrir `Configuration → Employés`, `Planning`, `Congés`.
6. **Comparer avec la vraie base** : le nombre de salariés, un planning précis,
   une absence connue.
7. Supprimer le projet de restauration.

Ce qui compte n'est pas que l'export existe : c'est que **ShiftOS démarre
dessus**. Une base restaurée dont l'application ne veut pas ne sauve rien.

## Le piège qui fait échouer l'exercice

**Les comptes vivent dans le schéma `auth`, que Supabase possède et que l'export
n'emporte pas.** Une base restaurée contient donc toutes les données métier et
aucun moyen de s'y connecter.

Le rattachement se refait à la main :

```
insert into profiles (id, store_id, role, email)
select u.id, s.id, 'manager', u.email
from auth.users u, stores s
where u.email = 'VOTRE_ADRESSE'
limit 1;
```

Le magasin, lui, est déjà là — il vient de l'export. C'est pour cela que
`bootstrap.sql` ne convient pas ici : il en créerait un second, vide.

## Combien de temps pour repartir

Sans exercice, la réponse honnête est **inconnue**. Après, c'est un chiffre — et
c'est ce chiffre qui permet de décider si la formule Pro et sa restauration à un
instant précis valent leur prix.

Noter la durée réelle en bas de ce fichier le jour où l'exercice est fait.
