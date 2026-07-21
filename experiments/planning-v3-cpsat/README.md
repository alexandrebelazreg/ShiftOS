# Spike CP-SAT — Planning V3

> **Expérimentation. Ce code n'est pas intégré au produit et ne doit pas l'être en l'état.**
> Le moteur actif reste V2 / Sprint 3D.1 (`CURRENT_PLANNING_ENGINE_VERSION = "v2"`).

## Ce que teste ce spike

Une seule question : sur la vraie semaine Drive, **combien de créneaux de besoin
restent sous-couverts au minimum**, et **qu'est-ce qui est réellement prouvé** ?

Contexte : le prototype DFS V3B plafonne à 10 créneaux sous-couverts, alors que
Sprint 3D.1 en laisse 4. Fallait-il continuer à améliorer le DFS, ou changer
d'approche ? Ce spike répond en mesurant, pas en supposant.

## Résultat

| Moteur | Créneaux sous-couverts | Minutes de déficit | Preuve |
|---|---|---|---|
| Sprint 3D.1 (V2, en production) | 4 | — | aucune |
| Prototype DFS V3B | 10 | 1 440 | aucune |
| **CP-SAT** | **1** | **60** | **optimum lexicographique prouvé sur 3 niveaux** *(portée ci-dessous)* |

Il reste **un créneau d'une heure court d'un seul salarié** : l'ouverture du
jeudi, 1 présent pour 2 requis. C'est le troisième objectif qui l'y place —
jeudi est un jour à 1 650 minutes, contre 1 995 le samedi où le déficit se
posait avant. Plusieurs plannings atteignent encore ce même optimum ; voir
« portée de la preuve ».

## Budgets journaliers — contraintes exactes, jamais négociables

Les budgets sont des **entrées figées avant la résolution**, pas des variables.

Le solveur choisit : les salariés, les durées, les heures de début et de fin.
Il ne peut pas : déplacer des minutes d'un jour à l'autre, augmenter ou réduire
un budget, ni compenser un dépassement du vendredi par un déficit du lundi.

Pour Drive, ils valent exactement :

| lundi | mardi | mercredi | jeudi | vendredi | samedi |
|---|---|---|---|---|---|
| 1 650 | 1 650 | 1 650 | 1 650 | **2 430** | **1 995** |

Leur somme égale exactement le total contractuel (11 025 minutes), ce qui les
rend rigides : il n'existe aucun jeu. Aucun mode de budget flexible n'existe.

## Le troisième objectif — protéger les journées à budget élevé

Pour chaque créneau déficitaire :

```
businessDeficitCost = deficitEmployeeMinutes × dailyBudgetMinutes
```

Le coût total est la somme sur tous les créneaux. Entiers uniquement.

**Ce que fait exactement cet objectif.** À nombre de créneaux et minutes de
déficit identiques, le troisième objectif protège davantage les journées
disposant du budget journalier le plus élevé. Le budget journalier est ici le
critère métier choisi pour départager des solutions déjà équivalentes sur les
deux premiers objectifs.

Aucune journée n'est intrinsèquement moins importante qu'une autre : toutes les
règles dures s'appliquent partout de la même façon. Le budget sert uniquement de
clé de tri entre solutions par ailleurs indistinguables.

**Justification.** À la troisième passe, le déficit total `D` est déjà figé par
la passe 2. Minimiser `Σ dᵢ · Bᵢ` sous `Σ dᵢ = D` est un objectif linéaire sur un
total constant : son minimum porte le déficit sur le jour au budget `Bᵢ` le plus
faible parmi ceux qui peuvent l'accueillir, ce qui revient exactement à préserver
en priorité ceux au budget le plus élevé. Sacrifier une heure un jour à 2 430
minutes coûte 145 800, contre 99 000 un jour à 1 650.

Ce troisième objectif n'est activé qu'**après** avoir ajouté comme contraintes
`underCoveredSlots == 1` et `deficitMinutes == 60`. Il ne peut donc jamais
dégrader les deux niveaux déjà prouvés. Aucune somme pondérée ne combine les
trois objectifs.

