# Langage ubiquitaire — Planiteo

> Version : 1.0 · Dernière mise à jour : 2026-07-17
>
> Ce document est le **vocabulaire officiel** de Planiteo (Domain-Driven Design).
> Chaque concept métier y possède **un seul nom canonique**, en anglais (aligné
> sur le code du Core). Les définitions sont en français.
>
> Règle d'or : un concept = un nom. Si un terme n'est pas dans ce document, il
> ne fait pas (encore) partie du langage du projet.
>
> Chaque fiche suit le même format :
> **Définition · Rôle · Relations · Ce que ce n'est pas · Synonymes à éviter**.
>
> Références de code : `features/core/models/*` (entités du domaine) et
> `features/core/constraint-engine/*` (moteur de contraintes).

---

## Sommaire

**Organisation & personnes** — Organization · Store · Employee · Contract · Capability · Preference
**Temps & planning** — Shift · Shift Template · Planning · Assignment · Availability · Coverage
**Moteur & décision** — Constraint · Constraint Engine · Planning Engine · Rule Catalog · Score · Fairness

---

# Organisation & personnes

## Organization

- **Définition** : le locataire (tenant) de plus haut niveau. Une organisation
  possède un ou plusieurs magasins et regroupe leur configuration.
- **Rôle** : frontière de multi-location ; racine de possession des données.
- **Relations** : possède plusieurs **Store**. (`core/models/Organization.ts`)
- **Ce que ce n'est pas** : ce n'est pas un **Store**, ni un compte utilisateur
  (l'authentification n'existe pas encore).
