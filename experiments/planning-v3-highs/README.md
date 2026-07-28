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
