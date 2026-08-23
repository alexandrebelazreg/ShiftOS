# Passation Claude Code — intégration du solveur HiGHS

Le dossier contient un solveur déjà exécuté sur la fixture Drive canonique.

## Avant toute intégration

Exécuter :

```bash
cd shiftos-highs-solver
python -m venv .venv
python -m pip install -r requirements.txt
python solve.py fixtures/drive-canonical-problem.json --output results/drive-canonical-highs-result.json --time-limit 45
python -m unittest discover -s tests -v
```

Résultat attendu :

- fingerprint problème `p3_f5a81f5b6eacfcff` ;
- fingerprint solution `s3_e9c6e98a1700d926` dans l'environnement de référence ;
- 0 créneau ;
- 0 minute ;
- aucune violation Python.

Ensuite, installer le test `integration/drive-highs-validation.test.ts` dans la suite Vitest Planiteo et vérifier l'acceptation par le validateur officiel.

## Règle d'intégration

Ne pas réécrire l'algorithme en TypeScript. Intégrer d'abord le CLI comme moteur expérimental distinct, avec :

- entrée/sortie JSON ;
- processus Python isolé ;
- timeout 45 secondes ;
- capture stdout/stderr ;
- validation TypeScript obligatoire ;
- moteur par défaut inchangé ;
- aucune écriture directe en base depuis Python.

## Transparence

Ce paquet reproduit le résultat `0/0` avec SciPy/HiGHS. Il constitue un oracle reproductible. Il n'est pas présenté comme une copie source à source des cellules temporaires utilisées plus tôt dans la conversation.
