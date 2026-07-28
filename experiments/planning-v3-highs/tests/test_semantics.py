"""Coverage semantics — the three required cases.

The correction these tests exist to protect: ``requiredEmployees`` is a TARGET
and ``hardMinimumEmployees`` is a FLOOR. Confusing the two makes a solver answer
"impossible" to a week the shop can perfectly well open — which is the single
most expensive kind of wrong answer a planning engine can give.

Each fixture is the smallest problem that isolates one case. The schedules they
produce are also handed to the official TypeScript validator, by
``features/core/planning-v3/__tests__/highs-semantics.test.ts``, which reads the
JSON these tests write.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from shiftos_highs import solve

STEP = 15
DATE = "2026-07-20"
OPENS = 360  # 06:00
CLOSES = 720  # 12:00
SHIFT = 240  # four hours, the shortest legal day
#: The demand window sits INSIDE the opening window on purpose.
#:
#: A slot spanning the whole day would force every shift onto both boundaries,
#: and the role rules — "exactly N people end at closing" — would then decide
#: feasibility instead of coverage. Leaving two spare hours at the end gives
#: each shift somewhere to go, so these fixtures test what they claim to test.
DEMAND_START = OPENS
DEMAND_END = OPENS + SHIFT  # 10:00
OUTPUT = Path(__file__).resolve().parent.parent / "results"


def tiny_problem(
    *,
    employee_ids: list[str],
    required: int,
    hard: int | None,
    budget: int,
) -> dict:
    """A six-hour opening window with a four-hour demand slot at its start.

    Every employee works exactly one four-hour shift, so the only thing the
    solver decides is WHERE each shift sits — and therefore how many people are
    present during the demand window. That is precisely what the coverage
    semantics is about, and nothing else in the fixture competes for the answer.
    """
    span = SHIFT
    return {
        "version": "v3.0.0",
        "planningId": "semantics",
        "sectorId": "semantics",
        "period": {"start": DATE, "end": DATE},
        "timeStepMinutes": STEP,
        "employees": [
            {
                "id": employee_id,
                "firstName": employee_id,
                "lastName": "",
                "contractMinutes": span,
                "workingDays": ["monday"],
                "fixedRestDays": [],
                "minimumDailyMinutes": span,
                "maximumDailyMinutes": span,
                "canOpen": True,
                "canClose": True,
                "canSplitShift": False,
                "maximumOpenings": None,
                "maximumClosings": None,
                "prefersOpening": False,
                "prefersClosing": False,
            }
            for employee_id in employee_ids
        ],
        "days": [
            {
                "date": DATE,
                "weekDay": "monday",
                "weekKey": "2026-W30",
                "closed": False,
                "opensAtMinutes": OPENS,
                "closesAtMinutes": CLOSES,
                "budgetMinutes": budget,
            }
        ],
        "employeeDays": [
            {
                "employeeId": employee_id,
                "date": DATE,
                "available": True,
                "mandatory": True,
                "fixedRest": False,
                "earliestStartMinutes": OPENS,
                "latestEndMinutes": CLOSES,
                "maximumMinutes": span,
            }
            for employee_id in employee_ids
        ],
        "demandSlots": [
            {
                "id": "slot",
                "date": DATE,
                "startMinutes": DEMAND_START,
                "endMinutes": DEMAND_END,
                "requiredEmployees": required,
                "maximumEmployees": None,
                **({} if hard is None else {"hardMinimumEmployees": hard}),
            }
        ],
        "rules": {
            "minimumShiftMinutes": span,
            "maximumShiftMinutes": span,
            "minimumRestMinutes": 720,
            "maximumConsecutiveWorkedDays": None,
            "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False,
            "maximumSplitMinutes": None,
            "minimumSplitMinutes": None,
            "maximumContinuousMinutes": span,
            "maximumSplitsPerDay": None,
            # Aucun rôle imposé : ces fixtures isolent la SÉMANTIQUE DE
            # COUVERTURE. Tout le monde travaille la fenêtre entière, donc
            # exiger exactement un fermeur rendrait le problème infaisable pour
            # une raison qui n'a rien à voir avec ce qui est testé ici.
            "minimumOpeningsPerDay": 0,
            "exactClosingsPerDay": 0,
        },
        "objectives": ["coverage-deficit"],
    }


def _write(name: str, payload: dict) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / f"semantics-{name}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


class CaseAZeroDeficit(unittest.TestCase):
    """Cas A — cible atteignable : zéro déficit."""

    def test_reaches_the_target_with_no_deficit(self) -> None:
        # 3 salariés, cible 3, plancher 1. Le budget permet les trois présences.
        problem = tiny_problem(
            employee_ids=["a", "b", "c"], required=3, hard=1, budget=3 * SHIFT
        )
        result = solve(problem, time_limit_seconds=60)
        _write("case-a", result)

        self.assertEqual(result["status"], "optimal")
        self.assertTrue(result["evaluation"]["validHardConstraints"])
        self.assertEqual(result["evaluation"]["underCoveredSlots"], 0)
        self.assertEqual(result["evaluation"]["totalDeficitMinutes"], 0)
        self.assertEqual(result["diagnostics"]["adaptedTargetShortSlots"], 0)
        self.assertEqual(result["diagnostics"]["adaptedTargetDeficitMinutes"], 0)


class CaseBSoftTargetImpossible(unittest.TestCase):
    """Cas B — cible souple impossible, plancher dur faisable."""

    def test_returns_a_legal_schedule_with_an_explicit_deficit(self) -> None:
        # Seulement 2 salariés disponibles, cible 3, plancher 1.
        # Le solveur NE DOIT PAS répondre infeasible.
        problem = tiny_problem(
            employee_ids=["a", "b"], required=3, hard=1, budget=2 * SHIFT
        )
        result = solve(problem, time_limit_seconds=60)
        _write("case-b", result)

        self.assertIn(result["status"], {"optimal", "feasible-time-limit"})
        self.assertNotEqual(result["status"], "infeasible-proven")
        self.assertIsNotNone(result["solution"])

        # Un planning légal : aucune contrainte dure enfreinte.
        self.assertTrue(result["evaluation"]["validHardConstraints"])
        self.assertEqual(result["evaluation"]["violations"], [])

        # Le plancher dur est tenu : au moins une personne à chaque instant.
        self.assertEqual(len(result["solution"]["assignments"]), 2)

        # Et le manque est MESURÉ, pas caché. La cible adaptée descend à 2 —
        # le budget ne permet pas la troisième présence — donc le déficit
        # résiduel contre la cible adaptée est nul, tandis que le validateur
        # officiel, qui compare à la demande de référence, en signale un.
        self.assertEqual(result["diagnostics"]["adaptedTargetDeficitMinutes"], 0)
        self.assertEqual(result["evaluation"]["underCoveredSlots"], 1)
        self.assertGreater(result["evaluation"]["totalDeficitMinutes"], 0)

    def test_deficit_is_reported_against_the_adapted_target_when_the_budget_allows_more(
        self,
    ) -> None:
        # Trois salariés existent et le budget les couvre, mais un seul créneau
        # les veut tous : ici la cible adaptée vaut bien 3 et tout manque
        # remonterait dans le déficit du modèle.
        problem = tiny_problem(
            employee_ids=["a", "b", "c"], required=3, hard=1, budget=3 * SHIFT
        )
        result = solve(problem, time_limit_seconds=60)
        self.assertEqual(result["diagnostics"]["adaptedTargetShortSlots"], 0)


class CaseCHardFloorImpossible(unittest.TestCase):
    """Cas C — plancher dur impossible."""

    def test_is_infeasible_and_returns_no_degraded_schedule(self) -> None:
        # Aucun salarié disponible, plancher 1.
        problem = tiny_problem(employee_ids=[], required=1, hard=1, budget=0)
        result = solve(problem, time_limit_seconds=60)
        _write("case-c", result)

        self.assertEqual(result["status"], "infeasible-proven")
        self.assertIsNone(result["solution"])
        # Surtout : pas de fausse solution dégradée.
        self.assertNotIn("evaluation", result)

    def test_capacity_below_the_floor_is_infeasible_even_with_employees(self) -> None:
        # Un salarié, mais un plancher de 2 sur toute la fenêtre.
        problem = tiny_problem(
            employee_ids=["a"], required=2, hard=2, budget=SHIFT
        )
        result = solve(problem, time_limit_seconds=60)

        self.assertEqual(result["status"], "infeasible-proven")
        self.assertIsNone(result["solution"])
        self.assertEqual(result["diagnostics"]["proof"], "structural")


class StatusVocabularyTests(unittest.TestCase):
    def test_absent_hard_minimum_never_makes_a_problem_infeasible(self) -> None:
        # Sans plancher déclaré, une cible inatteignable reste une dégradation.
        problem = tiny_problem(
            employee_ids=["a"], required=5, hard=None, budget=SHIFT
        )
        result = solve(problem, time_limit_seconds=60)

        self.assertIn(result["status"], {"optimal", "feasible-time-limit"})
        self.assertTrue(result["evaluation"]["validHardConstraints"])


if __name__ == "__main__":
    unittest.main()
