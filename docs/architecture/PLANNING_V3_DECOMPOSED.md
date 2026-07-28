# Planning V3 — moteur décomposé (`v3-decomposed`)

Statut : **intégré, expérimental, non par défaut.**
Le moteur est sélectionnable explicitement. Le moteur par défaut reste `v2`.
CP-SAT (`v3`) n'est ni remplacé ni modifié.

---

## 1. Pourquoi un troisième moteur

Le solveur DFS V3B et CP-SAT partagent un trait : ils énumèrent l'espace des
shifts **avant** de savoir combien de minutes chacun doit travailler. Sur la
semaine Drive, cela produit environ 20 000 candidats
(`drive-solve-response-current.json`), dont l'immense majorité contredit les
contrats avant même qu'un placement ait commencé.

Le moteur décomposé retire une dimension entière : il décide **d'abord** les
durées, **ensuite** les horaires. Une fois la durée d'une journée fixée, seul le
départ reste libre, et l'espace passe de dizaines de milliers de candidats à
quelques milliers.

Ce n'est pas seulement plus rapide. C'est aussi ce qui rend les contraintes
hebdomadaires — contrat exact, plafonds d'ouvertures et de fermetures, repos
interjournalier — décidables **avant** la recherche plutôt que découvertes
pendant.

---

## 2. Le pipeline

```
features/core/planning-v3/solver-decomposed/
├── diagnostics/     Phase 1 — normalisation + impossibilités prouvées
├── allocation/      Phase 2 — minutes par salarié et par jour
├── skeleton/        Phase 3 — qui ouvre, qui ferme, qui coupe
├── candidate-generator/ Phase 4 — formes plausibles uniquement
├── placement/       Phase 5 — horaires exacts, couverture atomique
├── repair/          Phase 6 — déplacements locaux bornés
├── objective/       tuple lexicographique explicite
└── solve.ts         l'orchestration des six phases
```

### Phase 1 — Normalisation et diagnostics structurels

Trie salariés et jours par un ordre total fondé sur les valeurs, matérialise la
disponibilité, et calcule le **plafond journalier réel** de chaque cellule.

Les diagnostics sont des **conditions nécessaires**, jamais des heuristiques.
Chacun compare ce que le problème *exige* à ce qu'il peut au mieux *fournir* :

- contrats totaux ≠ budgets totaux (les deux sont exacts dans le modèle) ;
- contrat d'un salarié > capacité de ses jours disponibles ;
- budget d'un jour > capacité des salariés disponibles ;
- aucun ouvreur ou fermeur capable ;
- plancher incassable au-dessus du nombre de personnes pouvant être présentes.

Une condition qui se déclenche prouve qu'aucun planning n'existe. **Une
impossibilité n'est jamais convertie en déficit accepté.**

### Phase 2 — Allocation des minutes

Résout un **problème de transport à cellules semi-continues** :

```
Σ_d M[e][d] = contrat(e)                      exact
Σ_e M[e][d] = budget(d)                        exact
M[e][d] = 0  ou  min(e) ≤ M[e][d] ≤ capacité(e,d)
tout multiple du pas de 15 minutes
```

La semi-continuité — un jour est un repos ou un vrai shift, jamais vingt minutes
symboliques — est ce qui rend le problème combinatoire, et c'est aussi ce qui en
fait la bonne décomposition.

Générateur **paresseux et ordonné** : les allocations sortent meilleure d'abord,
sous une cible proportionnelle. L'appelant en prend une, tente le placement, et
revient en chercher une autre sans jamais matérialiser un espace exponentiel.

**Une coupure est une conséquence, jamais un arrondi.** L'ordre des choix
pénalise les durées qui forcent une coupure, *et* celles qui en forceraient une
chez un collègue visité plus tard. Sans ce regard en avant, l'allocation de
l'Accueil donnait dix heures à Marine un mardi tenu par deux personnes, laissant
un trou de quarante-cinq minutes que personne ne pouvait couvrir.

### Phase 3 — Squelette hebdomadaire

Décide **avant tout horaire** qui ouvre, qui ferme, qui coupe — parce que ce
sont des faits **hebdomadaires**. « Au plus deux fermetures chacun » est une
phrase sur la semaine ; la décider en plaçant lundi, c'est découvrir vendredi
que le seul fermeur éligible a déjà fermé deux fois.

Asymétrie assumée, conforme au modèle :

- `minimumOpeningsPerDay` est un **plancher** : les tailles sont essayées du
  nombre utile vers le plancher, jamais figées à l'un des deux ;
