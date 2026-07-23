"""Fast, solver-free tests for the necessary-feasibility diagnostics.

These are the checks that turn a 120-second wait ending in "no solution" into an
immediate, precise refusal. They run in milliseconds because they never build a
CP-SAT model — they read the same candidate domains `build_model` would, and
report the arithmetic impossibilities that make a search pointless.

    python -m pytest experiments/planning-v3-cpsat/tests/test_feasibility_diagnostics.py

Every assertion below is about a NECESSARY condition: a violation is a proof the
week cannot be staffed. The suite also pins the other direction — the real Drive
week, which is feasible, must raise nothing — because a check that cried wolf on
a solvable week would be worse than no check at all.
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cpsat_model import necessary_feasibility_diagnostics  # noqa: E402

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "fixtures", "drive-problem.json",
)


def codes(problem):
    return {item["code"] for item in necessary_feasibility_diagnostics(problem)}


def minimal_problem():
    """One employee, two open days, everything reachable. A clean baseline the
    individual tests perturb one field at a time."""
    return {
        "version": "v3.0.0", "planningId": "t", "sectorId": "s",
        "period": {"start": "2026-07-20", "end": "2026-07-21"},
        "timeStepMinutes": 15,
        "objectives": [],
        "rules": {
            "minimumShiftMinutes": 240, "maximumShiftMinutes": 600,
            "minimumRestMinutes": 720, "maximumConsecutiveWorkedDays": 2,
            "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False, "maximumSplitMinutes": None,
            "minimumOpeningsPerDay": 1, "exactClosingsPerDay": 1,
        },
        "employees": [{
            "id": "e1", "contractMinutes": 480,
            "workingDays": ["monday", "tuesday"], "fixedRestDays": [],
            "canOpen": True, "canClose": True,
            "maximumOpenings": None, "maximumClosings": None,
        }],
        "days": [
            {"date": "2026-07-20", "weekDay": "monday", "weekKey": "2026-W30",
             "closed": False, "opensAtMinutes": 480, "closesAtMinutes": 960, "budgetMinutes": 240},
            {"date": "2026-07-21", "weekDay": "tuesday", "weekKey": "2026-W30",
             "closed": False, "opensAtMinutes": 480, "closesAtMinutes": 960, "budgetMinutes": 240},
        ],
        "employeeDays": [
            {"employeeId": "e1", "date": "2026-07-20", "available": True, "mandatory": True,
             "earliestStartMinutes": 480, "latestEndMinutes": 960, "maximumMinutes": 480},
            {"employeeId": "e1", "date": "2026-07-21", "available": True, "mandatory": True,
             "earliestStartMinutes": 480, "latestEndMinutes": 960, "maximumMinutes": 480},
        ],
        "demandSlots": [],
    }


def test_clean_minimal_problem_has_no_diagnostics():
    assert necessary_feasibility_diagnostics(minimal_problem()) == []


def test_real_drive_week_raises_nothing():
    # The load-bearing no-false-positive test: the spike proved this week
    # feasible, so no necessary condition may flag it.
    problem = json.load(open(FIXTURE, encoding="utf-8"))
    assert necessary_feasibility_diagnostics(problem) == []


def test_mandatory_day_with_empty_domain_is_detected():
    # Window shorter than the minimum shift: no legal candidate, yet the day is
    # mandatory. This is the "empty domain" the search would otherwise chase.
    problem = minimal_problem()
    problem["days"][0]["closesAtMinutes"] = 600      # 120-minute window < 240 min
    problem["employeeDays"][0]["latestEndMinutes"] = 600
    problem["employeeDays"][0]["maximumMinutes"] = 120
    assert "mandatory-day-no-candidate" in codes(problem)


def test_day_budget_above_capacity_is_detected():
    problem = minimal_problem()
    problem["days"][0]["budgetMinutes"] = 720        # one employee, max 480
    assert "day-budget-exceeds-capacity" in codes(problem)


def test_day_budget_below_mandatory_floor_is_detected():
    problem = minimal_problem()
    # Mandatory employee must work >= 240; a positive budget under that floor is
    # unreachable. Kept a multiple of the step and above zero on purpose.
    problem["days"][0]["budgetMinutes"] = 120
    found = codes(problem)
    assert "day-budget-below-mandatory-floor" in found or "day-budget-below-shortest-shift" in found


def test_positive_budget_below_shortest_shift_is_detected():
    problem = minimal_problem()
    problem["employeeDays"][0]["mandatory"] = False   # remove the floor
    problem["days"][0]["budgetMinutes"] = 90          # >0 but < 240 shortest shift
    assert "day-budget-below-shortest-shift" in codes(problem)


def test_day_that_cannot_be_closed_is_detected():
    problem = minimal_problem()
    problem["employees"][0]["canClose"] = False       # nobody can close
    assert "day-cannot-close" in codes(problem)


def test_day_that_cannot_be_opened_is_detected():
    problem = minimal_problem()
    problem["employees"][0]["canOpen"] = False
    assert "day-cannot-open" in codes(problem)


def test_employee_contract_above_capacity_is_detected():
    problem = minimal_problem()
    problem["employees"][0]["contractMinutes"] = 2000  # 2 days x 480 max = 960
    # Rebalance budgets so the per-day checks are not what fires.
    problem["days"][0]["budgetMinutes"] = 480
    problem["days"][1]["budgetMinutes"] = 480
    assert "employee-contract-exceeds-capacity" in codes(problem)


def test_contract_budget_total_mismatch_is_detected():
    problem = minimal_problem()
    problem["days"][0]["budgetMinutes"] = 300          # totals no longer agree
    assert "contract-budget-total-mismatch" in codes(problem)


def test_diagnostics_carry_the_offending_day_or_employee():
    # A diagnostic without a locus would send a manager hunting. Each one names
    # exactly what to look at.
    problem = minimal_problem()
    problem["days"][0]["budgetMinutes"] = 720
    hit = next(d for d in necessary_feasibility_diagnostics(problem)
               if d["code"] == "day-budget-exceeds-capacity")
    assert hit["date"] == "2026-07-20"
    assert "min" in hit["message"]
