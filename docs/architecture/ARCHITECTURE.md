# Architecture — ShiftOS

> Statut : à jour au 2026-07-16 · Décrit **uniquement l'architecture actuelle**.
> L'architecture future (backend, base de données, authentification) n'est pas décrite ici.
> Les éléments non encore implémentés sont marqués `TODO`.

---

## 1. Vue d'ensemble

ShiftOS est une application **front-end Next.js** (App Router) en TypeScript.
À ce stade, il n'y a **ni backend applicatif, ni base de données, ni authentification** :
la persistance est **simulée (mock)** via un module dédié.

## 2. Stack technique

| Domaine | Technologie | Version |
| --- | --- | --- |
| Framework | Next.js (App Router, Turbopack) | 16.2.10 |
| Langage | TypeScript (`strict`) | ^5 |
| UI runtime | React / React DOM | 19.2.4 |
| Styles | Tailwind CSS | ^4 |
| Composants UI | shadcn (style `base-nova`) sur `@base-ui/react` | shadcn ^4.13 / base-ui ^1.6 |
| Icônes | lucide-react | ^1.24 |
| Formulaires | react-hook-form | ^7.81 |
| Validation | zod + @hookform/resolvers | zod ^4.4 / resolvers ^5.4 |
| Utilitaires classes | clsx, tailwind-merge, class-variance-authority | — |

Outillage : `eslint` (`eslint-config-next`), scripts `dev` / `build` / `start` / `lint`
définis dans `package.json`.

## 3. Structure des dossiers

```text
app/                      # App Router (routes, layouts)
  layout.tsx             # Root layout (html/body, polices)
  page.tsx               # Redirection racine selon présence d'un magasin
  (app)/                 # Groupe de routes de l'application (avec AppShell)
    layout.tsx           # Garde : redirige vers /onboarding si aucun magasin
    dashboard/  planning/  team/  store/  audit/  statistics/  settings/
  onboarding/            # Parcours d'onboarding (hors AppShell)
    page.tsx             # Wizard « Create your store »

features/                # Découpage par fonctionnalité (feature-sliced)
  store/
    components/          # StoreForm + sections + composants réutilisables
    schemas/             # store.schema.ts (zod, source de vérité)
    types/               # store.types.ts (enums, types de formulaire)
    lib/                 # constants, valeurs par défaut, repository (mock)
    index.ts             # barrel d'exports

components/
  ui/                    # Composants shadcn (base-ui)
  layout/                # AppShell, Sidebar, Header, navigation
  dashboard/             # Cartes du tableau de bord
  onboarding/            # Indicateur de progression du wizard

lib/                     # Utilitaires transverses (cn, current-user)
docs/                    # Documentation officielle (ce dossier)
```

## 4. Routing et navigation

- **Groupes de routes** : `app/(app)/` porte le layout applicatif (`AppShell` :
  sidebar + header + zone de contenu). `app/onboarding/` vit en dehors de ce groupe
  pour s'afficher en plein écran.
- **Garde d'accès** : `app/(app)/layout.tsx` vérifie la présence d'un magasin via
  `hasStore()` et redirige vers `/onboarding` si aucun n'existe. `app/onboarding/page.tsx`
  redirige vers `/dashboard` si un magasin existe. La racine `app/page.tsx` redirige
  selon la même condition.
- **Source de la condition** : `features/store/lib/store-repository.ts` (mock renvoyant
  `null` — aucun magasin). À remplacer par une source de données réelle sans changer les
  appels : `TODO`.

## 5. Couche formulaires

- **react-hook-form** pilote l'état, **zod** valide et coerce, `@hookform/resolvers/zod`
  fait le pont.
- Le schéma `features/store/schemas/store.schema.ts` est la source de vérité ; les
  validations conditionnelles et inter-champs passent par `superRefine`.
- Les sections du formulaire sont des composants isolés et réutilisables
  (`FormSection`, `FormField`, `RadioCards`, sections métier).
- Aucune logique métier n'est implémentée : à la soumission, l'objet validé est
  simplement journalisé en console.

## 6. Système d'UI

- Composants shadcn en style `base-nova` reposant sur `@base-ui/react`.
- Thématisation par variables CSS (`app/globals.css`), utilitaire `cn()` (`lib/utils.ts`).
- Configuration shadcn dans `components.json` ; alias d'import `@/*` → racine du projet
  (`tsconfig.json`).

## 7. Ce qui n'existe pas encore

- Backend / API : `TODO`.
- Base de données et persistance réelle : voir [DATABASE.md](../database/DATABASE.md) — `TODO`.
- Authentification / autorisation : `TODO`.
- Moteur de génération de planning (IA) : `TODO`.
- Tests automatisés : `TODO`.

## 8. Vérification

- Contrôle de types : `npx tsc --noEmit`.
- Exécution locale : `npm run dev` (Turbopack).
- Stratégie de tests : `TODO`.
