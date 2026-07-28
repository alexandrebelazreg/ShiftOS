# Transmission — reconstruction Python/SciPy/HiGHS du moteur Drive

Document de passation. Le développement TypeScript est **arrêté** ; rien dans ce
paquet n'attend d'être modifié côté TS.

---

## 1. L'empreinte canonique

```
p3_f5a81f5b6eacfcff
```

C'est l'identité du problème Drive de référence. **Tout résultat annoncé pour
Drive doit porter cette empreinte.** Deux chiffres portant des empreintes
différentes répondent à deux questions différentes et ne se comparent jamais —
c'est exactement la confusion qui a fait circuler trois résultats Drive
incompatibles comme s'ils formaient un classement.

L'empreinte est épinglée dans
`features/core/planning-v3/__tests__/drive-canonical.test.ts` : elle rougit si
une règle, le builder ou la fixture change.

---

## 2. Chemins exacts

| Rôle | Chemin |
|---|---|
| **Problème canonique (JSON)** | `experiments/planning-v3-cpsat/fixtures/drive-canonical-problem.json` |
| **Solution de référence 0/0 (JSON)** | `experiments/planning-v3-cpsat/fixtures/drive-canonical-reference-solution.json` |
| Source de vérité de la fixture | `features/core/planning-v3/__tests__/drive-canonical.ts` |
| Contrat exécutable de la fixture | `features/core/planning-v3/__tests__/drive-canonical.test.ts` |
| Dossier de portage détaillé | `experiments/planning-v3-cpsat/REFERENCE.md` |

Les deux JSON sont **générés** depuis le builder de production, jamais écrits à
la main.

---

## 3. Commandes

Vérifier que la fixture et les instantanés sont cohérents :

```bash
npx vitest run features/core/planning-v3/__tests__/drive-canonical.test.ts
```

Régénérer les instantanés après un changement **voulu** des règles :

```bash
UPDATE_DRIVE_CANONICAL=1 npx vitest run features/core/planning-v3/__tests__/drive-canonical.test.ts
```

Suite complète et build :

```bash
npm test
```

```bash
npm run build
```

Installer la dépendance manquante du port (voir §7) :

```bash
python -m pip install scipy
```

---

## 4. Règles Drive canoniques

Source unique : `DRIVE_CANONICAL_RULES` dans `drive-canonical.ts`. Réécrites ici
pour lecture, jamais dupliquées en code.

### Effectif et volumes

- 5 salariés : `arthur`, `dylan`, `erwan`, `luca`, `valentin` ;
- contrat hebdomadaire **exact** : **2 205 minutes** chacun ;
- budgets journaliers **exacts** :

| Jour | Minutes |
|---|---|
| lundi | 1 650 |
| mardi | 1 650 |
| mercredi | 1 650 |
| jeudi | 1 650 |
| vendredi | 2 430 |
| samedi | 1 995 |
| dimanche | fermé |

Les deux totaux valent **11 025 minutes**. Ce sont la même quantité comptée deux
fois : un écart rendrait le problème insoluble par construction.

### Horaires

- ouverture **06:00**, fermeture **20:00** ;
- pas de temps **15 minutes** — tout début, toute fin et toute durée en sont
  multiples ;
- **Dylan ne commence jamais avant 08:00.**

### Repos

- repos fixes : **Arthur le jeudi**, **Luca le mercredi** ;
- repos interjournalier **12 h** (720 min), mesuré entre jours **travaillés
  consécutifs**, pas entre jours calendaires adjacents ;
- `workEveryNonFixedRestDay = true` : tout jour ouvert qui n'est pas un repos
  fixe est obligatoire. **Un repos fixe prime toujours** — il n'est ni
  disponible, ni obligatoire.

### Rôles

- **au moins 1** ouverture par jour ouvert (plancher, relevé par la demande à
  l'instant d'ouverture) ;
- **exactement 1** fermeture par jour ouvert — verrouiller est la responsabilité
  d'une seule personne ;
- **au plus 2 fermetures par salarié** sur la semaine ;
- **aucune limite individuelle d'ouverture** pour qui que ce soit.

### Formes de shift

- segment minimum **240 minutes** ;
- segment continu maximum **480 minutes** ;
- journée maximum **600 minutes** — atteignable uniquement avec coupure ;
- coupure de **45 à 90 minutes**, **au plus une par jour** ;
- **coupure réservée à Arthur** ; les quatre autres travaillent en continu.

### Couverture

Profil horaire de tête de créneau, 06:00 → 20:00 :

| Jour | Profil |
|---|---|
| lundi → jeudi | `2 2 1 1 3 3 1 1 1 1 2 1 1 1` |
| vendredi | `2 1 3 1 4 1 1 1 1 1 3 2 1 1` |
| samedi | `4 1 1 1 1 4 1 1 1 1 1 1 1 1` |

La couverture est une question de **présence simultanée**, jamais de
recouvrement par un seul shift : ce qui compte est le nombre de personnes
présentes à l'instant le plus creux de la fenêtre. Trois shifts décalés peuvent
tenir une heure sans qu'aucun ne la couvre seul.

> Aucun plancher incassable (`hardMinimumEmployees`) n'est déclaré sur ce
> problème. Le champ existe au contrat mais n'est pas utilisé par la fixture
> canonique — les règles décidées n'en mentionnent aucun.

