# Vision produit — ShiftOS

> Statut : brouillon vivant · Dernière mise à jour : 2026-07-16
> Ce document décrit l'intention produit. Toute information non confirmée est marquée `TODO`.

---

## 1. Pourquoi ShiftOS existe

ShiftOS est un SaaS de **planification du personnel assisté par IA** (« AI Planning Engine »).
L'application accompagne un responsable dans la configuration de son lieu de travail, puis
dans la génération de ses plannings.

Justification détaillée du marché et de l'opportunité : `TODO`.

## 2. Le problème résolu

Construire manuellement des plannings d'équipe est chronophage et sujet aux erreurs :
horaires d'ouverture variables, règles de temps de travail, coupures, disponibilités.

ShiftOS vise à centraliser cette configuration (magasin, horaires, mode de planification,
politique de coupure, règles générales) afin de générer des plannings conformes aux
contraintes définies.

Énoncé complet et chiffré du problème (coûts, temps perdu, non-conformité) : `TODO`.

## 3. Objectifs du produit

- Permettre à un responsable de configurer son magasin lors d'un onboarding guidé.
- Générer des plannings à partir de règles explicites (deux modes prévus : `Shift Library`
  et `Dynamic Shift Generation`).
- Offrir un espace de pilotage (tableau de bord, planning, équipe, statistiques, audit).

Objectifs mesurables (KPIs, cibles, échéances) : `TODO`.

## 4. Utilisateurs ciblés

- **Responsable / manager de magasin** : configure le lieu de travail et pilote les plannings.
  C'est l'utilisateur principal identifié à ce jour (parcours d'onboarding « Create your store »).

Autres personas (employés, administrateurs, siège, multi-magasins) : `TODO`.

## 5. Valeurs du projet

- **Rigueur** : logiciel destiné à la commercialisation, pas un prototype.
- **Clarté** : configuration explicite plutôt que règles implicites.
- **Conformité** : les plannings respectent des contraintes de temps de travail définies.

Formulation définitive des valeurs et principes de marque : `TODO`.

---

## Références

- Parcours d'onboarding : `app/onboarding/` et `features/store/`.
- Positionnement affiché historiquement : « AI Planning Engine ».
- Détails de mise en œuvre : voir [ARCHITECTURE.md](../architecture/ARCHITECTURE.md).