- **Synonymes à éviter** : « company », « tenant » (dans l'UI), « entreprise »,
  « compte ».

## Store

- **Définition** : un lieu de travail planifié, avec ses horaires d'ouverture,
  ses réglages de génération et sa politique de coupures.
- **Rôle** : périmètre principal de planification ; contient les employés et les
  plannings.
- **Relations** : appartient à une **Organization** ; possède plusieurs
  **Employee**, **Shift Template**, **Shift**, **Planning** ; intègre
  `OpeningHours`, `PlanningSettings`, `SplitShiftPolicy` (objets-valeur).
  (`core/models/Store.ts`)
- **Ce que ce n'est pas** : ce n'est pas l'**Organization** parente ; ce n'est
  pas un **Planning**.
- **Synonymes à éviter** : « shop », « site », « workplace », « magasin »,
  « établissement ». _(Ambiguïté connue : le nom « Store » est orienté commerce
  alors que le moteur se veut universel — voir §Ambiguïtés.)_

## Employee

- **Définition** : une personne planifiée dans un magasin.
- **Rôle** : ressource à affecter ; porte le contrat, les capacités, les
  contraintes et les préférences.
- **Relations** : appartient à un **Store** ; possède un **Contract** (1–1) ;
  possède plusieurs **Constraint** et **Preference** ; se voit accorder des
  **Capability** (par clé). (`core/models/Employee.ts`)
- **Ce que ce n'est pas** : ce n'est pas un utilisateur/compte ; ce n'est pas une
  **Assignment** (l'employé n'« est » pas son affectation).
- **Synonymes à éviter** : « user », « staff member », « worker », « agent »,
  « salarié » _(acceptable à l'oral, mais le terme canonique reste Employee)_.
  ⚠️ **`EmployeeRecord`** (feature `employees`) est une **vue aplatie** de
  l'entité, pas un concept distinct — voir §Chevauchements.

## Contract

- **Définition** : l'accord de temps de travail d'un employé (heures
  hebdomadaires, jours travaillés, bornes journalières, type temps plein /
  partiel).
- **Rôle** : source des limites de temps propres à l'employé, utilisées par les
  contraintes de catégorie temps de travail.
- **Relations** : appartient à un **Employee** (1–1). (`core/models/Contract.ts`)
- **Ce que ce n'est pas** : ce n'est pas une **Constraint** (le contrat est une
  donnée ; les règles qui l'exploitent sont des contraintes) ; ce n'est pas les
  règles baseline du magasin (`PlanningRule`).
- **Synonymes à éviter** : « agreement », « job », « poste », « statut ».

## Capability

- **Définition** : ce qu'un employé est **autorisé/apte** à faire, exprimé par
  une clé ouverte (`CAN_OPEN`, `CAN_CLOSE`, `CAN_SPLIT_SHIFT`,
  `CAN_WORK_SATURDAY`, …).
- **Rôle** : rendre les aptitudes extensibles sans modifier le modèle Employee ;
  entrée des contraintes de catégorie « capacités ».
- **Relations** : accordée à des **Employee** via une liste de clés ; définie
  dans un registre de **Capability**. (`core/models/Capability.ts`)
- **Ce que ce n'est pas** : ce n'est pas une **Preference** (une capacité est un
  fait binaire autorisant/interdisant, pas un souhait) ; ce n'est pas une
  **Constraint**.
- **Synonymes à éviter** : « skill », « permission », « role », « droit »,
  « compétence ». ⚠️ Les booléens `canOpen`/`canClose` de la vue
  `EmployeeRecord` **représentent** des capacités — même concept, forme UI.

## Preference

- **Définition** : un souhait **non contraignant** d'un employé (préférer
  ouvrir/fermer, note libre).
- **Rôle** : alimenter les contraintes **souples** ; influencer le score sans
  jamais rendre un planning invalide.
- **Relations** : appartient à un **Employee**. (`core/models/Preference.ts`)
- **Ce que ce n'est pas** : ce n'est pas une **Constraint** dure ; ce n'est pas
  une **Availability** (une préférence n'interdit rien).
- **Synonymes à éviter** : « wish », « option », « soft constraint » _(une
  préférence **devient** une contrainte souple à l'évaluation, mais les deux
  concepts restent distincts)_, « désidérata ».

---

# Temps & planning

## Shift

- **Définition** : un intervalle de travail concret, daté, dans un magasin ; un
  ou plusieurs segments (plusieurs pour une coupure).
- **Rôle** : unité planifiable à laquelle on affecte un employé.
- **Relations** : appartient à un **Store** ; éventuellement issu d'un **Shift
  Template** ; référencé par des **Assignment**. (`core/models/Shift.ts`)
- **Ce que ce n'est pas** : ce n'est pas une **Assignment** (le shift existe sans
  employé) ; ce n'est pas un **Shift Template** (le template est réutilisable et
  non daté).
- **Synonymes à éviter** : « slot », « créneau » _(quand on parle du shift)_,
  « vacation », « poste horaire ».

## Shift Template

- **Définition** : un shift prédéfini et réutilisable de la « bibliothèque de
  shifts » (Shift Library) d'un magasin (nom, heure de début/fin, jours
  applicables).
- **Rôle** : servir de patron pour instancier des **Shift** en mode
  `shift_library`.
- **Relations** : appartient à un **Store** ; instancié en plusieurs **Shift**.
  (`core/models/ShiftTemplate.ts`)
- **Ce que ce n'est pas** : ce n'est pas un **Shift** concret (pas de date, pas
  d'affectation) ; ce n'est pas le **Rule Catalog**.
- **Synonymes à éviter** : « shift model », « pattern », « modèle horaire »,
  « Shift Library » _(la Library est l'ensemble des templates, pas un template)_.

## Planning

- **Définition** : l'emploi du temps d'un magasin sur une période donnée ;
  l'ensemble cohérent des affectations produit par le moteur.
- **Rôle** : livrable central de Planiteo ; objet évalué et optimisé.
- **Relations** : appartient à un **Store** ; possède plusieurs **Assignment**.
  (`core/models/Planning.ts`)
- **Ce que ce n'est pas** : ce n'est pas une **Assignment** isolée ; ce n'est pas
  le **Planning Engine** (l'un est le résultat, l'autre le producteur).
- **Synonymes à éviter** : « schedule », « roster », « timetable »,
  « emploi du temps », « rotation ».

## Assignment

- **Définition** : l'affectation d'**un** employé à **un** shift au sein d'**un**
  planning. Entité associative du triangle Planning × Shift × Employee.
- **Rôle** : la décision élémentaire que le moteur prend et explique.
- **Relations** : appartient à un **Planning** ; référence un **Shift** et un
  **Employee**. (`core/models/Assignment.ts`)
- **Ce que ce n'est pas** : ce n'est pas un **Shift** (un shift peut exister non
  affecté) ; ce n'est pas un **Planning**.
- **Synonymes à éviter** : « booking », « allocation », « affectation » _(FR
  acceptable, canonique = Assignment)_, dire « shift » pour désigner
  l'affectation.

## Availability

- **Définition** : les moments où un employé **peut** être planifié. Concept
  **dérivé**, non stocké : calculé à partir de `Contract.workingDays`, des
  **Constraint** de disponibilité (jours off fixes, jours interdits) et des
  `OpeningHours` du magasin.
- **Rôle** : borne l'espace de recherche du moteur (catégorie « availability »).
- **Relations** : dérive de **Contract**, **Constraint**, **Store**. Pas
  d'entité dédiée à ce jour.
- **Ce que ce n'est pas** : ce n'est **pas une entité persistée** ; ce n'est pas
  une **Preference** (la disponibilité autorise/interdit, elle n'exprime pas un
  souhait) ; ce n'est pas une **Capability**.
- **Synonymes à éviter** : « disponibilité » comme s'il s'agissait d'une table,
  « free time », « slot availability ».

## Coverage

- **Définition** : le **besoin** de personnel qui doit être couvert (combien de
  personnes, avec quelles capacités, à quel moment).
- **Rôle** : exprimer la demande à satisfaire ; catégorie de contraintes
  « coverage » (dures : besoin minimum).
- **Relations** : rattachée à un **Store**/**Planning** ; satisfaite par des
  **Assignment**. **⚠️ Pas encore modélisée** comme donnée (aucune entité
  `Demand`/`Requirement`) — `TODO`.
- **Ce que ce n'est pas** : ce n'est pas une **Assignment** (la couverture est le
  besoin, l'affectation est la réponse) ; ce n'est pas la **Capability**.
- **Synonymes à éviter** : « demand » et « requirement » _(à fixer : un seul
  terme canonique quand l'entité existera)_, « staffing », « besoin » employé de
  façon vague.

---

# Moteur & décision

## Constraint

- **Définition** : une **règle de planification évaluable**. Elle classe
  (catégorie, priorité, type dur/souple, périmètre), se configure (activable,
  paramètres, poids) et sait rendre un verdict via un contrat `evaluate`.
  (`constraint-engine/models/constraint.ts`)
- **Rôle** : unité d'extension du moteur ; une nouvelle règle métier = une
  nouvelle contrainte enregistrée, sans modifier le moteur.
- **Relations** : enregistrée dans le **Rule Catalog** / registry ; évaluée par
  le **Constraint Engine** contre un `ConstraintContext` ; produit un
  `ConstraintResult` et des `ConstraintViolation`.
- **Ce que ce n'est pas** : ⚠️ **à distinguer de l'entité `Constraint` de
  `core/models`** (un enregistrement de limite d'employé, ex. jour off fixe). La
  contrainte-moteur est **une règle** ; la contrainte-donnée est **une entrée**
  que la règle lit. Ce n'est pas une **Preference**, ni une **Capability**.
- **Synonymes à éviter** : « rule » _(cf. BUSINESS_RULES.md — voir §Fusions)_,
  « validator », « check », « règle » employé pour la donnée.

## Constraint Engine

- **Définition** : le composant qui évalue les contraintes d'un planning et
  produit des résultats, des violations et un score, **avec explication**.
  (`features/core/constraint-engine/`)
- **Rôle** : cœur de décision réutilisable et **agnostique du secteur** ; ne
  code jamais une règle en dur (il lit le registry).
- **Relations** : consomme le **Rule Catalog** (registry) et un
  `ConstraintContext` (données Core) ; alimente le **Score** ; sera piloté par le
  **Planning Engine**.
- **Ce que ce n'est pas** : ce n'est **pas** le **Planning Engine** (il évalue,
  il ne génère pas) ; il ne contient pas d'algorithme de planification.
- **Synonymes à éviter** : « validator », « rules engine » _(acceptable en
  généralité, mais le nom canonique est Constraint Engine)_, « moteur de règles ».

## Planning Engine

- **Définition** : le composant (à venir) qui **génère** le meilleur planning
  possible en explorant les affectations et en s'appuyant sur le Constraint
  Engine pour juger faisabilité et qualité.
- **Rôle** : produire un **Planning** optimisé et explicable ; le manager définit
  les règles, le moteur construit.
- **Relations** : utilise le **Constraint Engine** et le **Rule Catalog** ;
  produit un **Planning** ; optimise le **Score**. **⚠️ Non implémenté** — `TODO`.
- **Ce que ce n'est pas** : ce n'est pas le **Constraint Engine** ; ce n'est pas
  un **Planning** (c'est son producteur).
- **Synonymes à éviter** : « scheduler », « solver », « optimizer » _(ce sont des
  parties, pas le tout)_, « générateur d'horaires ».

## Rule Catalog

- **Définition** : le **catalogue des contraintes disponibles** — l'ensemble des
  règles connues du moteur, chacune avec identifiant, catégorie, priorité, type,
  paramètres. Deux facettes : la **source documentaire** (`BUSINESS_RULES.md`) et
  sa **matérialisation runtime**, le `ConstraintRegistry`.
- **Rôle** : point d'enregistrement qui permet d'ajouter/activer/désactiver des
  règles sans toucher au moteur.
- **Relations** : contient des **Constraint** ; lu par le **Constraint Engine** ;
  documenté par `BUSINESS_RULES.md`. (`constraint-engine/registry/`)
- **Ce que ce n'est pas** : ce n'est pas le **Constraint Engine** (le catalogue
  liste, le moteur évalue) ; ce n'est pas la **Shift Library** (bibliothèque de
  templates de shifts).
- **Synonymes à éviter** : « rule registry » et « registry » employés seuls,
  « rulebook », « catalogue de règles » de façon interchangeable avec le doc.

## Score

- **Définition** : mesure de **qualité** d'un planning. Deux niveaux :
  `ConstraintScore` (satisfaction d'**une** contrainte, normalisée `[0,1]`) et
  `ScoreBreakdown.total` (score **global** d'un planning, agrégé par le
  `ScoringStrategy`). (`constraint-engine/scoring/`)
- **Rôle** : comparer deux plannings, guider l'optimisation, expliquer pourquoi
  l'un est meilleur.
- **Relations** : produit à partir des `ConstraintResult` ; agrégé par catégorie
  et par contrainte ; affiché comme « Planning Score » dans le tableau de bord.
- **Ce que ce n'est pas** : ce n'est pas la **Fairness** (l'équité n'est qu'une
  **dimension** du score) ; le score global n'est pas le score d'une contrainte.
- **Synonymes à éviter** : « rating », « note », « quality », « fitness »
  employés sans préciser le niveau (contrainte vs planning).

## Fairness

- **Définition** : la **répartition équitable** du travail entre employés
  (heures, ouvertures/fermetures, week-ends). Dimension transverse, pas une
  entité.
- **Rôle** : catégorie de contraintes « fairness » (souples) et composante du
  **Score** ; principe fondateur (« chaque salarié traité équitablement »).
- **Relations** : exprimée par des **Constraint** de catégorie fairness ;
  contribue au **Score**.
- **Ce que ce n'est pas** : ce n'est pas le **Score** global (elle en est une
  part) ; ce n'est pas une **Preference** individuelle (l'équité est collective).
- **Synonymes à éviter** : « equity », « balance », « équilibrage »,
  « justice ».

---

# Analyse du langage

## Chevauchements détectés

1. **`Constraint` (règle moteur) vs `Constraint` (entité de données)** — collision
   de nom la plus grave. `constraint-engine/models/Constraint` est une **règle
   évaluable** ; `core/models/Constraint` est un **enregistrement** de limite
   d'employé (jour off fixe, max ouvertures). Même mot, deux responsabilités.
2. **`Employee` vs `EmployeeRecord`** — l'entité normalisée du Core et la vue
   aplatie de la feature `employees` décrivent la même réalité sous deux formes
   (domaine vs UI). Risque de confusion sur « laquelle est la vérité ».
3. **`Capability` (donnée) vs booléens `canOpen`/`canClose`** — les drapeaux de
   la vue employé sont une **projection** des capacités ; un seul concept, deux
   représentations.
4. **`Preference` vs contrainte souple** — une préférence (donnée) **devient** une
   contrainte de catégorie « preference » à l'évaluation ; frontière subtile.
5. **`Constraint` vs `Rule` vs `PlanningRule` vs `PlanningSettings`** — quatre
   notions « règle-adjacentes » : la contrainte évaluable, la « règle » de
   `BUSINESS_RULES.md`, la `PlanningRule` (baseline magasin : min/max heures) et
   `PlanningSettings` (mode/granularité de génération). Elles se recouvrent
   partiellement.
6. **`Score` (contrainte) vs `Score` (planning) vs « Planning Score » (UI)** — un
   même mot à trois granularités.
7. **`Rule Catalog` vs `ConstraintRegistry` vs `Shift Library`** — « catalogue »,
   « registre » et « bibliothèque » sont des ensembles ; ne pas les confondre.

## Fusions / clarifications suggérées

- **Renommer `core/models/Constraint` → `EmployeeConstraint`.** C'est la
  correction la plus utile : « Constraint » resterait réservé à la **règle**
  moteur, et la donnée d'employé deviendrait explicite. _(Déjà signalé au sprint
  précédent ; à faire dans un sprint dédié, hors périmètre « documentation ».)_
- **Adopter « Constraint » comme terme unique pour « règle ».** Aligner
  `BUSINESS_RULES.md` : une « Business Rule » **est** une `Constraint` du moteur.
  Éviter d'entretenir deux mots (« rule » / « constraint ») pour la même chose.
- **Positionner `PlanningRule` comme un cas particulier de `Constraint`** (des
  baselines magasin) plutôt qu'un concept parallèle, quand le moteur sera câblé.
- **Réserver « Score » au global** et toujours qualifier l'autre :
  « constraint score » vs « planning score ».
- **Ne pas fusionner `Employee` et `EmployeeRecord`** : la distinction
  domaine/vue est légitime — documenter que **`Employee` (Core) est la vérité**
  et `EmployeeRecord` une projection UII.

## Ambiguïtés découvertes

- **« Store » est un nom orienté commerce** alors que le moteur se veut universel
  (BLUEPRINT : « le moteur ne doit jamais être codé pour un magasin »). Terme plus
  neutre possible : **Site** ou **Workplace**. Ambiguïté à trancher au niveau
  produit ; non corrigée ici (documentation seulement).
- **`Coverage` et `Availability` n'existent pas encore comme données.** Ce sont
  aujourd'hui des concepts **dérivés/à venir** ; tant qu'aucune entité `Demand`
  ni `Availability` n'existe, éviter d'en parler comme de tables.
- **`Rule Catalog` a deux incarnations** (le document `BUSINESS_RULES.md` et le
  `ConstraintRegistry` runtime) : préciser laquelle on désigne selon le contexte
  (source de vérité documentaire vs mécanisme d'exécution).
- **Priorités & types : deux vocabulaires à réconcilier.** `BUSINESS_RULES.md`
  parle de « Critique/Élevée/Moyenne/Faible » et « Hard/Soft Rule » ; le moteur
  code `critical/high/medium/low` et `hard/soft`. Même sens, libellés différents —
  ce glossaire fixe la correspondance.

---

> **Statut d'implémentation** — Existent en code : Organization, Store, Employee,
> Contract, Capability, Preference, Shift, Shift Template, Planning, Assignment
> (`core/models`), Constraint / Constraint Engine / Rule Catalog / Score
> (`constraint-engine`). Concepts **non encore implémentés** : Availability
> (dérivé), Coverage (aucune entité), Planning Engine, Fairness (catégorie sans
> mise en œuvre). Marqués `TODO` ci-dessus.
