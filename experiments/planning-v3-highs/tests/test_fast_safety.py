"""Safety properties of the fast pipeline's public verdicts."""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from shiftos_highs_fast.allocation import (
    allocation_infeasibility_details,
    build_allocation_model,
    solve_allocation,
)
from shiftos_highs_fast.pipeline import (
    _cross_sector_role_conflicts,
    _sector_role_conflicts,
    solve_fast,
)
from shiftos_highs.demand import build_day_demand

ROOT = Path(__file__).resolve().parents[1]


def _drive() -> dict:
    return json.loads(
        (ROOT / "fixtures/drive-canonical-problem.json").read_text(encoding="utf-8")
    )


def _two_closers() -> dict:
    date = "2026-07-20"
    employees = ["alice", "bob"]
    return {
        "version": "v3.0.0", "planningId": "minimum-closers", "sectorId": "test",
        "period": {"start": date, "end": date}, "timeStepMinutes": 15,
        "employees": [{
            "id": employee_id, "firstName": employee_id, "lastName": "",
            "contractMinutes": 240, "workingDays": ["monday"], "fixedRestDays": [],
            "minimumDailyMinutes": 240, "maximumDailyMinutes": 240,
            "canOpen": True, "canClose": True, "canSplitShift": False,
            "maximumOpenings": None, "maximumClosings": None,
            "prefersOpening": False, "prefersClosing": False,
        } for employee_id in employees],
        "days": [{
            "date": date, "weekDay": "monday", "weekKey": "2026-W30",
            "closed": False, "opensAtMinutes": 480, "closesAtMinutes": 720,
            "budgetMinutes": 480,
        }],
        "employeeDays": [{
            "employeeId": employee_id, "date": date, "available": True,
            "mandatory": True, "fixedRest": False, "earliestStartMinutes": 480,
            "latestEndMinutes": 720, "maximumMinutes": 240,
        } for employee_id in employees],
        "demandSlots": [],
        "rules": {
            "minimumShiftMinutes": 240, "maximumShiftMinutes": 240,
            "minimumRestMinutes": 720, "maximumConsecutiveWorkedDays": None,
            "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False, "maximumSplitMinutes": None,
            "minimumSplitMinutes": None, "maximumContinuousMinutes": 240,
            "maximumSplitsPerDay": None, "minimumOpeningsPerDay": 1,
            "exactClosingsPerDay": 1,
        },
        "objectives": ["coverage-deficit"],
    }


def _priority_problem(*, one_employee: bool = False) -> dict:
    """Tiny multi-sector week whose only degrees of freedom are sector ranks."""
    date = "2026-07-20"
    employees = [("alice", ["a", "b"])] if one_employee else [
        ("alice", ["a", "b"]), ("amy", ["a", "b"]),
        ("ben", ["b", "a"]), ("bob", ["b", "a"]),
    ]
    contract = 480 if one_employee else 240
    employee_start = 540 if one_employee else 480
    employee_end = 1020 if one_employee else 960
    closes_at = 1080 if one_employee else 960
    sector_windows = (
        ("a", "Fruits", 480, closes_at), ("b", "Charcuterie", 480, closes_at)
    )
    sectors = [{
        "id": sector_id,
        "name": name,
        "days": [{
            "date": date,
            "closed": False,
            "opensAtMinutes": opens_at,
            "closesAtMinutes": sector_closes_at,
            "minimumOpenings": 0 if one_employee else 1,
            "exactClosings": 0 if one_employee else 1,
        }],
    } for sector_id, name, opens_at, sector_closes_at in sector_windows]
    if one_employee:
        demand = [
            {"id": "a-morning", "sectorId": "a", "date": date, "startMinutes": 540, "endMinutes": 780, "requiredEmployees": 1, "maximumEmployees": None},
            {"id": "b-afternoon", "sectorId": "b", "date": date, "startMinutes": 780, "endMinutes": 1020, "requiredEmployees": 1, "maximumEmployees": None},
        ]
    else:
        demand = [
            {"id": sector_id, "sectorId": sector_id, "date": date, "startMinutes": 480, "endMinutes": 960, "requiredEmployees": 1, "maximumEmployees": None}
            for sector_id in ("a", "b")
        ]
    return {
        "version": "v3.0.0", "planningId": "sector-priority", "sectorId": "a",
        "sectors": sectors,
        "period": {"start": date, "end": date}, "timeStepMinutes": 15,
        "employees": [{
            "id": employee_id, "firstName": employee_id, "lastName": "",
            "contractMinutes": contract, "workingDays": ["monday"], "fixedRestDays": [],
            "minimumDailyMinutes": contract, "maximumDailyMinutes": contract,
            "canOpen": True, "canClose": True, "canSplitShift": False,
            "maximumOpenings": None, "maximumClosings": None,
            "prefersOpening": False, "prefersClosing": False,
            "allowedSectorIds": allowed,
        } for employee_id, allowed in employees],
        "days": [{
            "date": date, "weekDay": "monday", "weekKey": "2026-W30",
            "closed": False, "opensAtMinutes": 480, "closesAtMinutes": closes_at,
            "budgetMinutes": contract * len(employees),
        }],
        "employeeDays": [{
            "employeeId": employee_id, "date": date, "available": True,
            "mandatory": True, "fixedRest": False, "earliestStartMinutes": employee_start,
            "latestEndMinutes": employee_end, "maximumMinutes": contract,
        } for employee_id, _allowed in employees],
        "demandSlots": demand,
        "rules": {
            "minimumShiftMinutes": 240, "maximumShiftMinutes": 480,
            "minimumRestMinutes": 720, "maximumConsecutiveWorkedDays": None,
            "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False, "maximumSplitMinutes": None,
            "minimumSplitMinutes": None, "maximumContinuousMinutes": 480,
            "maximumSplitsPerDay": None, "minimumOpeningsPerDay": 0,
            "exactClosingsPerDay": 0,
        },
        "objectives": ["coverage-deficit", "sector-switches"],
    }


