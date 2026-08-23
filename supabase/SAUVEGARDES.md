# Sauvegardes — et la seule qui compte

Tout ShiftOS vit désormais dans une base. Un incident qui l'atteint atteint tout :
le magasin, l'équipe, les absences, chaque planning passé.

**Une sauvegarde jamais restaurée n'est pas une sauvegarde.** Tant qu'une
restauration n'a pas été faite pour de vrai, on ne sait pas si les fichiers sont
lisibles, si la procédure fonctionne, ni combien de temps elle prend — et on
l'apprend le jour où c'est urgent.

---

## Ce que Supabase fait tout seul

| Formule | Sauvegardes | Restauration à un instant précis |
|---|---|---|
| Free | quotidiennes, conservées 7 jours | non |
| Pro | quotidiennes, conservées 7 jours | oui, en option |

À vérifier dans `Project Settings` → `Database` → `Backups` : la formule change,
la rétention aussi.

## L'export à garder chez soi

Une sauvegarde qui vit chez l'hébergeur ne protège pas d'un compte suspendu ni
d'une suppression de projet. Un export téléchargé, oui.

**Supabase → `Database` → `Backups` → `Download`**, ou en ligne de commande :

```
npx supabase db dump --db-url "postgresql://..." -f shiftos-2026-08-23.sql
```

À garder ailleurs que sur la machine qui sert à travailler.

## L'exercice de restauration

À faire **une fois**, tranquillement, pas le jour de l'incident.

1. Créer un **second projet Supabase**, en région européenne, nommé
   `shiftos-restauration`.
2. Y appliquer l'export : `SQL Editor`, coller le fichier, exécuter.
3. Copier les deux valeurs de connexion de ce projet dans un `.env.local` de
   test, et lancer `npm run dev`.
4. Se connecter, ouvrir `Configuration → Employés`, `Planning`, `Congés`.
5. **Comparer avec la vraie base.** Le compte des salariés, un planning précis,
   une absence connue.
6. Supprimer le projet de restauration.

Ce qui compte n'est pas que l'export existe : c'est que **ShiftOS démarre
dessus**. Une base restaurée dont l'application ne veut pas ne sauve rien.

## Ce qu'un incident coûte aujourd'hui

Sans restauration testée, la réponse honnête à « combien de temps pour
repartir ? » est **inconnue**. Après l'exercice ci-dessus, elle devient un
chiffre — et c'est ce chiffre qui permet de décider s'il faut passer en formule
Pro pour la restauration à un instant précis.

## Ce qui reste hors sauvegarde

Les comptes d'authentification vivent dans le schéma `auth`, que l'export
standard **n'emporte pas**. Après une restauration, il faudra recréer le compte
manager et relancer `supabase/bootstrap.sql` pour le rattacher au magasin.

Les données métier, elles, sont intactes : `bootstrap.sql` ne crée un magasin
que s'il n'en existe pas déjà pour ce compte.
