"""La limite de coupures par SEMAINE, une règle dure.

Le 17/11/2026, un salarié du Drive avait trois journées coupées dans la même
semaine : la seule limite existante était PAR JOUR, et chacune de ses journées
la respectait. Le gérant a demandé une limite sur la semaine, jamais dépassée —
le moteur laisse plutôt du sous-effectif, et dit lequel de ses réglages bloque
quand la semaine devient impossible.

Le cas éprouvé : le Drive canonique où tout le monde peut couper, la durée
continue ramenée à 6 h. Un contrat de 36 h 45 ne tient plus sans journées
longues, donc coupées — sans limite, certains en ont deux.
"""

from __future__ import annotations

import copy
import json
import unittest
from collections import Counter
from pathlib import Path

from shiftos_highs.evaluate import evaluate
from shiftos_highs_fast.allocation import (
    Allocation,
    build_allocation_model,
    respects_weekly_splits,
    weekly_split_cap,
)
from shiftos_highs_fast.pipeline import solve_fast

ROOT = Path(__file__).resolve().parents[1]


def _splitting_drive() -> dict:
    problem = json.loads((ROOT / "fixtures/drive-canonical-problem.json").read_text())
    for employee in problem["employees"]:
        employee["canSplitShift"] = True
    problem["rules"]["maximumContinuousMinutes"] = 360
    return problem


def _splits(assignments: list[dict]) -> Counter:
    return Counter(
        a["employeeId"] for a in assignments for _ in range(len(a["segments"]) - 1)
    )


class WeeklySplitCapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.problem = _splitting_drive()
        capped = copy.deepcopy(cls.problem)
        capped["rules"]["maximumSplitsPerWeek"] = 2
        cls.capped = capped
        cls.result = solve_fast(capped, time_limit_seconds=10.0)

    def test_absent_means_no_limit(self) -> None:
        self.assertIsNone(weekly_split_cap(self.problem))

    def test_the_schedule_respects_the_weekly_limit(self) -> None:
        self.assertTrue(self.result["status"].startswith("feasible"), self.result["status"])
        assignments = self.result["solution"]["assignments"]
        report = evaluate(self.capped, assignments)
        self.assertTrue(report["validHardConstraints"], report["violations"])
        self.assertTrue(all(count <= 2 for count in _splits(assignments).values()))

    def test_an_impossible_limit_is_proven_and_named(self) -> None:
        # À 1, deux salariés ont besoin de deux journées longues pour faire leur
        # contrat : la semaine n'existe pas, et le diagnostic dit pourquoi.
        problem = copy.deepcopy(self.problem)
        problem["rules"]["maximumSplitsPerWeek"] = 1
        result = solve_fast(problem, time_limit_seconds=10.0)

        self.assertEqual(result["status"], "infeasible-proven")
        conflicts = result["diagnostics"]["allocationEmployeeConflicts"]
        self.assertTrue(conflicts)
        for conflict in conflicts:
            self.assertEqual(conflict["reason"], "contract-needs-more-splits-than-weekly-limit")
            self.assertGreater(conflict["requiredSplitDays"], conflict["weeklySplitCap"])

    def test_the_evaluator_refuses_a_week_over_the_limit(self) -> None:
        # Le même planning, relu sous une limite plus basse : refusé. C'est le
        # contrôle qui protège tout ce qui touche au planning après le moteur.
        assignments = self.result["solution"]["assignments"]
        if max(_splits(assignments).values(), default=0) < 2:
            self.skipTest("le moteur n'a donné deux coupures à personne cette fois")
        stricter = copy.deepcopy(self.problem)
        stricter["rules"]["maximumSplitsPerWeek"] = 1
        report = evaluate(stricter, assignments)
        self.assertFalse(report["validHardConstraints"])
        self.assertTrue(any(v.startswith("weekly-splits:") for v in report["violations"]))

    def test_an_allocation_with_too_many_long_days_is_rejected(self) -> None:
        problem = copy.deepcopy(self.problem)
        problem["rules"]["maximumSplitsPerWeek"] = 1
        model = build_allocation_model(problem)
        long_day = [
            [
                (cell.continuous_maximum + model.step) if cell is not None else 0
                for cell in row
            ]
            for row in model.cells
        ]
        allocation = Allocation(minutes=tuple(tuple(row) for row in long_day), origin="test")
        self.assertFalse(respects_weekly_splits(problem, model, allocation))
        self.assertTrue(respects_weekly_splits(self.problem, model, allocation))


if __name__ == "__main__":
    unittest.main()