class AllocationVerdictTests(unittest.TestCase):
    def test_missing_sector_opener_is_proven_before_skeleton_search(self) -> None:
        problem = _priority_problem()
        for employee in problem["employees"]:
            employee["allowedSectorIds"] = ["a"]
        # La demande de Charcuterie couvre exactement sa plage d'ouverture, donc
        # elle porte déjà le rôle : le manque devient un DÉFICIT, pas un refus.
        # Pour éprouver le préflight, il faut une plage que la demande laisse
        # découverte — sinon on teste une règle que plus rien n'active.
        problem["demandSlots"] = [
            slot for slot in problem["demandSlots"] if slot["sectorId"] != "b"
        ]

        result = solve_fast(problem, time_limit_seconds=10.0)

        self.assertEqual(result["status"], "infeasible-proven")
        self.assertEqual(
            result["diagnostics"]["reason"], "sector-role-cannot-be-staffed"
        )
        conflicts = result["diagnostics"]["infeasibleSectorRoles"]
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["sectorName"], "Charcuterie")
        self.assertEqual(conflicts[0]["openingCandidateCount"], 0)
        self.assertEqual(conflicts[0]["closingCandidateCount"], 0)
        self.assertLess(result["diagnostics"]["totalSeconds"], 1.0)

    def test_a_role_the_demand_already_carries_becomes_a_deficit(self) -> None:
        """Le pendant : ne jamais refuser une semaine sur une exigence en double.

        Même comptoir, même effectif incapable de l'ouvrir — mais sa demande
        couvre toute sa plage, donc elle porte déjà l'exigence. Le manque doit
        se compter en déficit, jamais faire tomber la semaine.
        """
        problem = _priority_problem()
        for employee in problem["employees"]:
            employee["allowedSectorIds"] = ["a"]

        result = solve_fast(problem, time_limit_seconds=10.0)

        self.assertNotEqual(result["status"], "infeasible-proven")
        self.assertIsNotNone(result["solution"])

    def test_one_employee_cannot_open_and_close_beyond_the_continuous_cap(self) -> None:
        problem = _priority_problem(one_employee=True)
        problem["sectors"] = [{
            "id": "a", "name": "Poisson", "days": [{
                "date": "2026-07-20", "closed": False,
                "opensAtMinutes": 420, "closesAtMinutes": 1080,
                "minimumOpenings": 1, "exactClosings": 1,
            }],
        }]
        employee = problem["employees"][0]
        employee["allowedSectorIds"] = ["a"]
        employee["maximumDailyMinutes"] = 600
        employee["contractMinutes"] = 600
        problem["employeeDays"][0].update({
            "earliestStartMinutes": 420,
            "latestEndMinutes": 1080,
            "maximumMinutes": 600,
        })
        problem["days"][0].update({
            "opensAtMinutes": 420,
            "closesAtMinutes": 1080,
            "budgetMinutes": 600,
        })
        problem["rules"].update({
            "maximumShiftMinutes": 600,
            "maximumContinuousMinutes": 480,
            "splitShiftAllowed": False,
        })

        result = solve_fast(problem, time_limit_seconds=10.0)

        self.assertEqual(result["status"], "infeasible-proven")
        conflicts = result["diagnostics"]["infeasibleSectorRoles"]
        self.assertEqual(len(conflicts), 1)
        self.assertTrue(conflicts[0]["jointRoleConflict"])
        self.assertEqual(conflicts[0]["openingClosingSpanMinutes"], 660)
        self.assertEqual(conflicts[0]["maximumSingleSpanMinutes"], 480)

        problem["employees"][0]["canSplitShift"] = True
        problem["sectors"][0]["splitRules"] = {
            "splitShiftAllowed": True,
            "minimumSplitMinutes": 45,
            "maximumSplitMinutes": 90,
            "maximumSplitsPerDay": 2,
        }
        problem["rules"].update({
            "splitShiftAllowed": True,
            "minimumSplitMinutes": 45,
            "maximumSplitMinutes": 90,
            "maximumSplitsPerDay": 2,
        })

        self.assertEqual(_sector_role_conflicts(problem), [])
        allocation_model = build_allocation_model(problem)
        role_cell = allocation_model.cell(0, 0)
        self.assertIsNotNone(role_cell)
        assert role_cell is not None
        self.assertEqual(role_cell.minimum, 570)
        self.assertTrue(role_cell.mandatory)

    def test_equal_coverage_keeps_each_employee_in_their_first_sector(self) -> None:
        result = solve_fast(_priority_problem(), time_limit_seconds=10.0)

        self.assertEqual(result["status"], "feasible-zero-deficit")
        assignments = {
            item["employeeId"]: [block["sectorId"] for block in item["sectorAssignments"]]
            for item in result["solution"]["assignments"]
        }
        self.assertEqual(assignments, {
            "alice": ["a"], "amy": ["a"], "ben": ["b"], "bob": ["b"],
        })

    def test_cross_sector_sole_duty_explains_the_other_sector_collision(self) -> None:
        problem = _priority_problem()
        problem["employees"] = problem["employees"][:2]
        problem["employees"][0]["allowedSectorIds"] = ["a", "b"]
        problem["employees"][1]["allowedSectorIds"] = ["a"]
        for employee in problem["employees"]:
            employee["contractMinutes"] = 480
            employee["minimumDailyMinutes"] = 240
            employee["maximumDailyMinutes"] = 480
        problem["employeeDays"] = problem["employeeDays"][:2]
        for entry in problem["employeeDays"]:
            entry.update({
                "earliestStartMinutes": 360,
                "latestEndMinutes": 1200,
                "maximumMinutes": 480,
            })
        problem["days"][0]["budgetMinutes"] = 960
        problem["sectors"] = [
            {
                "id": "a", "name": "Charcuterie", "days": [{
                    "date": "2026-07-20", "closed": False,
                    "opensAtMinutes": 480, "closesAtMinutes": 1200,
                    "minimumOpenings": 1, "exactClosings": 1,
                }],
                "splitRules": {"splitShiftAllowed": False},
            },
            {
                "id": "b", "name": "Fromage", "days": [{
                    "date": "2026-07-20", "closed": False,
                    "opensAtMinutes": 360, "closesAtMinutes": 540,
                    "minimumOpenings": 1, "exactClosings": 1,
                }],
                "splitRules": {"splitShiftAllowed": False},
            },
        ]
        problem["days"][0].update({"opensAtMinutes": 360, "closesAtMinutes": 1200})

        self.assertEqual(_sector_role_conflicts(problem), [])
        conflicts = _cross_sector_role_conflicts(problem)

        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["sectorName"], "Charcuterie")
        self.assertEqual(conflicts[0]["conflictingSectorName"], "Fromage")
        self.assertTrue(conflicts[0]["crossSectorConflict"])

    def test_secondary_sector_is_used_when_it_removes_a_real_deficit(self) -> None:
        result = solve_fast(_priority_problem(one_employee=True), time_limit_seconds=10.0)

        self.assertEqual(result["status"], "feasible-zero-deficit")
        blocks = result["solution"]["assignments"][0]["sectorAssignments"]
        self.assertEqual(
            [(block["sectorId"], block["startMinutes"], block["endMinutes"]) for block in blocks],
            [("a", 540, 780), ("b", 780, 1020)],
        )

    def test_closer_count_is_a_blocking_minimum_not_an_exact_ceiling(self) -> None:
        result = solve_fast(_two_closers(), time_limit_seconds=10.0)

        self.assertEqual(result["status"], "feasible-zero-deficit")
        self.assertTrue(result["evaluation"]["validHardConstraints"])
        self.assertEqual(len(result["solution"]["assignments"]), 2)

    def test_flexible_daily_targets_do_not_make_allocation_infeasible(self) -> None:
        problem = _drive()
        open_days = [day for day in problem["days"] if not day["closed"]]
        for day in open_days:
            day["budgetMode"] = "target"
        open_days[0]["budgetMinutes"] = 100_000

        model = build_allocation_model(problem)
        result = solve_allocation(problem, model, time_limit=5.0)

        self.assertIsNotNone(result.allocation)
        allocation = result.allocation
        assert allocation is not None
        employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
        self.assertEqual(
            [sum(row) for row in allocation.minutes],
            [int(employee["contractMinutes"]) for employee in employees],
        )
        self.assertNotEqual(
            sum(row[0] for row in allocation.minutes),
            open_days[0]["budgetMinutes"],
        )

    def test_fast_pipeline_moves_minutes_between_flexible_target_days(self) -> None:
        dates = [("2026-07-20", "monday"), ("2026-07-21", "tuesday")]
        problem = {
            "version": "v3.0.0",
            "planningId": "flexible-days",
            "sectorId": "test",
            "period": {"start": dates[0][0], "end": dates[-1][0]},
            "timeStepMinutes": 15,
            "employees": [{
                "id": "alice", "firstName": "Alice", "lastName": "",
                "contractMinutes": 480, "workingDays": [day for _date, day in dates],
                "fixedRestDays": [], "minimumDailyMinutes": 240,
                "maximumDailyMinutes": 480, "canOpen": True, "canClose": True,
                "canSplitShift": False, "maximumOpenings": None,
                "maximumClosings": None, "prefersOpening": False,
                "prefersClosing": False,
            }],
            "days": [{
                "date": date, "weekDay": day, "weekKey": "2026-W30",
                "closed": False, "opensAtMinutes": 480, "closesAtMinutes": 960,
                "budgetMinutes": 480 if index == 0 else 0,
                "budgetMode": "target",
            } for index, (date, day) in enumerate(dates)],
            "employeeDays": [{
                "employeeId": "alice", "date": date, "available": True,
                "mandatory": True, "fixedRest": False,
                "earliestStartMinutes": 480, "latestEndMinutes": 960,
                "maximumMinutes": 480,
            } for date, _day in dates],
            "demandSlots": [],
            "rules": {
                "minimumShiftMinutes": 240, "maximumShiftMinutes": 480,
                "minimumRestMinutes": 720, "maximumConsecutiveWorkedDays": None,
                "maximumConsecutiveWorkedDaysSource": "derived-fallback",
                "splitShiftAllowed": False, "maximumSplitMinutes": None,
                "minimumSplitMinutes": None, "maximumContinuousMinutes": 480,
                "maximumSplitsPerDay": None, "minimumOpeningsPerDay": 0,
                "exactClosingsPerDay": 0,
            },
            "objectives": ["coverage-deficit"],
        }

        result = solve_fast(problem, time_limit_seconds=10.0)

        self.assertIn(
            result["status"],
            {"optimal", "feasible-time-limit", "feasible-zero-deficit"},
        )
        self.assertTrue(result["evaluation"]["validHardConstraints"])
        worked = sorted(
            sum(segment["endMinutes"] - segment["startMinutes"] for segment in assignment["segments"])
            for assignment in result["solution"]["assignments"]
        )
        self.assertEqual(worked, [240, 240])

    def test_timeout_without_incumbent_is_not_an_infeasibility_proof(self) -> None:
        problem = _drive()
        model = build_allocation_model(problem)

        with patch(
            "shiftos_highs_fast.allocation.milp",
            return_value=SimpleNamespace(x=None, status=1),
        ):
            result = solve_allocation(problem, model, time_limit=0.01)

        self.assertIsNone(result.allocation)
        self.assertFalse(result.proven_infeasible)
        self.assertEqual(result.solver_status, 1)

    def test_highs_infeasible_status_remains_a_proof(self) -> None:
        problem = _drive()
        model = build_allocation_model(problem)

        with patch(
            "shiftos_highs_fast.allocation.milp",
            return_value=SimpleNamespace(x=None, status=2),
        ):
            result = solve_allocation(problem, model, time_limit=0.01)

        self.assertIsNone(result.allocation)
        self.assertTrue(result.proven_infeasible)

    def test_infeasibility_details_name_employee_and_daily_conflicts(self) -> None:
        problem = _drive()
        model = build_allocation_model(problem)
        employee = sorted(problem["employees"], key=lambda item: str(item["id"]))[0]
        employee_index = 0
        maximum = sum(
            cell.maximum for cell in model.cells[employee_index] if cell is not None
        )
        employee["contractMinutes"] = maximum + problem["timeStepMinutes"]

        day = sorted(
            [entry for entry in problem["days"] if not entry["closed"]],
            key=lambda entry: entry["date"],
        )[0]
        day_index = 0
        minimum = sum(
            cell.minimum
            for employee_cells in model.cells
            if (cell := employee_cells[day_index]) is not None
        )
        day["budgetMinutes"] = max(0, minimum - problem["timeStepMinutes"])

        details = allocation_infeasibility_details(problem, model)

        self.assertEqual(
            details["allocationEmployeeConflicts"][0]["reason"],
            "contract-exceeds-available-capacity",
        )
        self.assertEqual(
            details["allocationDayConflicts"][0]["reason"],
            "budget-below-mandatory-minimum",
        )


