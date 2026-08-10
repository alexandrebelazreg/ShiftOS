"""La même zone, plusieurs fois : un run ne prouve rien.

Le placement multi-secteur travaille sous limite de temps, donc deux exécutions
du MÊME code donnent des plannings différents. Une mesure prise une fois compare
autant de variance que d'effet — l'expérience en a déjà payé le prix sur les
fixtures mono. Ce module relance N fois et rapporte la médiane et l'étendue.
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path

from shiftos_highs_fast.pipeline import solve_fast
from zone_report import analyse

ROOT = Path(__file__).resolve().parent

KEYS = (
    "referenceDeficitMinutes",
    "avoidableDeficitMinutes",
    "referenceShortSlots",
    "counterMinutesEmpty",
    "counterMinutesSurplus",
)


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "market-zone-problem.json"
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
    runs = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    label = sys.argv[4] if len(sys.argv) > 4 else "-"

    problem = json.loads((ROOT / "fixtures" / name).read_text(encoding="utf-8"))
    rows: list[dict] = []
    for index in range(runs):
        answer = solve_fast(problem, time_limit_seconds=seconds)
        summary = analyse(problem, answer)
        rows.append(summary)
        print(
            f"[{label}] run {index + 1}/{runs} "
            + (
                f"status={summary['status']} reason={summary.get('reason')}"
                if "referenceDeficitMinutes" not in summary
                else " ".join(f"{key}={summary[key]}" for key in KEYS)
            ),
            flush=True,
        )

    solved = [row for row in rows if "referenceDeficitMinutes" in row]
    proven = sum(1 for row in solved if row.get("placementProven"))
    print(f"\n[{label}] {len(solved)}/{runs} avec solution, {proven} placement(s) prouvé(s)")
    for key in KEYS:
        values = [row[key] for row in solved]
        if not values:
            continue
        print(
            f"[{label}] {key:>28} : médiane {statistics.median(values):8.0f}"
            f"   min {min(values):6d}   max {max(values):6d}"
        )


if __name__ == "__main__":
    main()
