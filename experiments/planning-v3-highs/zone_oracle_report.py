"""L'oracle contre le moteur : de combien le rapide manque-t-il ?

Le moteur rapide ne revendique jamais d'optimum, et il a raison — deux choix
heuristiques précèdent sa seule étape exacte. Restait à savoir CE QUE ÇA COÛTE.
Ce module pose la même semaine aux deux et met les deux réponses côte à côte.

Trois lectures possibles du résultat, et une seule est une mauvaise nouvelle :

- l'oracle PROUVE l'optimum et le rapide y est : il n'y a rien à gagner ;
- l'oracle prouve mieux : l'écart est le prix exact de l'heuristique, et c'est
  la seule mesure qui dise où porter l'effort ;
- l'oracle ne prouve rien dans son budget : il ne dit alors rien du rapide, et
  son écart borne seulement sa propre ignorance.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from shiftos_highs.oracle_zone import solve_zone_oracle
from shiftos_highs_fast.pipeline import solve_fast

ROOT = Path(__file__).resolve().parent


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "market-zone-problem.json"
    fast_seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
    oracle_seconds = float(sys.argv[3]) if len(sys.argv) > 3 else 600.0

    problem = json.loads((ROOT / "fixtures" / name).read_text(encoding="utf-8"))

    fast = solve_fast(problem, time_limit_seconds=fast_seconds)
    fast_diagnostics = fast.get("diagnostics") or {}
    print(
        f"rapide  : statut {fast['status']}"
        f" | créneaux {fast_diagnostics.get('referenceShortSlots')}"
        f" | déficit {fast_diagnostics.get('referenceDeficitMinutes')} min"
        f" | {round(float(fast_diagnostics.get('totalSeconds') or 0), 1)}s",
        flush=True,
    )

    oracle = solve_zone_oracle(problem, time_limit_seconds=oracle_seconds)
    diagnostics = oracle["diagnostics"]
    print(
        f"oracle  : statut {oracle['status']}"
        f" | créneaux {diagnostics.get('referenceShortSlots')}"
        f" | déficit {diagnostics.get('referenceDeficitMinutes')} min"
        f" | prouvé {diagnostics.get('proven')} écart {diagnostics.get('gap')}"
        f" | {round(float(diagnostics.get('totalSeconds') or 0), 1)}s",
        flush=True,
    )
    print(
        f"modèle  : {diagnostics.get('shiftCandidates')} candidats,"
        f" {diagnostics.get('columns')} colonnes, {diagnostics.get('rows')} lignes",
        flush=True,
    )
    if diagnostics.get("validHardConstraints") is False:
        # Un oracle qui rend un planning illégal n'est pas une référence.
        print(f"REFUSÉ  : {diagnostics.get('violations')}", flush=True)
        return

    fast_deficit = fast_diagnostics.get("referenceDeficitMinutes")
    oracle_deficit = diagnostics.get("referenceDeficitMinutes")
    if fast_deficit is None or oracle_deficit is None:
        return
    if not diagnostics.get("proven"):
        print(
            "L'oracle n'a rien prouvé : il ne dit rien du moteur rapide.",
            flush=True,
        )
        return
    print(
        f"PRIX DE L'HEURISTIQUE : {fast_deficit - oracle_deficit} min"
        f" ({fast_deficit} contre {oracle_deficit} à l'optimum prouvé)",
        flush=True,
    )


if __name__ == "__main__":
    main()
