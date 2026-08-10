"""Ce qu'une zone marché a vraiment produit, comptoir par quart d'heure.

`referenceShortSlots` compte les créneaux manqués et s'arrête là. Il ne dit pas
la seule chose qu'un chef de rayon voit en ouvrant le planning : deux personnes
au même comptoir à l'heure où le comptoir d'à côté n'a personne.

Ce module nomme cette situation et la compte. Un instant est un GASPILLAGE quand,
au même moment, un comptoir porte plus de monde que sa demande n'en réclame et
qu'un autre comptoir ouvert, qui en réclame, n'a personne. C'est la seule forme
de doublon qui soit reprochable : deux personnes sur un comptoir qui en demande
deux ne sont pas un doublon, et deux personnes pendant qu'il ne manque personne
ailleurs non plus.

Mesure, pas test : à lancer avant et après un changement, et à diffuser.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from shiftos_highs.demand import build_demand_model
from shiftos_highs_fast.placement import opening_priority_cells
from shiftos_highs.evaluate import evaluate
from shiftos_highs_fast.pipeline import solve_fast

ROOT = Path(__file__).resolve().parent


def clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def presence_by_cell(
    assignments: list[dict], step: int
) -> dict[tuple[str, str, int], int]:
    """`{(comptoir, date, début): nombre de présents}`."""
    present: dict[tuple[str, str, int], int] = {}
    for assignment in assignments:
        for block in assignment.get("sectorAssignments") or []:
            for start in range(int(block["startMinutes"]), int(block["endMinutes"]), step):
                key = (str(block["sectorId"]), assignment["date"], start)
                present[key] = present.get(key, 0) + 1
    return present


def reference_by_cell(problem: dict) -> dict[tuple[str, str, int], int]:
    step = int(problem["timeStepMinutes"])
    required: dict[tuple[str, str, int], int] = {}
    for slot in problem["demandSlots"]:
        sector_id = str(slot.get("sectorId") or problem["sectorId"])
        for start in range(int(slot["startMinutes"]), int(slot["endMinutes"]), step):
            key = (sector_id, slot["date"], start)
            required[key] = max(required.get(key, 0), int(slot["requiredEmployees"]))
    return required


def analyse(problem: dict, answer: dict) -> dict:
    step = int(problem["timeStepMinutes"])
    solution = answer.get("solution")
    if solution is None:
        return {"status": answer["status"], "reason": (answer.get("diagnostics") or {}).get("reason")}

    assignments = list(solution["assignments"])
    present = presence_by_cell(assignments, step)
    required = reference_by_cell(problem)
    demand = build_demand_model(problem)
    adapted = {
        (cell.sector_id, date, cell.start): cell.adapted_target
        for date, day in demand.days.items()
        for cell in day.sector_intervals
    }

    instants: dict[tuple[str, int], list[str]] = {}
    for sector_id, date, start in required:
        instants.setdefault((date, start), []).append(sector_id)

    wasted_units = 0
    empty_units = 0
    surplus_units = 0
    wasted_instants: list[tuple[str, int, list[str], list[str]]] = []
    for (date, start), sectors in sorted(instants.items()):
        crowded = [
            sector_id
            for sector_id in sectors
            if present.get((sector_id, date, start), 0)
            > required[(sector_id, date, start)]
        ]
        empty = [
            sector_id
            for sector_id in sectors
            if present.get((sector_id, date, start), 0) == 0
            and required[(sector_id, date, start)] >= 1
        ]
        surplus_units += sum(
            present.get((sector_id, date, start), 0) - required[(sector_id, date, start)]
            for sector_id in crowded
        )
        empty_units += len(empty)
        if crowded and empty:
            movable = min(
                sum(
                    present.get((sector_id, date, start), 0)
                    - required[(sector_id, date, start)]
                    for sector_id in crowded
                ),
                len(empty),
            )
            wasted_units += movable
            wasted_instants.append((date, start, sorted(crowded), sorted(empty)))

    # Ce qu'aucun planning ne pouvait servir : la demande du jour moins ce que
    # le jour peut placer. La différence avec le déficit constaté est la seule
    # part que le moteur pouvait gagner — et elle vaut exactement le surplus,
    # puisque la présence totale est fixée par l'allocation.
    unavoidable = 0
    for date, day in demand.days.items():
        day_reference = sum(cell.reference_required for cell in day.sector_intervals) * step
        unavoidable += max(0, day_reference - day.available_worked_minutes)

    # Les minutes désertes DE LA PREMIÈRE HEURE d'un comptoir, comptées à part.
    #
    # Un comptoir qui ouvre en retard se voit ; un creux de quinze heures
    # beaucoup moins. Noyées dans le total, ces minutes-là étaient invisibles —
    # et ce qu'on ne mesure pas, on ne l'améliore pas.
    opening_empty = 0
    for sector_id, date, start in opening_priority_cells(problem):
        if required.get((sector_id, date, start), 0) >= 1 and not present.get(
            (sector_id, date, start), 0
        ):
            opening_empty += step

    report = evaluate(problem, assignments)
    diagnostics = answer.get("diagnostics") or {}
    return {
        "status": answer["status"],
        "referenceShortSlots": diagnostics.get("referenceShortSlots"),
        "referenceDeficitMinutes": diagnostics.get("referenceDeficitMinutes"),
        "adaptedTargetShortSlots": diagnostics.get("adaptedTargetShortSlots"),
        "adaptedTargetDeficitMinutes": diagnostics.get("adaptedTargetDeficitMinutes"),
        "placementProven": diagnostics.get("placementProven"),
        "validHardConstraints": report["validHardConstraints"],
        "violations": report["violations"][:5],
        "totalSeconds": round(float(diagnostics.get("totalSeconds") or 0.0), 1),
        # Les chiffres qui décrivent le symptôme.
        "counterMinutesEmpty": empty_units * step,
        "openingMinutesEmpty": opening_empty,
        "counterMinutesSurplus": surplus_units * step,
        "wastedMinutes": wasted_units * step,
        "unavoidableDeficitMinutes": unavoidable,
        "avoidableDeficitMinutes": int(report["totalDeficitMinutes"]) - unavoidable,
        "wastedInstants": [
            {
                "date": date,
                "at": clock(start),
                "crowded": crowded,
                "empty": empty,
            }
            for date, start, crowded, empty in wasted_instants[:25]
        ],
        "adaptedTargetTotalMinutes": sum(adapted.values()) * step,
    }


def grid(problem: dict, answer: dict, date: str) -> str:
    """La journée telle qu'un chef de rayon la lit : présents / demandés."""
    step = int(problem["timeStepMinutes"])
    present = presence_by_cell(list(answer["solution"]["assignments"]), step)
    required = reference_by_cell(problem)
    sectors = [str(sector["id"]) for sector in problem["sectors"]]
    starts = sorted({start for (_s, own_date, start) in required if own_date == date})
    lines = [f"— {date} —", "heure  " + " ".join(f"{s[:6]:>8}" for s in sectors)]
    for start in starts:
        cells = []
        for sector_id in sectors:
            key = (sector_id, date, start)
            if key not in required:
                cells.append(f"{'·':>8}")
                continue
            cells.append(f"{present.get(key, 0)}/{required[key]:<6}".rjust(8))
        lines.append(f"{clock(start)}  " + " ".join(cells))
    return "\n".join(lines)


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "market-zone-problem.json"
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
    show_grid = "--grid" in sys.argv

    problem = json.loads((ROOT / "fixtures" / name).read_text(encoding="utf-8"))
    answer = solve_fast(problem, time_limit_seconds=seconds)
    summary = analyse(problem, answer)
    print(json.dumps(summary, indent=1, ensure_ascii=False, sort_keys=True))
    if show_grid and answer.get("solution") is not None:
        for day in problem["days"]:
            if not day["closed"]:
                print()
                print(grid(problem, answer, day["date"]))


if __name__ == "__main__":
    main()
