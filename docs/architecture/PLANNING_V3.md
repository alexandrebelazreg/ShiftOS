# Planning V3 — socle

Statut : **V3A livrée**. Le socle existe, rien ne tourne en production.
Le planning affiché est toujours produit par V2 / Sprint 3D.1.

## Pourquoi V3

V2 (`business-pipeline.ts`) est un pipeline mutable et monolithique dont les
phases peuvent se court-circuiter. Un secteur historique dépourvu de
`workEveryNonFixedRestDay` a suffi à réactiver silencieusement l'ancien
comportement. Et le générateur partageait sa logique avec sa propre validation,
donc une erreur présente dans l'un était invisible pour l'autre.

V3 répond à ces trois points par une **frontière**, un **refus de retomber en
arrière** et une **validation indépendante**.

## Modules

```
features/core/planning-v3/
├── types/            modèle immuable et versionné (v3.0.0)
├── problem-builder/  PlanningGenerationInput → PlanningProblemV3
├── validator/        (problème, solution) → rapport structuré
└── adapter/          sélecteur de moteur, injecté
```

## Invariants

- **Minutes entières partout.** Aucune heure décimale ni `"HH:mm"` ne franchit
  le builder ; les heures de la journée sont des minutes depuis minuit
  (06:00 = 360, 20:00 = 1200).
- **Aucun repli silencieux.** Un champ historique manquant produit une erreur
  structurée (`historical_field_missing`), jamais une valeur devinée et jamais
  un passage implicite à V2.
- **Déterminisme.** Ni horloge, ni aléatoire, ni parcours de collection non
  ordonnée. Une même entrée donne un problème identique, empreinte comprise.

## Frontière d'import

Le validateur doit pouvoir **contredire** le générateur. Il ne partage donc avec
lui que les modèles Core et les primitives de dates et de minutes.

Interdits dans tout le module : `business-pipeline`, `weekly-minute-allocator`,
`weekly-distribution`, `placeAllocatedWeek`, `candidate-plan-validator`, les
stratégies, constructeurs et validateurs V2, React, Next.js, `localStorage`.
Seul le builder touche à V2, et uniquement à `planning-generator/types/`.

Ces règles sont **exécutables** : `__tests__/import-boundaries.test.ts` lit les
sources et échoue si un import interdit apparaît.

## Le contre-contrôle des métriques

`PlanningSolutionV3.declaredMetrics` laisse le solveur s'engager sur ses
chiffres. Le validateur les recalcule depuis zéro et signale une violation
bloquante en cas de désaccord. C'est ce qui empêche une même erreur d'exister
des deux côtés.

Le **surplus structurel** ne dépend que du problème : pour chaque jour,
`max(0, budget − minutes demandées)`. Aucun planning ne peut le réduire, ce qui
en fait la référence pour isoler le surplus réellement évitable.

## Sévérités

`blocking` interdit la publication — définitivement, une fois V3 en service.
`degradation` est légal mais perfectible. `information` est neutre.

## Optimalité

`PlanningSolverProofV3.kind` vaut toujours `"none"` en V3A : aucun solveur
global n'a tourné, donc rien n'est démontré. `"optimal"` ne pourra être posé que
par un solveur terminé fournissant un certificat. **Ne jamais afficher « optimum
prouvé » sur une autre base.**

## Sélecteur de moteur

`PlanningEngineVersion` vaut `"v2" | "v3-shadow" | "v3"`. En V3A la valeur
effective est `"v2"`. Le sélecteur est **injecté** : aucun module Core ne lit sa
propre configuration. Aucun repli automatique entre versions n'existe — changer
de moteur sera une décision explicite, jamais une récupération d'erreur.

## Ce qui reste à faire

Le solveur global, le mode `v3-shadow` comparant V2 et V3 sur la même entrée,
puis le basculement. Le validateur est déjà la barrière : une solution portant
une violation bloquante ne pourra pas être publiée.