- `exactClosingsPerDay` est **exact** : fermer est la responsabilité d'une seule
  personne, un second fermeur est un défaut, pas de la couverture en plus.

Le squelette refuse aussi « ferme le soir, ouvre le lendemain » : les deux
horaires sont fixés ici, donc le conflit de repos y est entièrement décidable.

**Sélection par potentiel de couverture, pas par équité.** Une première version
parcourait la semaine chronologiquement et donnait chaque corvée au moins chargé,
en gardant les six premiers résultats faisables. Équitable, et aveugle : la
couverture n'était jamais consultée, donc un squelette laissant un ouvreur face à
une demande de quatre valait exactement un squelette en laissant quatre. Un audit
de la semaine Drive a mesuré le coût — **six des huit créneaux sous-couverts
étaient déjà inévitables au moment où le squelette était figé**, avant que le
placement n'ait pris la moindre décision.

La sélection suit désormais l'ordre : contraintes dures, jours critiques,
ressources rares d'ouverture et de fermeture, potentiel de couverture, fragilité
du repos, puis seulement l'équité.

- `week-analysis.ts` calcule la **criticité** de chaque jour (marge entre le
  vivier d'ouvreurs et la demande à l'ouverture) et la **contention** de chaque
  capacité (jours où elle est utile ÷ usages permis). Une capacité voulue plus
  souvent qu'elle ne peut servir est rare et ne doit pas être dépensée là où des
  alternatives existent.
- `skeleton-score.ts` mesure le **déficit déjà rendu inévitable**, à partir d'un
  profil de présence maximale par cellule de 15 minutes. Le profil est une borne
  supérieure *sûre* : un ouvreur désigné est cloué à l'ouverture, un fermeur à la
  fermeture, et tout autre salarié est compté comme présent partout dans sa
  fenêtre. Cette sur-estimation de la présence sous-estime le déficit, ce qui en
  fait un **minorant** — jamais une pénalité pour un trou qu'un placement habile
  aurait évité.
- Les candidats viennent de **six familles déterministes** (jours critiques
  d'abord, chronologique, réservation des ouvertures rares, minimisation du
  blocage du lendemain, pics d'abord, et l'équité conservée en famille
  secondaire), sont dédupliqués par signature de rôles, puis classés par ce
  score avant qu'un seul nœud de placement ne soit dépensé.

Mesuré sur Drive : **120 squelettes générés, 80 signatures uniques**, contre six
variantes quasi identiques d'un même parcours auparavant.

### Phase 4 — Génération réduite

Une durée décidée ⇒ un seul degré de liberté. Le squelette en retire encore : un
ouvreur désigné a **un** départ légal, un fermeur aussi, et quelqu'un désigné ni
l'un ni l'autre a **interdiction** de tomber sur une borne — lecture à double
sens sans laquelle un non-ouvreur créerait silencieusement une seconde ouverture
et casserait un plafond déjà arbitré.

La règle de repos est **propagée dans les fenêtres** avant génération. Mesuré
sur Drive avant cette propagation : la marche hebdomadaire rejetait 57 600 des
57 840 motifs sur le seul repos et n'atteignait jamais le troisième jour.

### Phase 5 — Placement exact

Deux étages, parce que les contraintes ont deux formes :

- **dans un jour**, la couverture est le seul enjeu et tous les choix
  interagissent → le jour est résolu d'un bloc, seuls ses meilleurs motifs sont
  conservés ;
- **entre les jours**, il ne reste que le repos, qui est une chaîne → marche en
  profondeur avec borne lexicographique.

La couverture est mesurée sur une **grille au pas de 15 minutes**. Elle est
*exacte*, pas approchée : la Phase 1 refuse tout créneau désaligné du pas, et
tout candidat commence et finit sur un multiple du pas — donc aucune présence ne
change à l'intérieur d'une cellule, ce qui est la définition d'un intervalle
atomique.

**Un plancher dur n'est jamais négocié.** Un motif qui en enfonce un est écarté
à l'étage un : ce n'est pas un moins bon motif, ce n'est pas un motif.

### Phase 6 — Réparation locale bornée

Glisse des shifts entiers de quelques pas et ne garde un déplacement que si
l'objectif lexicographique s'améliore **strictement**. Au plus 30 minutes de
déplacement absolu cumulé par salarié sur la semaine. Les shifts portant une
ouverture ou une fermeture sont **immobiles**. Facultative et déterministe.

---

## 3. Objectif lexicographique

Un **tuple**, jamais une somme pondérée — une somme laisse un gain bon marché
sur une priorité basse payer une perte sur une priorité haute.

