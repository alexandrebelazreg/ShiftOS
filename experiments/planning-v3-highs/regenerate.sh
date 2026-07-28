#!/usr/bin/env bash
# Regenerate every artefact that carries a problem fingerprint.
#
# A solution embeds the fingerprint of the problem it answers, and the validator
# checks that it matches. So when the fingerprint definition changes, every
# committed answer stops being an answer to anything the validator recognises —
# not because the schedule got worse, but because it now names a problem that no
# longer exists under that name. Regenerating is the only honest fix: editing
# the stored fingerprint would make a stale result look current.
#
#     experiments/planning-v3-highs> bash regenerate.sh
set -u

PY="../../.venv-planning-highs/Scripts/python.exe"
export PYTHONIOENCODING=utf-8

echo "── moteur rapide, trois scénarios canoniques ──"
for name in drive-canonical accueil-canonical drive-absences; do
  "$PY" -X utf8 solve_fast.py "fixtures/${name}-problem.json" \
    --output "results/fast-${name}.json" --time-limit 60 >/dev/null 2>&1
  echo "  fast-${name}"
done

echo "── oracle v3-highs-global, mêmes scénarios ──"
"$PY" -X utf8 solve.py fixtures/drive-canonical-problem.json \
  --output results/scenario-drive-canonical.json --time-limit 400 >/dev/null 2>&1
echo "  scenario-drive-canonical"
"$PY" -X utf8 solve.py fixtures/accueil-canonical-problem.json \
  --output results/scenario-accueil-canonical.json --time-limit 300 >/dev/null 2>&1
echo "  scenario-accueil-canonical"
"$PY" -X utf8 solve.py fixtures/drive-absences-problem.json \
  --output results/scenario-drive-absences.json --time-limit 900 >/dev/null 2>&1
echo "  scenario-drive-absences"

echo "── campagne de perturbations, reprise interdite ──"
rm -rf results/perturbations
"$PY" -X utf8 perturbations.py --time-limit 60 --wall-limit 240 \
  2>&1 | tail -3

echo "REGENERATION TERMINEE"
