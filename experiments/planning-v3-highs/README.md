# ShiftOS HiGHS Solver — jalon de parité Drive

Ce paquet est un solveur Python autonome pour `PlanningProblemV3`, construit avec :

- Python 3.13.5 ;
- NumPy 2.3.5 ;
- SciPy 1.17.0 ;
- `scipy.optimize.milp` ;
- HiGHS embarqué par SciPy.

## Résultat obtenu

Sur la fixture canonique `p3_f5a81f5b6eacfcff` :

- 0 créneau sous-couvert ;
- 0 minute de déficit ;
- 0 violation dure selon l'évaluateur Python indépendant ;
- contrats exacts ;
- budgets journaliers exacts ;
- 28 affectations ;
- environ 14–16 secondes dans l'environnement de reconstruction ;
- même empreinte de solution sur trois exécutions séparées : `s3_e9c6e98a1700d926`.

Les mesures sont dans `results/`. Le rapport `results/typescript-validator-report.json` provient du code exact du validateur TypeScript officiel, exécuté sur la solution générée.

## Important : portée algorithmique

Ce jalon utilise **les mêmes outils numériques** que le spike documenté (SciPy/HiGHS), mais il ne prétend pas être une copie textuelle des cellules Python temporaires de la conversation, qui n'ont pas été conservées.

Pour obtenir une référence reproductible immédiatement, le modèle choisit directement un candidat de shift par salarié-jour dans un MILP exact. Il conserve les idées clés :

- domaine d'horaires plausibles ;
- shifts continus et coupés ;
- coupures opportunistes ;
- couverture atomique ;
- contrats et budgets exacts ;
- ouvertures, fermetures et repos ;
- validation indépendante.

Ce modèle est actuellement plus global que le pipeline expérimental « allocation → placement → échanges 2×2 ». Il sert d'**oracle HiGHS reproductible à zéro déficit** et de base d'intégration. Une future réduction de domaine peut réintroduire la décomposition sans changer les tests de parité.

## Installation

> **L'application cherche ce venv à la racine du dépôt, sous le nom
> `.venv-planning-highs`.** Le moteur `v3-highs-fast` de l'écran Planning lance
> son propre interpréteur : il ne peut pas partager celui de CP-SAT, dont les
> dépendances (OR-Tools) n'ont rien à voir avec celles-ci (scipy, HiGHS).
>
> L'ordre de résolution est : la variable `PLANNING_HIGHS_PYTHON` si elle est
> définie, sinon `.venv-planning-highs` à la racine, sinon le `python` du
> `PATH`. Ce dernier cas produit typiquement
> `highs-missing — No module named 'scipy'` dans l'interface : c'est le moteur
> qui dit qu'il ne peut pas tourner, jamais un verdict sur la semaine.
>
> Depuis la racine du dépôt :
>
> ```bash
> python -m venv .venv-planning-highs
> .venv-planning-highs/Scripts/python -m pip install -r experiments/planning-v3-highs/requirements.txt
> ```

Pour travailler l'expérience seule, un venv local suffit :

```bash
python -m venv .venv
```

Sous macOS/Linux :

```bash
source .venv/bin/activate
```

Sous Windows PowerShell :

```powershell
.venv\Scripts\Activate.ps1
```

Puis :

```bash
python -m pip install -r requirements.txt
```

## Résoudre Drive

```bash
python solve.py \
  fixtures/drive-canonical-problem.json \
  --output results/drive-canonical-highs-result.json \
  --time-limit 45
```

Vérification Python :

```bash
python -m unittest discover -s tests -v
```

## Mesurer une zone marché

Les fixtures versionnées étaient toutes mono-secteur : le chemin multi-secteur
n'était mesuré que par les zones jouets des tests, qui ne portent aucun des
arbitrages d'un vrai rayon frais. `fixtures/build_market_zone.py` construit une
semaine à quatre comptoirs aux horaires différents, sept temps partiels et une
équipe qui ne suffit pas tout à fait — la seule situation où le moteur doit
choisir OÙ manquer.

```bash
python fixtures/build_market_zone.py
python zone_report.py market-zone-problem.json 60 --grid
```

`zone_report.py` répond à la question qu'un chef de rayon pose en ouvrant son
planning, et que `referenceShortSlots` ne sait pas poser :

- `counterMinutesEmpty` — minutes où un comptoir ouvert n'a personne ;
- `openingMinutesEmpty` — celles de la PREMIÈRE HEURE, comptées à part. Un
  comptoir qui ouvre en retard se voit, un creux de quinze heures beaucoup
  moins ; noyées dans le total, ces minutes-là étaient invisibles. Mesuré avant
  correctif : 300 minutes par semaine, presque un quart de tout le temps désert ;