| # | Composante | Nature |
|---|---|---|
| 0 | `hard-violations` | interdite : le moteur n'émet jamais autre chose que 0 |
| 1 | `soft-under-covered-slots` | additive par jour |
| 2 | `deficit-minutes` | additive par jour |
| 3 | `avoidable-surplus-minutes` | coût métier |
| 4 | `unmet-preservations` | toujours 0 : le moteur ne préserve rien encore |
| 5 | `individual-deviation-minutes` | écart à la distribution journalière |
| 6 | `opening-closing-fairness` | équité des corvées |
| 7 | `instability` | toujours 0 : pas de stabilité encore |
| 8 | `schedule-complexity` | départage : horaires simples d'abord |

Les composantes 0–5 sont additives et positives, ce qui rend une somme partielle
**bornante** : une branche déjà perdante ne peut jamais se rattraper.

---

## 4. Invariants

1. Le validateur V3 officiel reste la **seule autorité**. Le moteur n'importe
   jamais `validate-solution` — seulement `fingerprint`, un hachage pur qui ne
   décide rien. Règle **exécutable** :
   `__tests__/import-boundaries.test.ts`.
2. **Aucun repli.** Un échec est diagnostiqué, jamais remplacé par le résultat
   d'un autre moteur.
3. **Déterminisme.** Aucun aléatoire, aucune horloge dans les décisions, aucun
   parcours de collection non ordonnée. Ordres totaux fondés sur les valeurs
   partout.
4. **Minutes entières** partout, pas de 15 minutes partout.
5. **`proof.kind` vaut toujours `"none"`.** L'espace est réduit *par
   construction* ; une bonne réponse à une question plus petite n'est pas un
   optimum.

---

## 5. Le plancher opérationnel dur

Nouveau ce sprint : `PlanningDemandSlotV3.hardMinimumEmployees?`.

| | `requiredEmployees` | `hardMinimumEmployees` |
|---|---|---|
| Nature | cible métier | plancher incassable |
| Manqué → | dégradation à accepter | **violation bloquante** |
| Compté dans le déficit | oui | non |

La distinction n'est pas académique. « Quelqu'un doit être présent en continu »
est un fait sur la capacité du magasin à ouvrir ; « trois personnes au pic du
midi » est une cible qui plie devant l'équipe réellement disponible.

Vérification **atomique** dans le validateur officiel : le plancher est comparé
à la présence concurrente **minimale** de la fenêtre. Un créneau tenu partout
sauf quinze minutes échoue.

**Non cassant** : champ absent = comportement historique strictement inchangé.
`__tests__/hard-coverage-floor.test.ts` le vérifie explicitement.

---

## 6. Différences avec CP-SAT

| | CP-SAT (`v3`) | Décomposé (`v3-decomposed`) |
|---|---|---|
| Implémentation | Python + OR-Tools, sous-processus | TypeScript pur, en processus |
| Dépendances | interpréteur Python, `ortools` | **aucune** |
| Transport | `node:child_process` | aucun |
| Bundlable navigateur | non | oui |
| Espace de candidats | ~20 150 sur Drive | ~7 900 sur Drive |
| Optimalité | peut en principe la prouver | **jamais**, par construction |
| Recherche | globale, complète | décomposée, volontairement réduite |
| Budget typique Drive | 120 s | ~6 s |

Les deux satisfont le **même contrat**. Un appelant qui en tient un ne peut pas
savoir lequel — c'est toute la propriété que le contrat achète.

---

## 7. Résultats mesurés

> ### ⚠️ Règle de lecture : une empreinte, une question
>
> **Aucun chiffre de cette section ne doit être comparé à un autre portant une
> empreinte de problème différente.** Trois résultats Drive ont circulé comme
> une comparaison alors qu'ils décrivaient trois problèmes distincts ; l'un
> d'eux — « CP-SAT : 8 créneaux » — venait en réalité d'un run **interrompu**,
> pas d'un optimum. Chaque tableau porte donc son `problemFingerprint`.

Machine locale, `npm test`. Chiffres régénérables :
`features/core/planning-v3/solver-decomposed/__tests__/benchmark.test.ts`.