**Effet mesuré sur Drive** : avant la passe 3, le déficit se posait le samedi
(budget 1 995, coût 119 700). Après, il se pose le jeudi (budget 1 650, coût
**99 000**), soit 20 % de coût métier en moins — et 99 000 est prouvé minimal.

### Ce que démontre quoi

**La démonstration effective de la passe 3 est le cas Drive** : 119 700 → 99 000,
prouvé optimal, sur le vrai problème.

Le petit cas à deux budgets dans `cpsat-experiment.test.ts` est **un test de la
formule de classement**, rien de plus. Il vérifie que `businessDeficitCost`
ordonne correctement deux variantes de déficit équivalentes sur les deux premiers
objectifs. Il **ne lance pas CP-SAT** et ne prouve **pas** que le solveur
arbitrerait lui-même ce cas artificiel.

Cette distinction est délibérée. Avec des budgets journaliers exacts, la capacité
en renforts d'une journée est fixée par son budget : dans un cas artificiel
simple, le déficit tombe de lui-même sur le jour au budget le plus faible, et un
test construit ainsi passerait **même sans la passe 3** — il ne prouverait donc
rien. Un arbitrage réellement libre n'apparaît que dans des instances riches
comme Drive, où l'agencement intra-journée et les pics multiples créent de vraies
égalités.

## Portée exacte de la preuve

> **Optimum lexicographique prouvé sur les trois premiers objectifs, pour le
> problème sérialisé, avec shifts continus et règles actuellement modélisées.**

Ne **pas** écrire « planning Drive globalement optimal » : ce n'est pas ce qui a
été démontré.

| Passe | Objectif | Valeur | Borne | Statut |
|---|---|---|---|---|
| 1 | minimiser `underCoveredSlots` | 1 | 1.0 | `OPTIMAL` |
| 2 | à `underCoveredSlots == 1`, minimiser `deficitMinutes` | 60 | 60.0 | `OPTIMAL` |
| 3 | à (1, 60) fixés, minimiser `businessDeficitCost` | 99 000 | 99 000.0 | `OPTIMAL` |

Borne = objectif sur les trois passes. Les **trois seuls** niveaux prouvés sont
ceux-là. Rien d'autre n'est prouvé.

**L'unicité du planning ne l'est toujours pas.** Même après la passe 3,
plusieurs plannings atteignent (1, 60, 99 000) — vérifié en interdisant la
solution trouvée et en redemandant au solveur, qui en produit une autre.

Le spike **n'invente aucun quatrième critère métier** : ni salarié, ni jour, ni
ouverture ou fermeture privilégiés, ni somme d'identifiants. L'ordre des
affectations dans le fichier est un **départage canonique purement technique**
(tri par date puis identifiant) destiné à rendre le fichier reproductible —
jamais une préférence métier. Le choix entre variantes équivalentes revient au
manager.

## Règles couvertes

Contrats hebdomadaires exacts · budgets journaliers exacts · jours obligatoires
et repos fixes · disponibilités · durées de shift min/max · pas de temps ·
capacités d'ouverture et de fermeture · ouvertures par jour (minimum) ·
fermetures par jour (exactes) · plafonds individuels d'ouvertures et de
fermetures · repos minimum entre deux journées · couverture des créneaux.

## Règles non couvertes — deux catégories à ne pas confondre

### 1. Règles pouvant modifier l'espace de faisabilité

**La preuve de `underCoveredSlots = 1` ne s'étend pas à un modèle qui les
intègre différemment.** Le minimum pourrait bouger dans un sens ou dans l'autre.

- **shifts avec coupure** : non modélisés, seuls les shifts continus sont
  énumérés. Les autoriser élargit l'espace et pourrait faire *baisser* le
  déficit ;
- **`maximumConsecutiveWorkedDays`** : non contraint ici. Une vraie règle
  configurée, plus restrictive que le fallback dérivé actuel, *restreindrait*
  l'espace ;
- **`maximumEmployees`** : ignoré. S'il constitue une contrainte dure, il
  restreint l'espace.

### 2. Objectifs secondaires non encore optimisés

Ce ne sont pas des contraintes mais des objectifs de rang inférieur :

- préférences `prefersOpening` / `prefersClosing` ;
- équité des ouvertures et des fermetures ;
- écart à la répartition individuelle souhaitée ;
- choix métier du créneau à sacrifier lorsque plusieurs optima existent.

