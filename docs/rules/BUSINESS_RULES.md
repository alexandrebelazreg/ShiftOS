# BUSINESS RULES

Version : 2.0

## Objectif

Ce document contient toutes les règles métier utilisées par le moteur de Planiteo.

Les règles sont indépendantes du code.

Le moteur applique les règles.

Les développeurs implémentent les règles.

Les managers configurent les règles.

---

# Structure

Chaque règle possède :

- un identifiant
- une catégorie
- une priorité
- un type
- un statut
- une description
- des paramètres
- des exemples
- un périmètre d'application

---

# Priorités

## Critique

Le planning est invalide si la règle n'est pas respectée.

## Élevée

Le moteur doit toujours essayer de respecter cette règle.

## Moyenne

Le moteur optimise cette règle.

## Faible

Préférence uniquement.

---

# Types

Hard Rule

Impossible à violer.

Soft Rule

Peut être violée si cela améliore le planning.

---

# Catégories

COV - Couverture

CTR - Contrat

TME - Temps de travail

CAP - Capacités

EQT - Équité

PREF - Préférences

STORE - Magasin

SHIFT - Génération des shifts

LEGAL - Contraintes légales

PERF - Optimisation