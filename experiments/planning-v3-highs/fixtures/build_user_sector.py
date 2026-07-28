"""Reconstruction du secteur décrit par l'utilisateur, pour diagnostic.

Ce que l'utilisateur a donné, et qui est donc EXACT :

- le Drive est ouvert du lundi au samedi, 06:00 → 20:00. Le MAGASIN ferme à
  20:45, mais c'est le secteur qui est planifié ici, pas le magasin — une
  confusion qui avait ajouté trois quarts d'heure à couvrir chaque jour ;
- la grille de demande horaire, 06:00 → 20:00, recopiée telle quelle ci-dessous
  et qui couvre donc exactement la journée d'ouverture ;
- cinq salariés à 36 h 45, soit 2 205 minutes chacun ;
- tout le monde en repos le dimanche ; un de plus le mercredi, un autre le jeudi ;
- celui qui se repose le jeudi peut faire une coupure ;
- une seule fermeture par jour ; celui qui en fait deux n'ouvre jamais, les
  autres en font au plus une.

Ce qui est SUPPOSÉ, faute d'information, et qui peut fausser le diagnostic :

1. les budgets journaliers suivent la répartition collective du document de
   conception : lundi à jeudi 15 %, vendredi 22 %, samedi 18 %, arrondie au pas
   de 15 minutes en conservant le total exact. Ce n'est PAS proportionnel à la
   demande — une première reconstruction l'avait supposé et donnait au vendredi
   285 minutes de moins que la règle réelle ;
2. les règles de durée reprennent celles du secteur Drive canonique — segment
   240 à 480 minutes, journée ≤ 600, repos 12 h, coupure 45 à 90 minutes ;
3. le salarié à deux fermetures travaille du lundi au samedi.

Chacune de ces hypothèses est isolée ici pour pouvoir être corrigée d'un mot.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

WEEK = [
    ("2026-08-03", "monday"),
    ("2026-08-04", "tuesday"),
    ("2026-08-05", "wednesday"),
    ("2026-08-06", "thursday"),
    ("2026-08-07", "friday"),
    ("2026-08-08", "saturday"),
]

OPENS_AT = 6 * 60
CLOSES_AT = 20 * 60
STEP = 15

#: La grille recopiée : une ligne par tranche horaire de 06:00 à 20:00.
DEMAND = {
    "monday":    [2, 2, 2, 2, 3, 3, 1, 1, 1, 2, 2, 1, 1, 1],
    "tuesday":   [2, 2, 2, 2, 3, 3, 1, 1, 1, 2, 2, 1, 1, 1],
    "wednesday": [2, 2, 2, 2, 3, 3, 1, 1, 1, 2, 2, 1, 1, 1],
    "thursday":  [2, 2, 2, 2, 3, 3, 1, 1, 1, 2, 2, 1, 1, 1],
    "friday":    [2, 2, 3, 3, 4, 2, 2, 1, 2, 3, 3, 2, 1, 1],
    "saturday":  [4, 4, 4, 4, 4, 4, 2, 1, 1, 1, 1, 1, 1, 1],
}
#: La répartition collective du budget hebdomadaire entre les jours ouverts.
SHARE = {
    "monday": 15,
    "tuesday": 15,
    "wednesday": 15,
    "thursday": 15,
    "friday": 22,
    "saturday": 18,
}

CONTRACT = 2205

EMPLOYEES = [
    # id,        repos en plus,  ouvre,  fermetures,  coupure
    ("alice",    "wednesday",    True,   1,           False),
    ("bruno",    "thursday",     True,   1,           True),
    ("chloe",    None,           True,   1,           False),
    ("david",    None,           True,   1,           False),
    ("elena",    None,           False,  2,           False),
]


def demand_minutes(weekday: str) -> int:
    hours = DEMAND[weekday]
    return sum(hours) * 60


def build() -> dict:
    total_contracts = CONTRACT * len(EMPLOYEES)

    # Hypothèse 1 : la répartition collective déclarée par le métier.
    weights = [SHARE[weekday] for _date, weekday in WEEK]
    total_weight = sum(weights)
    raw = [total_contracts * weight / total_weight for weight in weights]
    units = [int(value // STEP) for value in raw]
    remainder = (total_contracts // STEP) - sum(units)
    order = sorted(range(len(WEEK)), key=lambda i: (-(raw[i] / STEP - units[i]), i))
    for index in order[:remainder]:
        units[index] += 1
    budgets = [unit * STEP for unit in units]

    days = [
        {
            "date": date,
            "weekDay": weekday,
            "weekKey": "2026-W32",
            "closed": False,
            "opensAtMinutes": OPENS_AT,
            "closesAtMinutes": CLOSES_AT,
            "budgetMinutes": budget,
        }
        for (date, weekday), budget in zip(WEEK, budgets)
    ]

    employees = []
    for identifier, extra_rest, can_open, closings, can_split in EMPLOYEES:
        rests = ["sunday"] + ([extra_rest] if extra_rest else [])
        working = [weekday for _d, weekday in WEEK if weekday not in rests]
        employees.append(
            {
                "id": identifier,
                "firstName": identifier,
                "lastName": "Secteur",
                "contractMinutes": CONTRACT,
                "workingDays": working,
                "fixedRestDays": sorted(rests),
                "minimumDailyMinutes": 240,
                "maximumDailyMinutes": 600,
                "canOpen": can_open,
                "canClose": True,
                "canSplitShift": can_split,
                "maximumOpenings": None,
                "maximumClosings": closings,
                "prefersOpening": False,
                "prefersClosing": False,
            }
        )

    employee_days = []
    for employee in employees:
        for date, weekday in WEEK:
            available = weekday in employee["workingDays"]
            employee_days.append(
                {
                    "employeeId": employee["id"],
                    "date": date,
                    "available": available,
                    "mandatory": available,
                    "fixedRest": not available,
                    "earliestStartMinutes": OPENS_AT,
                    "latestEndMinutes": CLOSES_AT,
                    "maximumMinutes": employee["maximumDailyMinutes"] if available else 0,
                }
            )

    slots = []
    for date, weekday in WEEK:
        for index, required in enumerate(DEMAND[weekday]):
            start = OPENS_AT + index * 60
            slots.append(
                {
                    "id": f"req_{date}_{start:04d}",
                    "date": date,
                    "startMinutes": start,
                    "endMinutes": start + 60,
                    "requiredEmployees": required,
                    "hardMinimumEmployees": 1,
                    "maximumEmployees": None,
                }
            )

    return {
        "version": "planning-problem-v3/1",
        "planningId": "secteur-utilisateur",
        "sectorId": "secteur-utilisateur",
        "period": {"start": WEEK[0][0], "end": WEEK[-1][0]},
        "timeStepMinutes": STEP,
        "employees": employees,
        "days": days,
        "employeeDays": employee_days,
        "demandSlots": slots,
        "rules": {
            "minimumShiftMinutes": 240,
            "maximumShiftMinutes": 600,
            "minimumRestMinutes": 720,
            "maximumConsecutiveWorkedDays": 6,
            "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": True,
            "maximumSplitMinutes": 90,
            "minimumSplitMinutes": 45,
            "maximumContinuousMinutes": 480,
            "maximumSplitsPerDay": None,
            "minimumOpeningsPerDay": 1,
            "exactClosingsPerDay": 1,
        },
        "objectives": ["coverage", "fairness"],
    }


if __name__ == "__main__":
    problem = build()
    path = ROOT / "secteur-utilisateur-problem.json"
    path.write_text(json.dumps(problem, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total_demand = sum(
        slot["requiredEmployees"] * (slot["endMinutes"] - slot["startMinutes"])
        for slot in problem["demandSlots"]
    )
    total_contracts = sum(e["contractMinutes"] for e in problem["employees"])
    print(f"écrit  : {path.name}")
    print(f"contrats  : {total_contracts} min")
    print(f"demande   : {total_demand} min")
    print(f"marge     : {total_contracts - total_demand} min")
    print("budgets   :", [d["budgetMinutes"] for d in problem["days"]])
    print("ouvreurs  :", sum(1 for e in problem["employees"] if e["canOpen"]))
    print(
        "fermetures: capacité",
        sum(e["maximumClosings"] for e in problem["employees"]),
        "pour",
        len(problem["days"]),
        "jours",
    )
