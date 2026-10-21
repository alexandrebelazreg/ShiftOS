"""Les rôles d'un jour : ceux de la journée s'il en porte, sinon la règle.

Un férié à un seul volontaire porte `minimumOpenings: 1, exactClosings: 0` :
une personne ne peut pas ouvrir ET fermer. Quatre lecteurs devaient l'entendre
de la même façon — squelette, allocation, évaluateur, ancien solveur. Un seul
oubli suffit : le moteur produit ce que l'évaluateur rejette.
"""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from shiftos_highs.day_roles import day_roles
from shiftos_highs.demand import build_demand_model
from shiftos_highs.evaluate import evaluate
from shiftos_highs.fingerprint import fingerprint_problem
from shiftos_highs_fast.allocation import build_allocation_model
from shiftos_highs_fast.skeleton import generate_skeletons_from_capacity

ROOT = Path(__file__).resolve().parent.parent
HOLIDAY = "2026-07-21"


def _drive() -> dict:
    return json.loads((ROOT / "fixtures" / "drive-canonical-problem.json").read_text(encoding="utf-8"))


def _one_volunteer() -> dict:
    """Le Drive, un mardi où seul Erwan est disponible, rôles du jour posés."""
    problem = _drive()
    for entry in problem["employeeDays"]:
        if entry["date"] == HOLIDAY and entry["employeeId"] != "erwan":
            entry.update(available=False, mandatory=False, maximumMinutes=0)
    for day in problem["days"]:
        if day["date"] == HOLIDAY:
            day.update(minimumOpenings=1, exactClosings=0, budgetMinutes=375)
    problem["demandSlots"] = [
        {key: value for key, value in slot.items() if key != "hardMinimumEmployees"}
        if slot["date"] == HOLIDAY else slot
        for slot in problem["demandSlots"]
    ]
    return problem


class DayRolesTests(unittest.TestCase):
    def test_the_rule_applies_without_a_day_override(self) -> None:
        problem = _drive()
        day = problem["days"][0]
        self.assertEqual(
            day_roles(problem, day),
            (problem["rules"]["minimumOpeningsPerDay"], problem["rules"]["exactClosingsPerDay"]),
        )

    def test_the_day_override_wins(self) -> None:
        problem = _drive()
        self.assertEqual(day_roles(problem, {"minimumOpenings": 1, "exactClosings": 0}), (1, 0))

    def test_the_evaluator_reads_the_day(self) -> None:
        # Personne ne ferme le mardi : interdit d'ordinaire, permis ce jour-là.
        problem = _one_volunteer()
        day = next(d for d in problem["days"] if d["date"] == HOLIDAY)
        assignments = [{
            "employeeId": "erwan", "date": HOLIDAY,
            "segments": [{"startMinutes": day["opensAtMinutes"], "endMinutes": day["opensAtMinutes"] + 375}],
        }]
        mine = [v for v in evaluate(problem, assignments)["violations"] if HOLIDAY in v and "count" in v]
        self.assertEqual(mine, [])

        ordinary = copy.deepcopy(problem)
        for d in ordinary["days"]:
            d.pop("minimumOpenings", None)
            d.pop("exactClosings", None)
        flagged = [v for v in evaluate(ordinary, assignments)["violations"] if v.startswith(f"closing-count:{HOLIDAY}")]
        self.assertEqual(len(flagged), 1)

    def test_the_skeleton_can_staff_a_one_person_day(self) -> None:
        problem = _one_volunteer()
        model = build_allocation_model(problem)
        demand = build_demand_model(problem)
        skeletons = generate_skeletons_from_capacity(problem, model, demand)
        self.assertTrue(skeletons, "aucun squelette pour une journée à un volontaire")
        self.assertEqual(skeletons[0].score[0], 0, "squelette structurellement incomplet")

    def test_the_fingerprint_only_moves_when_a_day_carries_roles(self) -> None:
        plain = _drive()
        self.assertEqual(fingerprint_problem(plain), fingerprint_problem(_drive()))
        marked = _drive()
        marked["days"][1].update(minimumOpenings=1, exactClosings=0)
        self.assertNotEqual(fingerprint_problem(plain), fingerprint_problem(marked))


if __name__ == "__main__":
    unittest.main()
