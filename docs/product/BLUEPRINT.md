# ShiftOS Blueprint

Version : 1.0

---

# Vision

ShiftOS est un moteur intelligent de planification destiné aux managers.

L'objectif n'est pas de créer un planning.

L'objectif est de créer le meilleur moteur de décision possible.

Chaque décision doit pouvoir être expliquée.

Chaque planning doit être optimisé.

Chaque salarié doit être traité équitablement.

---

# Mission

Permettre à un manager de créer un planning en quelques minutes tout en respectant :

- les contraintes légales
- les contraintes du magasin
- les contraintes des employés
- les préférences
- l'équité

---

# Philosophie

Le manager ne construit pas le planning.

Il définit les règles.

ShiftOS construit le meilleur planning possible.

Le manager garde toujours le dernier mot.

---

# Les principes fondateurs

## 1.

Une information ne doit exister qu'à un seul endroit.

## 2.

Le moteur ne doit jamais être codé spécifiquement pour un magasin.

Tout doit être paramétrable.

## 3.

Une fonctionnalité doit pouvoir être activée ou désactivée.

## 4.

Le moteur doit toujours expliquer ses décisions.

## 5.

Le logiciel doit rester simple pour l'utilisateur.

Même si le moteur est complexe.

---

# Les objectifs

Créer :

- le moteur de planification le plus flexible
- le moteur le plus équitable
- le moteur le plus simple à utiliser

---

# Ce que ShiftOS n'est pas

ShiftOS n'est pas :

- un tableau Excel
- un logiciel rigide
- un générateur d'horaires

ShiftOS est un moteur de décision.

---

# Règle d'or

Chaque nouvelle fonctionnalité doit répondre à cette question :

"Apporte-t-elle une vraie valeur au manager ?"

Si la réponse est non,

elle ne sera pas développée.

---

# TODO

Ce document sera enrichi à chaque sprint.

Il devient la référence principale du projet.

# Principe d'architecture

Le Core de ShiftOS ne doit contenir aucune règle spécifique à un métier.

Le Core manipule uniquement des concepts universels :

- Employee
- Shift
- Contract
- Constraint
- Capability
- Assignment
- Coverage
- Preference
- Score

Toutes les règles propres à un secteur d'activité appartiennent à un Pack.

Exemples :

Retail Pack

Restaurant Pack

Warehouse Pack

Healthcare Pack

Le Core ne doit jamais connaître Carrefour, Drive, Boulangerie ou Hôpital.