- `counterMinutesSurplus` — minutes passées là où la demande ne réclamait
  personne, c'est-à-dire les doublons ;
- `unavoidableDeficitMinutes` / `avoidableDeficitMinutes` — la présence totale
  étant fixée par l'allocation, le déficit vaut le manque structurel PLUS le
  surplus. Seule la seconde part se gagne, et c'est elle qu'il faut regarder.

Le placement multi-secteur travaille sous limite de temps : un run ne prouve
rien. `zone_sweep.py` relance N fois et donne médiane et étendue.

```bash
python zone_sweep.py market-zone-problem.json 60 5 essai
```

### L'ouverture ne vaut pas une heure creuse

Le déficit était UNIFORME : une heure manquante à l'ouverture coûtait le même
prix qu'une heure manquante à quinze heures, donc le moteur plaçait le trou là
où ses durées tombaient le mieux — souvent au début. `OPENING_DARK_MULTIPLIER`
double le prix d'un comptoir désert pendant `OPENING_PRIORITY_MINUTES` après son
ouverture.

C'est un POIDS, jamais une règle dure : le moteur va combler l'ouverture en
priorité et, s'il ne le peut pas, rend quand même un planning au lieu de
déclarer la semaine impossible — ce qu'un plancher incassable aurait fait.

Mesuré sur `market-zone-problem.json`, deux exécutions de chaque :

| | ouverture déserte | désert total | déficit | créneaux |
| --- | --- | --- | --- | --- |
| poids 1 (avant) | 150–300 min | 1 230–1 260 | 1 560–1 590 | 56–57 |
| poids 2 | **0 min** | 1 215 | 1 605 | 57 |

Tous les comptoirs ouvrent à l'heure, les six jours, et le temps désert total
baisse. Ce que ça coûte : une trentaine de minutes de déficit en plus, prises
non pas en creusant un trou ailleurs mais en DÉGARNISSANT des créneaux qui
réclamaient deux personnes. Un comptoir tenu par une au lieu de deux à midi
contre un comptoir fermé à l'ouverture — l'échange est le bon sens.

La règle est définie une seule fois, dans `opening_priority_cells`, et partagée
par le placement, l'oracle et le barème de comparaison : trois lectures
divergentes de la même règle donneraient trois mesures incomparables.

### Trois dotations, pour séparer le moteur de l'effectif

Le constructeur écrit la même semaine à trois niveaux d'effectif, parce qu'un
déficit ne dit rien tant qu'on ignore lequel des deux le cause :

| fixture | contrats / demande | ce qu'elle mesure |
| --- | --- | --- |
| `market-zone-problem.json` | 91 % | la semaine réelle : il manque des bras |
| `market-zone-staffed-problem.json` | 100 % | l'ajustement exact — zéro devient arithmétiquement possible |
| `market-zone-slack-problem.json` | 113 % | avec du mou : un déficit ici n'a plus d'excuse arithmétique |

La dotation est **bornée par la capacité réelle des journées** : les budgets
sont exacts et proportionnels à la demande, donc gonfler les contrats gonfle
chaque budget, et le premier qui dépasse ce que son équipe peut travailler rend
la semaine impossible. Le plafond d'un salarié n'est pas son maximum quotidien —
qui ne peut pas couper ne tient qu'une seule traite.

`placementProven` dit si le MILP a PROUVÉ l'optimalité de son horaire pour les
durées qu'on lui avait données. Prouvé et déficitaire, le manque restant vient
de l'allocation, pas du placement : c'est le seul moyen de savoir où chercher.
`placementGap` complète la réponse quand ce n'est pas prouvé — un horaire à 2 %
de la borne est à prendre, un à 50 % dit que la recherche patauge et qu'il faut
changer de question plutôt que de lui donner du temps. `placementGap` **absent**
alors qu'un planning existe signifie que c'est le repli de faisabilité qui l'a
produit : légal, jamais optimisé.

> **Ces mesures sont sensibles à la charge de la machine.** Le placement est
> limité en temps réel, donc une machine occupée explore moins : la même semaine
> a donné 1 560 minutes de déficit au repos et 1 590 pendant qu'une autre
> campagne tournait. Mesurer deux variantes en parallèle ne compare rien.

### De combien le moteur rapide manque-t-il ?

`shiftos_highs/solver.py` répond à cette question pour un rayon unique et ignore
complètement les comptoirs : une zone n'avait donc aucune référence, et l'on y
mesurait des progrès sans savoir contre quoi. `shiftos_highs/oracle_zone.py`
pose la semaine en UN seul MILP — aucune durée fixée d'avance, aucun rôle
distribué, toutes les lectures par comptoir en concurrence — et rend l'optimum
de la semaine, pas celui d'une allocation.

