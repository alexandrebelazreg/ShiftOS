"""La même zone, d'autres contraintes : le moteur tient-il ailleurs ?

Une seule semaine mesurée ne dit rien de la suivante. Ce module dérive de la
zone marché des variantes qui changent CHACUNE UNE SEULE CHOSE, et vérifie sur
chacune les trois propriétés qui font qu'un planning est utilisable :

1. il en sort un — pas de `timeout-without-solution` ;
2. l'évaluateur indépendant accepte ses contraintes dures ;
3. le déficit évitable reste petit devant le déficit total.

Les transformations préservent l'accord entre contrats et budgets journaliers,
sans quoi la semaine deviendrait infaisable pour une raison qui n'a rien à voir
avec ce qu'on veut mesurer.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

from shiftos_highs_fast.pipeline import solve_fast
from zone_report import analyse

ROOT = Path(__file__).resolve().parent


def _no_split(problem: dict) -> dict:
    """Personne ne peut couper sa journée.

    Le plafond quotidien descend au plafond continu : sans coupure, une journée
    ne peut pas durer plus qu'une traite, et laisser 600 minutes de plafond
    quand on n'en tient que 480 d'affilée demanderait au moteur une forme qui
    n'existe pas.
    """
    own = copy.deepcopy(problem)
    own["rules"]["splitShiftAllowed"] = False
    continuous = int(own["rules"]["maximumContinuousMinutes"])
    for employee in own["employees"]:
        employee["canSplitShift"] = False
        employee["maximumDailyMinutes"] = min(employee["maximumDailyMinutes"], continuous)
    for entry in own["employeeDays"]:
        if entry["maximumMinutes"]:
            entry["maximumMinutes"] = min(entry["maximumMinutes"], continuous)
    return own


def _floor_everywhere(problem: dict) -> dict:
    """Un plancher incassable sur tous les comptoirs, aux heures pleines.

    Le chemin des planchers durs est le seul que la nouvelle règle ne touche
    pas ; il faut donc vérifier qu'elle ne l'a pas cassé non plus.
    """
    own = copy.deepcopy(problem)
    for slot in own["demandSlots"]:
        if 9 * 60 <= slot["startMinutes"] and slot["endMinutes"] <= 17 * 60:
            slot["hardMinimumEmployees"] = 1
    return own


def _one_counter_only(problem: dict) -> dict:
    """Chacun n'est autorisé que sur un seul comptoir.

    La contrainte la plus dure qu'une zone puisse porter : plus aucun renfort
    n'est déplaçable, et le moteur doit s'en apercevoir plutôt que d'y perdre
    son budget.
    """
    own = copy.deepcopy(problem)
    for employee in own["employees"]:
        employee["allowedSectorIds"] = employee["allowedSectorIds"][:1]
    return own


def _polyvalent(problem: dict) -> dict:
    """Tout le monde sait tenir tous les comptoirs.

    L'inverse : le moteur profite-t-il de la liberté qu'on lui donne ? Le
    déficit évitable devrait baisser, jamais monter.
    """
    own = copy.deepcopy(problem)
    every = [str(sector["id"]) for sector in own["sectors"]]
    for employee in own["employees"]:
        first = employee["allowedSectorIds"][0]
        employee["allowedSectorIds"] = [first] + [s for s in every if s != first]
    return own


def _late_counters(problem: dict) -> dict:
    """Les comptoirs ferment une heure plus tard, la demande suit.

    Allonge la journée sans toucher aux contrats : la zone manque donc de bras
    davantage, et c'est le régime où l'ancienne cible s'effondrait.
    """
    own = copy.deepcopy(problem)
    for sector in own["sectors"]:
        for sector_day in sector["days"]:
            if not sector_day["closed"]:
                sector_day["closesAtMinutes"] += 60
    latest = max(
        sector_day["closesAtMinutes"]
        for sector in own["sectors"]
        for sector_day in sector["days"]
        if not sector_day["closed"]
    )
    for day in own["days"]:
        day["closesAtMinutes"] = max(day["closesAtMinutes"], latest)
    for entry in own["employeeDays"]:
        entry["latestEndMinutes"] = max(entry["latestEndMinutes"], latest)
    ends: dict[tuple[str, str], int] = {}
    for slot in own["demandSlots"]:
        key = (str(slot["sectorId"]), slot["date"])
        ends[key] = max(ends.get(key, 0), int(slot["endMinutes"]))
    added: list[dict] = []
    for sector in own["sectors"]:
        for sector_day in sector["days"]:
            if sector_day["closed"]:
                continue
            key = (str(sector["id"]), sector_day["date"])
            start = ends.get(key)
            if start is None or start >= sector_day["closesAtMinutes"]:
                continue
            added.append({
                "id": f"req_{sector['id']}_{sector_day['date']}_{start:04d}_tard",
                "sectorId": str(sector["id"]),
                "date": sector_day["date"],
                "startMinutes": start,
                "endMinutes": sector_day["closesAtMinutes"],
                "requiredEmployees": 1,
                "maximumEmployees": None,
            })
    own["demandSlots"].extend(added)
    return own


VARIANTS = {
    "sans-coupure": _no_split,
    "planchers-durs": _floor_everywhere,
    "mono-comptoir": _one_counter_only,
    "polyvalents": _polyvalent,
    "fermeture-tardive": _late_counters,
}


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "market-zone-problem.json"
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
    base = json.loads((ROOT / "fixtures" / name).read_text(encoding="utf-8"))

    for label, transform in [("référence", lambda p: p), *VARIANTS.items()]:
        problem = transform(base)
        answer = solve_fast(problem, time_limit_seconds=seconds)
        summary = analyse(problem, answer)
        if "referenceDeficitMinutes" not in summary:
            print(
                f"{label:>20} : AUCUNE SOLUTION — {summary['status']} / {summary.get('reason')}",
                flush=True,
            )
            continue
        print(
            f"{label:>20} : déficit {summary['referenceDeficitMinutes']:>5}"
            f" dont évitable {summary['avoidableDeficitMinutes']:>5}"
            f" | créneaux {summary['referenceShortSlots']:>3}"
            f" | désert {summary['counterMinutesEmpty']:>5}"
            f" | dur OK {summary['validHardConstraints']}"
            f" | prouvé {summary['placementProven']}"
            f" | {summary['totalSeconds']:>5}s",
            flush=True,
        )


if __name__ == "__main__":
    main()
