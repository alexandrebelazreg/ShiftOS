# Base de données — Planiteo

> Statut : brouillon vivant · Dernière mise à jour : 2026-07-16
> **Aucune base de données n'existe à ce stade.** La persistance est simulée (mock).
> Ce document ne liste que les **grandes sections** ; aucune table détaillée n'est définie.
> Toute décision non prise est marquée `TODO`.

---

## 1. Vue d'ensemble

Il n'y a pas de base de données ni de persistance réelle dans le projet actuel.
Les données sont fournies par un module de simulation
(`features/store/lib/store-repository.ts`, renvoyant `null`).

## 2. Technologie et hébergement

Choix du SGBD, de l'hébergement et de l'ORM/client : `TODO`.

## 3. Entités principales

Liste des entités du domaine et leurs relations : `TODO`.
(Pas de tables détaillées à ce stade.)

## 4. Conventions de nommage

Conventions (tables, colonnes, clés, casse) : `TODO`.

## 5. Migrations

Stratégie de migration et versionnement du schéma : `TODO`.

## 6. Sécurité et accès aux données

Contrôle d'accès, isolation par locataire, règles de sécurité : `TODO`.

## 7. Sauvegardes et rétention

Politique de sauvegarde, restauration et rétention : `TODO`.

---

## Notes

- Ce document sera enrichi lorsque la couche de persistance sera cadrée.
- Le point d'intégration côté application est le repository de la feature `store`
  (voir [ARCHITECTURE.md](../architecture/ARCHITECTURE.md), section « Routing et navigation »).
