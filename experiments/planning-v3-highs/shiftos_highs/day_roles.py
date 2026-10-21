"""Les rôles exigés un jour donné — le pendant de `dayRolesOf` côté TypeScript.

Une journée peut porter ses propres `minimumOpenings` / `exactClosings` : le
constructeur les pose un férié qui laisse moins de volontaires que de rôles
distincts, parce qu'un volontaire seul ne peut pas ouvrir ET fermer. Absents, la
règle de la semaine s'applique.

Tout lecteur des rôles passe par ici. Ils étaient lus à quatre endroits — le
squelette, l'allocation, l'évaluateur, l'ancien solveur — et un correctif à un
seul d'entre eux ne se voit pas : le moteur produit ce que l'évaluateur rejette.
"""

from __future__ import annotations

from typing import Any


def day_roles(problem: dict[str, Any], day: dict[str, Any]) -> tuple[int, int]:
    rules = problem["rules"]
    openings = day.get("minimumOpenings")
    closings = day.get("exactClosings")
    return (
        int(rules["minimumOpeningsPerDay"] if openings is None else openings),
        int(rules["exactClosingsPerDay"] if closings is None else closings),
    )
