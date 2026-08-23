# Phase 3 — brancher les comptes

Onze étapes. Chaque commande remplit le presse-papier ou crée un fichier :
aucun fichier à ouvrir, rien à choisir.

---

## 1. Terminal — récupérer le code

```
git pull && npm install
```

## 2. Supabase — relever les deux valeurs de connexion

`Project Settings` → `API`

Garder cette page ouverte. Deux valeurs y figurent :

- **Project URL** — de la forme `https://xxxx.supabase.co`
- **Publishable key** (ou **anon public** selon l'âge du projet) — une longue
  chaîne commençant par `eyJ` ou `sb_`

> Ne jamais prendre la clé `service_role`. Elle contourne toutes les protections
> et n'a sa place ni dans ce fichier ni dans un navigateur.

## 3. Terminal — créer le fichier de configuration locale

```
printf 'NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\n' > .env.local
```

## 4. Éditeur — coller les deux valeurs

Ouvrir `.env.local` et compléter les deux lignes, sans guillemets ni espaces :

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Ce fichier est ignoré par git : il ne partira jamais sur GitHub.

## 5. Supabase — créer son compte

`Authentication` → `Add user` → `Create new user`

Renseigner son adresse et un mot de passe. **Cocher « Auto Confirm User »**,
sinon la connexion sera refusée tant qu'un e-mail n'aura pas été validé.

## 6. Terminal — copier le rattachement

```
powershell -c "Get-Content -Raw -Encoding UTF8 supabase/bootstrap.sql | Set-Clipboard"
```

## 7. Éditeur Supabase — modifier une ligne, puis exécuter

`SQL Editor` → `New query` → **Ctrl+V**

Remplacer `REMPLACER@PAR-VOTRE-ADRESSE.fr` par l'adresse de l'étape 5, puis
`Run`.

Attendu : une ligne avec l'adresse, `manager`, et `Mon magasin`.

## 8. Terminal — lancer l'application en local

```
npm run dev
```

## 9. Navigateur — se connecter

Ouvrir `http://localhost:3000`. La redirection vers `/login` doit être
automatique. Se connecter avec les identifiants de l'étape 5.

## 10. Coolify — reporter les deux variables

`Environment Variables` → ajouter les deux mêmes lignes qu'à l'étape 4, puis
`Deploy`.

## 11. Coolify — retirer le mot de passe HTTP

`Advanced` → désactiver `HTTP Basic Auth`.

Il n'était qu'un pansement posé pendant l'hébergement ; l'application a
désormais sa propre porte.

---

## Si la connexion échoue

| Message | Cause |
|---|---|
| `Adresse ou mot de passe incorrect` | « Auto Confirm User » oublié à l'étape 5 |
| Redirection en boucle vers `/login` | étape 7 non faite : compte sans magasin |
| `NEXT_PUBLIC_SUPABASE_URL manque` | `.env.local` absent, ou `npm run dev` lancé avant |

Après toute modification de `.env.local`, **redémarrer `npm run dev`** : les
variables ne sont lues qu'au démarrage.