```bash
python zone_oracle_report.py market-zone-problem.json 60 600
```

Il est écrit **à part du placement, délibérément**. Un juge qui partagerait la
construction de lignes de l'accusé hériterait de ses erreurs. Et il n'a aucune
raison de tenir en soixante secondes : c'est un instrument de mesure, on lui
donne des minutes, et s'il ne prouve rien il ne dit rien du moteur rapide.

**Où il en est, mesuré.** Sur les zones de contrôle il rend l'optimum PROUVÉ en
moins d'une seconde, contrats et budgets journaliers respectés à la minute —
c'est ce qui établit que ses contraintes sont justes. Sur une semaine réelle à
quatre comptoirs il construit son modèle en une dizaine de secondes depuis que
la matrice est bâtie en tableaux, mais **il ne résout pas en entier** : 396 293
candidats, 398 578 colonnes binaires, et rien rendu en vingt-six minutes.

### Le plancher, quand le plafond est hors de portée

`relaxation_only=True` ne cherche pas de planning : il relâche l'exigence
d'entiers et rend le **plancher** du déficit, ce qu'aucun horaire ne pourra
jamais battre. C'est incomparablement plus facile, et cela suffit à répondre à
« de combien le moteur rapide manque-t-il ».

Il faut noter les deux avec la MÊME règle, d'où `score_like_the_oracle` : le
moteur rapporte des minutes brutes, l'objectif compte des minutes pondérées —
une première personne manquante sur un comptoir pèse quatre fois une suivante,
et un créneau entamé compte à part. Deux nombres qui ne mesurent pas la même
chose ne se soustraient pas.

Mesure du 2026-08-09 sur `market-zone-problem.json` :

| | points d'objectif |
| --- | --- |
| moteur rapide, 60 s | 6 090 |
| plancher prouvé, 824 s | 4 654 |
| marge maximale | 1 436, soit 23,6 % |

**Cette borne est lâche, et il faut le dire.** La relaxation autorise des
demi-personnes, et une demi-personne à un comptoir y compte comme une
demi-couverture — ce qu'aucun planning réel ne peut faire. Un calcul de coin de
table le montre : il manque structurellement 87 quarts d'heure-personne, la
plupart des cellules ne réclament qu'une personne, donc en manquer une laisse le
comptoir désert à 60 points — soit déjà 5 220, bien au-dessus du plancher
relâché. La marge réelle est donc franchement inférieure à 1 436.

Ce qui reste à essayer pour la resserrer : générer les colonnes au lieu de
toutes les énumérer, ou mesurer une semaine réelle plus PETITE que l'oracle
résout en entier.

### Le moteur tient-il sur d'autres contraintes ?

`zone_variants.py` dérive de la zone des semaines qui changent chacune UNE seule
chose — coupures interdites, planchers durs partout, chacun sur un seul
comptoir, tout le monde polyvalent, fermeture une heure plus tard — et vérifie
sur chacune qu'il sort un planning, que l'évaluateur indépendant l'accepte, et
que le déficit évitable reste petit.

```bash
python zone_variants.py market-zone-problem.json 60
```

## Validation officielle TypeScript

Le paquet contient :

```text
integration/drive-highs-validation.test.ts
```

Après avoir placé le dossier sous `shiftos-highs-solver/` à la racine de ShiftOS, copier le test dans le dépôt :

```bash
cp shiftos-highs-solver/integration/drive-highs-validation.test.ts \
  features/core/planning-v3/__tests__/drive-highs-validation.test.ts
```

Puis :

```bash
npx vitest run features/core/planning-v3/__tests__/drive-highs-validation.test.ts
```

Ce test appelle le **validateur TypeScript officiel**. La réponse Python n'est jamais acceptée sur sa seule déclaration.

## Architecture du paquet

```text
shiftos-highs-solver/
├── fixtures/
├── integration/
├── results/
├── shiftos_highs/
│   ├── candidates.py
│   ├── evaluate.py
│   ├── fingerprint.py
│   └── solver.py
├── tests/
├── solve.py
├── requirements.txt
└── README.md
```

## Limites de la version 0.1

- Elle cible d'abord la fixture canonique où tous les jours disponibles sont obligatoires.
- La demande `requiredEmployees` est imposée comme couverture dure dans le jalon de parité, puisque zéro est connu comme faisable.
- Elle ne gère pas encore les jours optionnels, les verrous manuels ni les absences multi-semaines.
- Elle ne doit pas remplacer le moteur par défaut avant validation TypeScript et essais sur Accueil/absences.
