"""Le balayage de contrôle du solveur de congés payés.

    python benchmark.py

POURQUOI IL VIT DANS LE DÉPÔT, ET NON DANS UN RÉPERTOIRE TEMPORAIRE.

Il a été réécrit trois fois, et la troisième a coûté la seule chose qu'un
balayage serve à produire : une COMPARAISON. Le 20 septembre 2026, le pire
temps mesuré était de 54,9 s ; le 21, de 2,4 s — et les deux nombres ne se
comparent pas, parce que le générateur d'instances n'était plus le même. Un
banc d'essai jetable ne mesure qu'une seule chose : lui-même.

Les instances sont SYNTHÉTIQUES, et il faut le dire aussi : trois tailles, trois
tensions, six graines, avec ou sans plafond d'effectif. Elles ne prétendent pas
ressembler aux vœux d'une vraie équipe. Elles servent à répondre à une question
et une seule : une modification du modèle a-t-elle déplacé le PIRE temps ?

Le pire, et non la moyenne : une campagne qui dépasse le budget ne rend rien,
et c'est la seule façon de perdre une réponse.

LE LANCER SEUL. Mesuré le 21 septembre 2026 : le même balayage, sur le même code,
rend 2,3 s au repos et 6,3 s pendant qu'une suite de tests et un build occupent
la machine. Le facteur trois ne vient pas du modèle. Une mesure prise en
concurrence ne dit rien de ce qu'on croit mesurer — et elle est d'autant plus
trompeuse qu'elle a l'air précise.
"""

from __future__ import annotations

import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from paid_leave_solver import main  # noqa: E402

WEEKS = [f"2026-W{number:02d}" for number in range(18, 44)]
SECTORS = [
    {"id": "drive", "name": "Drive"},
    {"id": "caisse", "name": "Caisse"},
    {"id": "accueil", "name": "Accueil"},
]
# Les semaines que tout le monde réclame : c'est là que le modèle travaille.
PEAK = [index for index, _ in enumerate(WEEKS) if 10 <= index <= 19]

SIZES = (22, 40, 60)
SEEDS = range(6)
RATIOS = (0.45, 0.62, 0.7)
CEILINGS = (None, 3)


def build(
    seed: int,
    count: int,
    ratio: float,
    ceiling: int | None,
    closure: list[str],
) -> dict:
    rng = random.Random(seed * 1000 + count)
    employees = []
    for index in range(count):
        sector = SECTORS[index % len(SECTORS)]["id"]
        hours = rng.choice([35.0, 35.0, 30.0, 24.0])
        target = rng.choice([2, 2, 3])
        plans = []
        for rank in (1, 2, 3):
            start = rng.choice(PEAK if rank == 1 else range(len(WEEKS) - target))
            start = min(start, len(WEEKS) - target)
            plans.append(
                {"rank": rank, "weekIds": [WEEKS[start + offset] for offset in range(target)]}
            )
        # La cible se lit sur ce qui reste ATTRIBUABLE, fermeture déduite —
        # comme le fait le contrat côté application.
        open_target = len({w for plan in plans for w in plan["weekIds"]} - set(closure))
        employees.append(
            {
                "id": f"e{index:03d}",
                "name": f"E{index}",
                "sectorId": sector,
                "contractHours": hours,
                "targetWeeks": min(target, open_target),
                # Un couple tous les onze salariés : assez pour que les trois
                # étages de priorité travaillent, pas assez pour dominer.
                "linkedEmployeeId": f"e{index - 1:03d}" if index % 11 == 3 else None,
                "seniorityOrder": count - index,
                "firstChoiceHistory": rng.choice([0, 0, 1, 2]),
                "plans": plans,
                "unavailableWeekIds": [],
            }
        )

    base = {sector["id"]: 0.0 for sector in SECTORS}
    for employee in employees:
        base[employee["sectorId"]] += employee["contractHours"]

    coverage = [
        {
            "sectorId": sector["id"],
            "weekId": week,
            "baseContractHours": base[sector["id"]],
            "minimumHours": round(base[sector["id"]] * ratio, 2),
            "toleratedDeficitHours": round(base[sector["id"]] * 0.05, 2),
            "maximumAbsent": ceiling,
        }
        for sector in SECTORS
        for week in WEEKS
    ]

    return {
        "campaignId": f"sweep-{seed}-{count}",
        "timeoutSeconds": 60,
        "weeks": WEEKS,
        "closureWeekIds": closure,
        "sectors": SECTORS,
        "employees": employees,
        "coverage": coverage,
        "reinforcementPools": [
            {
                "id": "pool",
                "totalHours": 200.0,
                "startWeekId": WEEKS[8],
                "endWeekId": WEEKS[20],
                "scope": "global",
                "sectorId": None,
            }
        ],
    }


def sweep(label: str, closure: list[str]) -> int:
    """Rend le pire temps en millisecondes, et rapporte chaque échec."""
    worst = 0
    optimal = 0
    total = 0
    print(label)
    for count in SIZES:
        for seed in SEEDS:
            for ratio in RATIOS:
                for ceiling in CEILINGS:
                    payload = build(seed, count, ratio, ceiling, closure)
                    started = time.monotonic()
                    response = main(payload)
                    elapsed = round((time.monotonic() - started) * 1000)
                    total += 1
                    worst = max(worst, elapsed)
                    if response["status"] == "optimal":
                        optimal += 1
                    else:
                        print(
                            f"    ECHEC n={count} seed={seed} ratio={ratio} "
                            f"plafond={ceiling} -> {response['status']}"
                        )
        print(f"   {count} salaries : fait")
    print(f"\n  {optimal}/{total} optimal   pire temps {worst} ms\n")
    return worst


if __name__ == "__main__":
    sweep("Sans fermeture : 6 graines x 3 tensions x 3 tailles x (sans / avec plafond)", [])
    sweep("Avec fermeture de deux semaines en plein pic", [WEEKS[14], WEEKS[15]])
