"""Une zone marché réaliste, la seule chose qui manquait pour mesurer.

Toutes les fixtures versionnées de cette expérience sont MONO-secteur. Le chemin
multi-secteur n'était donc mesuré que par les zones jouets des tests — un jour,
trois comptoirs identiques, des salariés interchangeables — qui ne produisent
aucun des arbitrages dont un rayon frais vit : des comptoirs aux horaires
différents, un qui ferme à treize heures, des temps partiels dont le contrat
tient exactement dans leurs jours, et une équipe qui ne suffit pas tout à fait.

Ce qui est délibéré ici, et pourquoi :

- **la demande vaut un peu plus que les contrats** (≈ 14 300 minutes contre
  12 900). Une zone qui a exactement ce qu'il faut ne dit rien : c'est quand il
  manque des bras que le moteur doit choisir OÙ manquer, et c'est ce choix que
  l'on veut voir ;
- **les comptoirs n'ouvrent pas ensemble.** Poisson ferme à 13:00 et n'ouvre pas
  le lundi. Un modèle qui traite la zone comme un seul rayon large ne peut pas
  se tromper là-dessus ; celui-ci le peut, donc il faut le regarder ;
- **chaque salarié ne sert que deux comptoirs**, dans un ordre de préférence.
  C'est la contrainte réelle : personne n'est polyvalent partout, et c'est elle
  qui rend le placement d'un renfort non trivial ;
- **un plancher dur sur Charcuterie seulement.** Un plancher partout rendrait la
  semaine impossible et l'on ne mesurerait plus rien.

Les rôles d'ouverture et de fermeture sont déclarés comme en production, mais la
demande couvre chaque comptoir de bout en bout : `role_implied_by_demand` les
neutralise, exactement comme sur une vraie zone.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEP = 15

WEEK = [
    ("2026-08-03", "monday"),
    ("2026-08-04", "tuesday"),
    ("2026-08-05", "wednesday"),
    ("2026-08-06", "thursday"),
    ("2026-08-07", "friday"),
    ("2026-08-08", "saturday"),
]

#: id, nom, ouverture, fermeture, jours fermés
COUNTERS = [
    ("charcuterie", "Charcuterie", 7 * 60, 19 * 60 + 30, ()),
    ("fromage", "Fromage", 8 * 60, 19 * 60, ()),
    ("poisson", "Poisson", 7 * 60 + 30, 13 * 60, ("monday",)),
    ("traiteur", "Traiteur", 9 * 60, 19 * 60, ()),
]

#: Les renforts que le métier demande, comptoir par comptoir : (jour, de, à).
#: Une deuxième personne, en plus de celle qui tient le comptoir.
PEAKS = {
    "charcuterie": [
        ("friday", 10 * 60, 12 * 60),
        ("saturday", 10 * 60, 12 * 60),
        ("saturday", 16 * 60 + 30, 18 * 60 + 30),
    ],
    "traiteur": [("saturday", 11 * 60, 13 * 60 + 30)],
}

#: Le seul comptoir qu'on ne laisse jamais sans personne, et sa plage.
HARD_FLOOR = ("charcuterie", 8 * 60, 19 * 60)

#: id, contrat, repos en plus du dimanche, comptoirs par préférence, ouvre
EMPLOYEES = [
    ("daniel", 2205, "wednesday", ["charcuterie", "fromage"], True),
    ("aurelie", 2205, "thursday", ["poisson", "charcuterie"], True),
    ("marc", 1800, "tuesday", ["fromage", "traiteur"], True),
    ("sophie", 1800, "monday", ["traiteur", "charcuterie"], True),
    ("luca", 1500, "friday", ["charcuterie", "poisson"], True),
    ("ines", 1200, "wednesday", ["fromage", "traiteur"], False),
    ("karim", 2205, "saturday", ["traiteur", "fromage"], True),
]

OPENS_AT = min(opens for _i, _n, opens, _c, _x in COUNTERS)
CLOSES_AT = max(closes for _i, _n, _o, closes, _x in COUNTERS)

#: Doit rester égal à `rules.maximumContinuousMinutes` ci-dessous : c'est lui
#: qui plafonne la journée de quelqu'un qui ne peut pas couper.
CONTINUOUS_CAP = 480


def _open_counters(weekday: str) -> list[tuple[str, str, int, int, tuple[str, ...]]]:
    return [counter for counter in COUNTERS if weekday not in counter[4]]


def _required(counter_id: str, weekday: str, start: int, end: int) -> int:
    """Combien de personnes ce comptoir demande sur cette tranche."""
    reinforced = any(
        day == weekday and peak_start <= start and end <= peak_end
        for day, peak_start, peak_end in PEAKS.get(counter_id, [])
    )
    return 2 if reinforced else 1


def _slots() -> list[dict]:
    slots: list[dict] = []
    for date, weekday in WEEK:
        for counter_id, _name, opens, closes, _closed in _open_counters(weekday):
            # Une tranche par demi-heure : assez fin pour porter un renfort de
            # deux heures, assez grossier pour rester lisible.
            start = opens
            while start < closes:
                end = min(start + 30, closes)
                floor = (
                    1
                    if counter_id == HARD_FLOOR[0]
                    and HARD_FLOOR[1] <= start
                    and end <= HARD_FLOOR[2]
                    else None
                )
                slots.append(
                    {
                        "id": f"req_{counter_id}_{date}_{start:04d}",
                        "sectorId": counter_id,
                        "date": date,
                        "startMinutes": start,
                        "endMinutes": end,
                        "requiredEmployees": _required(counter_id, weekday, start, end),
                        **({} if floor is None else {"hardMinimumEmployees": floor}),
                        "maximumEmployees": None,
                    }
                )
                start = end
    return slots


def _budgets(total_contracts: int, slots: list[dict]) -> list[int]:
    """Le budget de chaque jour, au prorata de la demande de ce jour.

    Exact, au pas de quinze minutes, et la somme vaut les contrats : c'est ce
    que le modèle attend d'un budget déclaré exact.
    """
    weight = {date: 0 for date, _weekday in WEEK}
    for slot in slots:
        weight[slot["date"]] += slot["requiredEmployees"] * (
            slot["endMinutes"] - slot["startMinutes"]
        )
    total_weight = sum(weight.values())
    raw = [total_contracts * weight[date] / total_weight for date, _w in WEEK]
    units = [int(value // STEP) for value in raw]
    remainder = (total_contracts // STEP) - sum(units)
    order = sorted(range(len(WEEK)), key=lambda i: (-(raw[i] / STEP - units[i]), i))
    for index in order[:remainder]:
        units[index] += 1
    return [unit * STEP for unit in units]


def build(extra_contract_minutes: int = 0) -> dict:
    """La semaine. `extra_contract_minutes` la dote de bras en plus.

    La variante dotée existe pour une question précise : quand l'arithmétique
    n'interdit plus le zéro, le moteur l'atteint-il ? Tant que la demande
    dépasse les contrats, tout déficit se confond avec le manque structurel et
    l'on ne mesure plus la qualité du moteur mais celle de l'effectif.

    Les minutes sont ajoutées au SALARIÉ LE MOINS CHARGÉ à chaque tour, par pas
    de quinze minutes, et jamais au-delà de ce que ses jours travaillés peuvent
    porter. Répartir ainsi plutôt que d'embaucher garde la même équipe, les
    mêmes autorisations de comptoir et les mêmes jours de repos : la seule chose
    qui change est le volume, ce qui est exactement la variable de la question.
    """
    slots = _slots()

    employees = []
    for identifier, contract, extra_rest, counters, can_open in EMPLOYEES:
        rests = sorted({"sunday", extra_rest})
        working = [weekday for _d, weekday in WEEK if weekday not in rests]
        employees.append(
            {
                "id": identifier,
                "firstName": identifier.capitalize(),
                "lastName": "Marché",
                "contractMinutes": contract,
                "workingDays": working,
                "fixedRestDays": rests,
                "minimumDailyMinutes": 240,
                "maximumDailyMinutes": 600,
                "canOpen": can_open,
                "canClose": True,
                "canSplitShift": identifier in {"daniel", "marc", "karim"},
                "maximumOpenings": None,
                "maximumClosings": None,
                "prefersOpening": False,
                "prefersClosing": False,
                "allowedSectorIds": counters,
            }
        )

    # ── Ce que les jours peuvent réellement porter ──────────────────────────
    #
    # Les budgets journaliers sont EXACTS et proportionnels à la demande du
    # jour : gonfler les contrats gonfle chaque budget, et le premier qui
    # dépasse ce que son équipe peut travailler rend la semaine impossible —
    # pour une raison arithmétique qui n'apprend rien sur le moteur. Mesuré :
    # +15 % poussait le samedi à 3 135 minutes contre 3 120 disponibles, et
    # l'expérience ne mesurait plus qu'un plafond de constructeur.
    #
    # La capacité d'un salarié n'est pas son maximum quotidien : qui ne peut pas
    # couper ne tient qu'une seule traite, donc son plafond continu.
    capacity_by_day = {
        date: sum(
            min(
                employee["maximumDailyMinutes"],
                CONTINUOUS_CAP if not employee["canSplitShift"] else 10**6,
            )
            for employee in employees
            if weekday in employee["workingDays"]
        )
        for date, weekday in WEEK
    }
    weight = {date: 0 for date, _weekday in WEEK}
    for slot in slots:
        weight[slot["date"]] += slot["requiredEmployees"] * (
            slot["endMinutes"] - slot["startMinutes"]
        )
    total_weight = sum(weight.values())
    ceiling = min(
        capacity_by_day[date] * total_weight // weight[date]
        for date, _weekday in WEEK
        if weight[date] > 0
    )
    base_contracts = sum(employee["contractMinutes"] for employee in employees)
    remaining = min(extra_contract_minutes, max(0, ceiling - base_contracts))
    while remaining >= STEP:
        # Le moins chargé d'abord, en proportion de ce que ses jours peuvent
        # porter : ajouter au plus chargé le pousserait au plafond quotidien et
        # rendrait la semaine infaisable au lieu de la doter.
        candidates = [
            employee
            for employee in employees
            if employee["contractMinutes"] + STEP
            <= len(employee["workingDays"]) * employee["maximumDailyMinutes"]
        ]
        if not candidates:
            break
        target = min(
            candidates,
            key=lambda item: (
                item["contractMinutes"] / len(item["workingDays"]),
                item["id"],
            ),
        )
        target["contractMinutes"] += STEP
        remaining -= STEP

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

    total_contracts = sum(employee["contractMinutes"] for employee in employees)
    budgets = _budgets(total_contracts, slots)

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

    sectors = [
        {
            "id": counter_id,
            "name": name,
            "days": [
                {
                    "date": date,
                    "closed": weekday in closed_days,
                    "opensAtMinutes": opens,
                    "closesAtMinutes": closes,
                    "minimumOpenings": 0 if weekday in closed_days else 1,
                    "exactClosings": 0 if weekday in closed_days else 1,
                }
                for date, weekday in WEEK
            ],
        }
        for counter_id, name, opens, closes, closed_days in COUNTERS
    ]

    return {
        "version": "planning-problem-v3/1",
        "planningId": "zone-marche",
        "sectorId": COUNTERS[0][0],
        "sectors": sectors,
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
            "maximumSplitsPerDay": 1,
            "minimumOpeningsPerDay": 1,
            "exactClosingsPerDay": 1,
            "closingFairness": None,
        },
        "objectives": ["coverage-deficit", "contract-deviation"],
    }


def _describe(problem: dict, name: str) -> None:
    demand = sum(
        slot["requiredEmployees"] * (slot["endMinutes"] - slot["startMinutes"])
        for slot in problem["demandSlots"]
    )
    contracts = sum(employee["contractMinutes"] for employee in problem["employees"])
    print(f"écrit     : {name}")
    print(f"comptoirs : {len(problem['sectors'])}")
    print(f"contrats  : {contracts} min")
    print(f"demande   : {demand} min")
    print(f"manque    : {demand - contracts} min ({100 * contracts / demand:.0f} % couvrable)")
    print("budgets   :", [day["budgetMinutes"] for day in problem["days"]])
    print()


if __name__ == "__main__":
    problem = build()
    path = ROOT / "market-zone-problem.json"
    path.write_text(json.dumps(problem, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _describe(problem, path.name)

    # La même semaine, dotée de ce qui lui manque exactement. Zéro y devient
    # arithmétiquement possible ; reste à savoir s'il y est atteignable.
    shortfall = sum(
        slot["requiredEmployees"] * (slot["endMinutes"] - slot["startMinutes"])
        for slot in problem["demandSlots"]
    ) - sum(employee["contractMinutes"] for employee in problem["employees"])
    staffed = build(extra_contract_minutes=shortfall)
    staffed["planningId"] = "zone-marche-dotee"
    path = ROOT / "market-zone-staffed-problem.json"
    path.write_text(json.dumps(staffed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _describe(staffed, path.name)

    # ── La même semaine avec DU MOU ─────────────────────────────────────────
    #
    # La variante dotée à l'exact ne départage rien : contrats égaux à la
    # demande, chaque minute travaillée doit tomber pile sur une cellule
    # réclamée, aucun comptoir jamais en surnombre. Un tel recouvrement exact
    # peut être impossible pour des raisons qui ne regardent pas le moteur — un
    # shift dure au moins quatre heures, un comptoir s'ouvre d'un bloc. Y lire un
    # déficit ne dit donc pas si c'est la semaine ou le moteur qui bute.
    #
    # Avec quinze pour cent de marge, zéro cesse d'être un équilibre sur le fil.
    # Un déficit ICI n'a plus d'excuse arithmétique.
    demand_total = sum(
        slot["requiredEmployees"] * (slot["endMinutes"] - slot["startMinutes"])
        for slot in problem["demandSlots"]
    )
    slack = build(extra_contract_minutes=shortfall + (demand_total * 15) // 100)
    slack["planningId"] = "zone-marche-avec-marge"
    path = ROOT / "market-zone-slack-problem.json"
    path.write_text(json.dumps(slack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _describe(slack, path.name)
