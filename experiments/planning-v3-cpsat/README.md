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
| **CP-SAT** | **1** | **60** | **optimum lexicographique prouvé sur 2 niveaux** *(portée ci-dessous)* |

Il reste **un créneau d'une heure court d'un seul salarié**. *Quel* créneau
varie selon l'optimum retourné : la solution committée sacrifie l'ouverture du
samedi (3 présents pour 4 requis), une autre exécution sacrifiait celle du jeudi
(1 pour 2). Les deux sont des optima équivalents — voir « portée de la preuve ».

## Portée exacte de la preuve

> **Optimum lexicographique prouvé sur les deux premiers objectifs, pour le
> problème sérialisé, avec shifts continus et règles actuellement modélisées.**

Cette formulation est la seule correcte. Ne **pas** écrire « planning Drive
globalement optimal » : ce n'est pas ce qui a été démontré.

Deux passes lexicographiques, chacune avec sa propre preuve :

| Passe | Objectif | Valeur | Borne | Statut |
|---|---|---|---|---|
| 1 | minimiser `underCoveredSlots` | 1 | 1.0 | `OPTIMAL` |
| 2 | à `underCoveredSlots == 1`, minimiser `deficitMinutes` | 60 | 60.0 | `OPTIMAL` |

Borne = objectif sur les deux passes. Les **deux seuls** niveaux prouvés sont
donc :

1. `underCoveredSlots = 1` ;
2. `deficitMinutes = 60` **parmi les solutions ayant exactement un créneau
   sous-couvert**.

Rien d'autre n'est prouvé.

**L'unicité du planning ne l'est pas.** Plusieurs plannings atteignent (1, 60) —
vérifié en interdisant la solution trouvée et en redemandant au solveur, qui en
produit une autre en 75 s. `expected/cpsat-solution.json` est une **solution de
référence reproductible**, pas l'unique optimum.

Conséquence pratique : **le créneau sacrifié n'est pas déterminé par la preuve**.
Choisir lequel relève d'un critère métier de rang inférieur que le modèle
n'exprime pas encore — à ajouter avant toute mise en production.

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

## Pourquoi ce code n'est pas dans le produit

OR-Tools est une bibliothèque native Python **sans binding Node ni navigateur**.
L'application est un Next.js dont la génération tourne aujourd'hui côté client,
de façon synchrone. Intégrer CP-SAT supposerait un service serveur — décision
d'architecture qui n'est pas prise et qui n'entre pas dans le périmètre de ce
spike.

Ce dossier existe pour rendre le résultat **reproductible et auditable avant**
cette décision, pas pour la préempter.
