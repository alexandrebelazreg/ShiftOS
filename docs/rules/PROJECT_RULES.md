# Règles du projet — ShiftOS

> Statut : à jour au 2026-07-16
> Ce document **consolide et organise** les règles en vigueur. Aucune règle existante n'a
> été supprimée. Le `PROJECT_RULES.md` à la racine du dépôt était vide ; la seule règle
> formalisée jusqu'ici provenait de `AGENTS.md` (reprise en §1). Les fichiers sources
> (`AGENTS.md`, racine) n'ont pas été modifiés.

---

## 1. Framework et code (repris de `AGENTS.md`)

> **This is NOT the Next.js you know.**
> Cette version de Next.js comporte des changements de rupture — API, conventions et
> structure de fichiers peuvent différer des connaissances par défaut. **Lire le guide
> pertinent dans `node_modules/next/dist/docs/` avant d'écrire du code.** Tenir compte des
> avis de dépréciation.

## 2. Langue

- Toute la **documentation** est rédigée en **français**.
- Le **code** reste en **anglais**.
- Les **noms de composants** restent en anglais.
- Les **noms de variables** restent en anglais.

## 3. Stack imposée

- **TypeScript uniquement** (mode `strict`).
- **Tailwind CSS uniquement** pour les styles.
- Composants **shadcn/ui** (style `base-nova`, primitives `@base-ui/react`).
- Icônes **lucide-react**.
- Formulaires : **react-hook-form** + validation **zod** (via `@hookform/resolvers`).

## 4. Architecture et organisation

- Découpage **par fonctionnalité** (`features/<feature>/` : `components/`, `schemas/`,
  `types/`, `lib/`, `index.ts`).
- Composants partagés dans `components/` (`ui/`, `layout/`, `dashboard/`, `onboarding/`).
- Utilitaires transverses dans `lib/`.
- Créer des **composants réutilisables et modulaires** ; éviter les pages monolithiques.
- Alias d'import `@/*` (voir `tsconfig.json`).

## 5. Périmètre (phase actuelle)

- **Ne pas implémenter de logique métier** tant qu'elle n'est pas spécifiée.
- **Pas de fausses données**, sauf éléments d'affichage explicitement demandés.
- **Pas de backend, pas de base de données, pas d'authentification** à ce stade ;
  utiliser des données simulées (mock) là où c'est nécessaire.

## 6. Documentation

- Quand une information manque, écrire **`TODO`** — ne jamais inventer.
- Ne pas inventer de fonctionnalité, de règle métier ni d'architecture inexistante.
- Les décisions structurantes sont tracées dans `docs/decisions/` (ADR) : `TODO` (format à définir).

## 7. Qualité et vérification

- Contrôle de types avant livraison : `npx tsc --noEmit`.
- Lint : `npm run lint`.
- Convention de commits / branches : `TODO`.
- Stratégie de tests : `TODO`.

---

## Notes

- Ce fichier est la **référence des règles**. Le `PROJECT_RULES.md` racine (vide) pourra
  pointer vers ce document — modification hors périmètre de ce sprint.