> **Les empreintes citées dans cette section sont historiques.** Le 28 juillet
> 2026, `fingerprintProblem` a cessé d'ignorer cinq champs : les bornes
> quotidiennes par salarié, le droit de couper, et — le plus coûteux — les
> entrées `employeeDays` dans leur ensemble. Une semaine où quelqu'un était
> **absent** portait jusque-là la même identité que la semaine où il était
> présent, tout comme deux semaines ne différant que par l'heure d'arrivée
> autorisée. Le défaut a été trouvé par une campagne de perturbations qui perdait
> trois de ses six axes : chaque scénario ressemblait à la référence et était
> écarté comme doublon.
>
> Toutes les empreintes ci-dessous ont donc bougé sans que le problème change.
> Drive canonique est passé de `p3_2d27bbc36346cb07` à `p3_b114fe2b5b80e957`.
> **Les chiffres de couverture restent valables ; les empreintes ne servent plus
> qu'à distinguer les artefacts entre eux à l'intérieur de cette section, jamais
> à les comparer à une mesure postérieure à cette date.**

### 7.1 Les artefacts Drive, séparés

| # | Artefact | Empreinte | Créneaux | Déficit | Arrêt | Preuve |
|---|---|---|---|---|---|---|
| 1 | CP-SAT, run **interrompu** (`drive-solve-response-current.json`) | `p3_ad1f4d1ed24c06a2` | 8 | — | `timeout` 120 s | **aucune — non convergé** |
| 2 | CP-SAT, **optimum prouvé** (`expected/cpsat-report.json`) | `p3_29f16d47dacffd2b` | **1** | **60 min** | `OPTIMAL` | prouvé sur les 2 premiers objectifs |
| 3 | **Spike Python/HiGHS** (`fixtures/drive-canonical-reference-solution.json`) | `p3_f5a81f5b6eacfcff` | **0** | **0 min** | — | légalité vérifiée par le validateur V3 |

**Les trois lignes ne se comparent pas entre elles.** L'artefact 1 est un run
coupé au bout de 120 secondes : il ne dit rien sur l'optimum et n'aurait jamais
dû servir de référence. L'artefact 2 porte une empreinte antérieure à l'ajout
des règles de coupure au contrat. Seul l'artefact 3 porte l'empreinte
canonique — c'est la seule référence valable aujourd'hui.

### 7.2 Drive canonique — la seule comparaison directe

Empreinte **`p3_f5a81f5b6eacfcff`**. Fixture : `__tests__/drive-canonical.ts`.
Règles structurantes : 5 salariés à 2 205 min ; budgets 1650/1650/1650/1650/2430/1995 ;
Dylan pas avant 08:00 ; repos fixes Arthur jeudi et Luca mercredi ; **au plus
2 fermetures par salarié, aucune limite d'ouverture** ; coupure réservée à
Arthur, 45–90 min ; segments 240–480 min ; journée ≤ 600 min ; repos 12 h.

| Moteur | Créneaux | Déficit | Temps | Preuve |
|---|---|---|---|---|
| **Python/HiGHS (référence)** | **0** | **0 min** | — | légal, vérifié par le validateur V3 |
| Décomposé `v3-decomposed` | **4** | **195 min** | 13,9 s | `none` (`state-limit`) |

C'est la comparaison qui compte, et la seule à périmètre égal. L'écart réel est
de **4 créneaux et 195 minutes**, pas les « 6 contre 0 » publiés auparavant sur
deux problèmes différents.

### 7.3 Drive legacy — pour mémoire, non comparable

Sur la fixture de migration `__tests__/drive-problem.ts` (empreinte
`p3_ad1f4d1ed24c06a2`), qui plafonne à tort un salarié à une ouverture et deux
autres à une fermeture, le moteur décomposé mesure **6 créneaux / 330 minutes**
en 8,5 s. Ce chiffre pinne une régression sur cette fixture-là ; **il ne mesure
pas la qualité du moteur** et ne se compare à rien.

La sélection des squelettes par score y avait fait passer le moteur de 8/450 à
6/330, gain entièrement dû à la Phase 3, et convergé — dix fois le budget
renvoie exactement le même résultat.

### 7.4 Accueil — 4 salariés, amplitude 07:30–20:45

Empreinte **`p3_3460225e598f3272`**.

| Mesure | Valeur |
|---|---|
| Résultat validateur | **légal**, aucune violation bloquante |
| Créneaux sous-couverts | **0** |
| Minutes de déficit | **0** |
| Temps total | 13,3 s |
| Cause d'arrêt | `exhausted` |
| Preuve | `none` |

Ce scénario est couvert intégralement : continuité d'une personne de 07:30 à
20:45 tous les jours, deux personnes le samedi de 10:00 à 18:30, coupure de
Kenza imposée par ses dix heures, aucune coupure pour Brigitte ni Marie,
plafonds d'ouvertures et de fermetures tenus, contrats exacts.