class OptionalDayTests(unittest.TestCase):
    def test_available_but_optional_day_is_rejected_before_search(self) -> None:
        problem = copy.deepcopy(_drive())
        cell = next(entry for entry in problem["employeeDays"] if entry["available"])
        cell["mandatory"] = False

        result = solve_fast(problem, time_limit_seconds=1.0)

        self.assertEqual(result["status"], "invalid-problem")
        self.assertEqual(
            result["diagnostics"]["reason"],
            "optional-work-days-not-supported",
        )
        self.assertGreaterEqual(result["diagnostics"]["optionalCellCount"], 1)
        self.assertEqual(result["diagnostics"]["proof"], "none")


class StructuralDiagnosticTests(unittest.TestCase):
    def test_flexible_target_above_capacity_is_not_a_structural_failure(self) -> None:
        problem = copy.deepcopy(_drive())
        day = next(entry for entry in problem["days"] if not entry["closed"])
        day["budgetMinutes"] = 100_000
        day["budgetMode"] = "target"

        demand = build_day_demand(problem, day["date"])

        self.assertFalse(demand.structurally_infeasible)
        self.assertIsNone(demand.infeasible_reason)

    def test_daily_capacity_failure_contains_actionable_numbers(self) -> None:
        problem = copy.deepcopy(_drive())
        day = next(entry for entry in problem["days"] if not entry["closed"])
        day["budgetMinutes"] = 100_000

        result = solve_fast(problem, time_limit_seconds=1.0)

        self.assertEqual(result["status"], "infeasible-proven")
        diagnostic = result["diagnostics"]["infeasibleDays"][0]
        self.assertEqual(
            diagnostic["reason"],
            "daily-budget-exceeds-workable-capacity",
        )
        self.assertEqual(diagnostic["budgetMinutes"], 100_000)
        self.assertGreater(diagnostic["workableCapacityMinutes"], 0)
        self.assertEqual(
            diagnostic["missingMinutes"],
            diagnostic["budgetMinutes"] - diagnostic["workableCapacityMinutes"],
        )
        self.assertGreater(diagnostic["availableEmployeeCount"], 0)


if __name__ == "__main__":
    unittest.main()