Ils **ne conservent (1, 60) que s'ils sont optimisés APRÈS avoir fixé
explicitement** `underCoveredSlots == 1` **et** `deficitMinutes == 60` comme
contraintes. Les optimiser librement, ou les mélanger dans une somme pondérée,
dégraderait les deux niveaux prouvés.

## Reproduire

**1. Régénérer le problème depuis le vrai builder V3**

`fixtures/drive-problem.json` n'est pas un JSON écrit à la main : il est produit
par la fixture applicative historique → la migration repository → le véritable
`PlanningProblemBuilderV3`.

```bash
UPDATE_CPSAT_FIXTURE=1 npx vitest run \
  features/core/planning-v3/__tests__/cpsat-experiment.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

Sans la variable d'environnement, le même test **compare** et échoue si le
builder, la fixture ou une règle a changé — c'est le garde-fou qui empêche ce
dossier de décrire silencieusement un problème périmé.

**2. Lancer le solveur**

```bash
cd experiments/planning-v3-cpsat
python cpsat_drive.py fixtures/drive-problem.json expected/cpsat-solution.json \
  --report report.json --timeout 900 --seed 1 --workers 1
```

Compter environ 1 à 2 minutes par passe. `--workers 1` est délibéré : le
portefeuille multi-thread de CP-SAT n'est pas reproductible d'une exécution à
l'autre, donc une exécution de référence doit être mono-thread.

Codes de sortie : `0` succès · `1` usage/E-S · `2` aucune solution · `3` modèle invalide.

**3. Auditer la solution**

```bash
npx vitest run features/core/planning-v3/__tests__/cpsat-experiment.test.ts \
  --maxWorkers=1 --no-file-parallelism
```

Le validateur **indépendant** V3A relit la réponse du script Python. Rien de ce
que ce dossier affirme n'est pris pour argent comptant : `validHardConstraints`,
les 2 205 minutes par salarié, les budgets journaliers, les repos fixes, les
capacités d'ouverture, la fermeture unique et les durées légales sont tous
recalculés côté TypeScript.

> **La suite Vitest ne lance jamais CP-SAT.** `cpsat-experiment.test.ts` ne fait
> que lire des fichiers JSON et appeler le validateur : aucun sous-processus,
> aucun appel à Python, aucune dépendance à OR-Tools. Les étapes 1 et 2 restent
> des commandes expérimentales explicites, jamais déclenchées par `npm test`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `fixtures/drive-problem.json` | problème sérialisé, régénéré par le builder V3 |
| `expected/cpsat-solution.json` | **une** solution de référence reproductible — pas l'unique optimum |
| `expected/cpsat-report.json` | versions Python et OR-Tools, plateforme, paramètres complets, empreintes, passes, règles couvertes et non couvertes |

Les empreintes du rapport sont recalculées côté Python par une réimplémentation
de `fingerprint.ts`. Qu'elles coïncident avec la valeur TypeScript
(`p3_29f16d47dacffd2b`) est une contre-vérification : les deux côtés décrivent
bien le même problème.

## Cible future — l'arbitrage du manager

Non développé ici, et volontairement : ni composant React, ni sélecteur de
variantes, ni verrouillage de shifts, ni réparateur local, ni appel CP-SAT
depuis Next.js. Seulement la direction visée :

- le solveur propose une ou plusieurs variantes équivalentes ;
- le manager choisit celle qu'il préfère ;
- il peut ensuite modifier manuellement les horaires ;
- chaque modification est auditée par le validateur V3 ;
- une violation bloquante empêche la publication ;
- une dégradation peut être acceptée explicitement ;
- une régénération future doit pouvoir respecter des shifts verrouillés.

## Pourquoi ce code n'est pas dans le produit

OR-Tools est une bibliothèque native Python **sans binding Node ni navigateur**.
L'application est un Next.js dont la génération tourne aujourd'hui côté client,
de façon synchrone. Intégrer CP-SAT supposerait un service serveur — décision
d'architecture qui n'est pas prise et qui n'entre pas dans le périmètre de ce
spike.

Ce dossier existe pour rendre le résultat **reproductible et auditable avant**
cette décision, pas pour la préempter.