### 7.5 Ce que chaque mesure doit désormais porter

Toute entrée du benchmark enregistre : `problemFingerprint`, moteur, version du
moteur, limite de temps, limite de nœuds, cause d'arrêt, statut de preuve,
créneaux, minutes de déficit, et un résumé des règles structurantes du problème.
Sans ces champs, un chiffre n'est pas un résultat — c'est une anecdote.

---

## 8. Limites connues

1. **Qualité de couverture en deçà de V2 sur Drive** (6 contre 4), et
   **convergée** : dix fois le budget ne change rien. Les six créneaux restants
   ne sont donc ni un manque de temps ni un défaut de la Phase 3 — ils tiennent
   à la décomposition elle-même, qui fige les rôles avant de placer et ne peut
   plus revenir dessus. Le moteur ne remplace pas V2 et n'en est pas le candidat
   aujourd'hui.
2. **Aucune préservation.** Pas de verrou, pas de retouche manuelle conservée,
   pas d'objectif de stabilité. Déclaré dans
   `DECOMPOSED_PRESERVATION_SUPPORT`, donc reporté au manager plutôt que
   silencieux, et interdisant toute annonce d'optimalité par les invariants du
   contrat.
3. **Espace volontairement réduit** : premières allocations, meilleurs motifs de
   chaque jour. Un `infeasible` renvoyé après recherche ne prouve **rien** sur
   le problème, et le diagnostic le dit.
4. **Coupures non opportunistes** : une coupure n'est générée que lorsque la
   durée l'impose, jamais pour améliorer la couverture.
5. **Créneaux désalignés refusés.** Un créneau hors du pas produit
   `invalid-problem` plutôt qu'un arrondi. C'est délibéré — arrondir vers
   l'extérieur inventerait de la couverture, vers l'intérieur masquerait un
   trou — mais c'est une restriction réelle.
6. **Règles supposées.** `maximumContinuousMinutes` et `maximumSplitsPerDay` ne
   sont déclarés par aucun secteur aujourd'hui. Le moteur les suppose et
   **l'annonce** dans ses diagnostics (`assumed_rules`), mais la configuration
   reste à construire.
7. **Contraintes horaires individuelles** : le modèle et le validateur les
   supportent, le point d'extension existe dans le builder
   (`individualEarliestStart`), mais aucune contrainte applicative ne les
   produit encore. Les fixtures les posent directement sur le problème.

---

## 9. Risques

- **Le plancher dur peut rendre infaisable un problème qui passait avant.** Un
  secteur qui déclarerait un plancher trop ambitieux verrait ses plannings
  refusés au lieu d'être dégradés. Le champ étant optionnel et absent partout
  aujourd'hui, le risque est nul tant que rien ne le renseigne — mais il devient
  réel dès la première configuration.
- **Le budget de nœuds est réparti par placement** (250 000). Un problème plus
  grand que l'Accueil pourrait n'explorer qu'une fraction de ses allocations. Le
  moteur le dit (`stopCause`), il ne le cache pas.
- **Deux moteurs V3 à maintenir.** Chaque évolution du contrat doit être
  répercutée sur les deux adaptateurs.

---

## 10. Stratégie de bascule future

Aucune bascule n'est proposée aujourd'hui. Les étapes, dans l'ordre :

1. **Décider entre le portage fidèle Python/HiGHS et la poursuite du moteur
   TypeScript.** L'itération sur la Phase 3 a rendu ce qu'elle pouvait rendre
   (8 → 6) et le résultat est convergé. Poursuivre en TypeScript demanderait de
   remettre en cause la décomposition elle-même — replacer les rôles *pendant*
   le placement — c'est-à-dire d'abandonner ce qui fait sa vitesse.
2. **Enseigner les préservations au moteur** (verrous, retouches, stabilité).
   Sans elles, une régénération détruit le travail manuel du manager, ce qui
   interdit tout usage quotidien.
3. **Créer la configuration des règles supposées** —
   `maximumContinuousMinutes`, `maximumSplitsPerDay`, coupure minimale — pour
   que le moteur cesse de supposer.
4. **Construire les contraintes horaires individuelles** de bout en bout,
   depuis le formulaire jusqu'au builder.
5. **Comparer sur données réelles** en faisant tourner les deux moteurs V3 sur
   les mêmes semaines, à l'initiative d'un humain. Pas de mode shadow : un
   second planning que personne ne regarde ne renseigne personne.

Le moteur par défaut ne changera que lorsque les points 1 et 2 seront tenus, et
ce sera une décision explicite — jamais une récupération d'erreur.
