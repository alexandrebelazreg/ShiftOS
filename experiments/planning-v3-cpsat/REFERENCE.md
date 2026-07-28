# Dossier de référence — port fidèle Python/HiGHS

État : **alignement terminé, port non commencé.**

Ce dossier réunit tout ce qu'il faut pour rejouer le spike Python à
l'identique et vérifier qu'il reproduit `0 créneau / 0 minute` sur la fixture
canonique. **Ne réécris ni ne nettoie aucun script tant que cette reproduction
n'a pas été obtenue sur le fichier brut.** Un nettoyage qui précède la
reproduction ne corrige pas un script : il en écrit un autre.

---

## 1. La fixture canonique

| | |
|---|---|
| Source de vérité | `features/core/planning-v3/__tests__/drive-canonical.ts` |
| Règles métier | `DRIVE_CANONICAL_RULES` dans ce même fichier |
| Problème sérialisé | `fixtures/drive-canonical-problem.json` |
| Planning de référence | `fixtures/drive-canonical-reference-solution.json` |
| **Empreinte** | **`p3_f5a81f5b6eacfcff`** |
| Contrat de la fixture | `features/core/planning-v3/__tests__/drive-canonical.test.ts` |

Les deux JSON sont **générés** depuis le builder de production, jamais écrits à
la main. Un test échoue si le fichier committé cesse de décrire le problème que
l'application poserait :

```bash
npx vitest run features/core/planning-v3/__tests__/drive-canonical.test.ts
```

Pour les régénérer après un changement voulu :

```bash
UPDATE_DRIVE_CANONICAL=1 npx vitest run features/core/planning-v3/__tests__/drive-canonical.test.ts
```

### Règles structurantes

- 5 salariés, contrat exact **2 205 minutes** chacun ;
- budgets journaliers exacts : lundi–jeudi 1 650, vendredi 2 430, samedi 1 995 ;
- ouverture 06:00, fermeture 20:00, dimanche fermé ;
- **Dylan ne commence pas avant 08:00** ;
- repos fixes : **Arthur le jeudi, Luca le mercredi** ;
- **au plus 2 fermetures par salarié ; aucune limite individuelle d'ouverture** ;
- **coupure réservée à Arthur**, de 45 à 90 minutes, au plus une par jour ;
- segment minimum 240 min, **segment continu maximum 480 min** ;
- journée maximum 600 min (uniquement atteignable avec coupure) ;
- repos interjournalier 12 h ;
- au moins 1 ouverture et **exactement** 1 fermeture par jour ouvert ;
- pas de temps 15 minutes.

`workEveryNonFixedRestDay` vaut `true` et **ne prime jamais sur un repos fixe** —
le builder exclut un jour de repos fixe de la disponibilité avant de calculer
l'obligation, et le test le vérifie explicitement.

---

## 2. Le planning de référence

`fixtures/drive-canonical-reference-solution.json` — 28 affectations, dont une
coupure (Arthur, vendredi 06:00–11:00 + 12:30–17:00).

**Vérifié par le validateur V3 officiel sur la fixture canonique :**

| Mesure | Valeur |
|---|---|
| Validité contraintes dures | ✅ **légal**, aucune violation |
| Créneaux sous-couverts | **0** |
| Minutes de déficit | **0** |
| Contrats | 2 205 min pour les 5 — exacts |
| Budgets journaliers | exacts sur les 6 jours |

C'est la cible du port : le spike doit reproduire ces chiffres **sur cette
empreinte**.

---

## 3. Scripts Python d'origine

| Fichier | Rôle |
|---|---|
| `cpsat_model.py` | modèle du solveur |
| `cpsat_service.py` | service appelé par l'adaptateur TypeScript |
| `cpsat_drive.py` | pilote du scénario Drive |
| `tests/test_coverage_concurrency.py` | parité de la couverture atomique avec le TS |
| `tests/test_feasibility_diagnostics.py` | diagnostics d'infaisabilité |
| `tests/test_role_propagation_equivalence.py` | propagation des rôles |

⚠️ Ces scripts ciblent **OR-Tools CP-SAT**, et les artefacts qu'ils ont produits
(`expected/`) portent l'empreinte **`p3_29f16d47dacffd2b`** — antérieure à la
fixture canonique. Ils ne reproduisent pas le `0/0` en l'état.

---

## 4. Environnement

Relevé sur la machine de développement :

| Composant | Version | État |
|---|---|---|
| Python | 3.12.10 | ✅ installé |
| Plateforme | Windows-11-10.0.26200-SP0 | — |
| NumPy | 2.5.0 | ✅ installé |
| OR-Tools | 9.15.6755 | ✅ installé |
| **SciPy** | — | ❌ **ABSENT** |
| **HiGHS** (via `scipy.optimize.milp`) | — | ❌ **indisponible sans SciPy** |

**Bloquant identifié.** Le port visé s'appuie sur HiGHS à travers
`scipy.optimize.milp`, et SciPy n'est pas installé. À faire avant toute
reproduction :

```bash
python -m pip install scipy
```

Puis relever les versions exactes et les consigner ici :

```bash
python -c "import sys, numpy, scipy; print(sys.version.split()[0], numpy.__version__, scipy.__version__)"
```

---

## 5. Reproduction du résultat brut

Dans l'ordre. Ne passe à l'étape suivante que si la précédente est verte.

```bash
python -m pip install scipy
```

```bash
npx vitest run features/core/planning-v3/__tests__/drive-canonical.test.ts
```

```bash
python experiments/planning-v3-cpsat/cpsat_drive.py --problem experiments/planning-v3-cpsat/fixtures/drive-canonical-problem.json
```

> Le drapeau `--problem` peut ne pas exister encore sur `cpsat_drive.py`. C'est
> attendu : le script lit aujourd'hui `fixtures/drive-problem.json`. **Ajouter ce
> point d'entrée est la première et la seule modification autorisée avant la
> reproduction** — pointer un script vers un autre fichier n'est pas le
> réécrire.

Enfin, faire auditer la sortie du spike par le validateur TypeScript, qui est la
seule autorité :

```bash
npx vitest run features/core/planning-v3/__tests__/drive-canonical.test.ts
```

---

## 6. Critère de succès du port

Le spike brut doit produire, **sur `p3_f5a81f5b6eacfcff`** :

- 0 créneau sous-couvert ;
- 0 minute de déficit ;
- 0 violation au validateur V3 ;
- un résultat reproductible à paramètres fixes.

Tant que ce critère n'est pas atteint, **ne nettoie rien**. Un écart entre le
spike et la référence est une information ; un écart entre un spike nettoyé et
la référence est une énigme.