---

## 5. État de l'art mesuré

Tous les chiffres ci-dessous portent l'empreinte `p3_f5a81f5b6eacfcff`.

| Moteur | Créneaux sous-couverts | Déficit | Temps | Preuve |
|---|---|---|---|---|
| **Référence Python** | **0** | **0 min** | — | légalité vérifiée par le validateur V3 |
| **TypeScript `v3-decomposed`** | **4** | **195 min** | 13,9 s | `none` — arrêt `state-limit` |

**La cible du port est de reproduire 0 / 0 sur cette empreinte.**

Le moteur TypeScript est légal, déterministe et convergé ; il ne franchit pas
l'écart de 4 créneaux. La cause a été établie par autopsie : la décomposition
fige les rôles d'ouverture et de fermeture avant de placer les horaires et ne
peut plus y revenir. Ce n'est ni un manque de budget — dix fois le budget donne
le même résultat — ni un défaut de sélection des squelettes.

⚠️ Deux chiffres qui ont circulé et qu'il faut **cesser de citer** :

- « CP-SAT : 8 créneaux » — run **interrompu à 120 s**, non convergé, aucune
  preuve, et sur l'empreinte `p3_ad1f4d1ed24c06a2` ;
- « TypeScript : 6 créneaux / 330 min » — mesuré sur la fixture de **migration**
  `drive-problem.ts`, dont les données contredisent trois règles métier.

---

## 6. Fichiers nécessaires au port

### À lire pour reproduire la sémantique — autorité normative

| Fichier | Pourquoi |
|---|---|
| `features/core/planning-v3/types/problem.ts` | modèle du problème : tout est en **minutes entières**, aucune heure décimale ni `"HH:mm"` |
| `features/core/planning-v3/types/solution.ts` | forme d'une solution ; `segments[]` porte les coupures |
| `features/core/planning-v3/types/validation.ts` | codes de règles, sévérités, forme du rapport |
| `features/core/planning-v3/validator/validate-solution.ts` | **la seule autorité de légalité.** Le port doit satisfaire ce fichier, pas le réinterpréter |
| `features/core/planning-v3/validator/fingerprint.ts` | calcul de l'empreinte problème et solution |
| `features/core/shared/coverage.ts` | **couverture atomique** — la définition exacte de « combien de personnes sont présentes ». Le port doit reproduire ce raisonnement ; il ne peut pas importer ce fichier |

### Données

| Fichier | Rôle |
|---|---|
| `experiments/planning-v3-cpsat/fixtures/drive-canonical-problem.json` | l'entrée du solveur |
| `experiments/planning-v3-cpsat/fixtures/drive-canonical-reference-solution.json` | la sortie attendue |
| `features/core/planning-v3/__tests__/drive-canonical.ts` | règles + fixture + planning de référence |
| `features/core/planning-v3/__tests__/drive-canonical.test.ts` | ce que la fixture promet, exécutable |

### Scripts Python existants — point de départ, non nettoyés

| Fichier | Rôle |
|---|---|
| `experiments/planning-v3-cpsat/cpsat_model.py` | modèle du solveur |
| `experiments/planning-v3-cpsat/cpsat_service.py` | service appelé par l'adaptateur TS |
| `experiments/planning-v3-cpsat/cpsat_drive.py` | pilote du scénario Drive |
| `experiments/planning-v3-cpsat/tests/*.py` | parité couverture, diagnostics, propagation des rôles |

### Documentation

| Fichier | Rôle |
|---|---|
| `experiments/planning-v3-cpsat/REFERENCE.md` | dossier de portage : environnement, commandes, critère de succès |
| `docs/architecture/PLANNING_V3_DECOMPOSED.md` | méthode du moteur TS, autopsie, limites, séparation des artefacts |
| `docs/architecture/PLANNING_V3.md` | socle V3 : invariants, frontière d'import, sélecteur de moteur |
| `docs/rules/BUSINESS_RULES.md` | vocabulaire des règles métier |

---

## 7. Bloquant connu

**SciPy n'est pas installé.** Relevé sur la machine de développement :

| Composant | Version | État |
|---|---|---|
| Python | 3.12.10 | ✅ |
| NumPy | 2.5.0 | ✅ |
| OR-Tools | 9.15.6755 | ✅ |
| **SciPy** | — | ❌ absent |
| **HiGHS** via `scipy.optimize.milp` | — | ❌ indisponible |

Les scripts Python présents ciblent **OR-Tools CP-SAT**, et leurs artefacts dans
`expected/` portent l'empreinte antérieure `p3_29f16d47dacffd2b`. Ils ne
reproduisent pas le 0/0 en l'état.

---

## 8. Ordre de marche

1. `python -m pip install scipy`, puis consigner les versions dans `REFERENCE.md`.
2. Faire lire `drive-canonical-problem.json` au spike brut. Pointer le script
   vers un autre fichier est la **seule** modification autorisée avant la
   reproduction — ce n'est pas le réécrire.
3. Obtenir **0 créneau / 0 minute** sur `p3_f5a81f5b6eacfcff`.
4. Faire auditer la sortie par le validateur V3, qui reste la seule autorité.
5. **Alors seulement**, nettoyer et restructurer.

Un écart entre le spike et la référence est une information exploitable. Un
écart entre un spike déjà nettoyé et la référence est une énigme.
