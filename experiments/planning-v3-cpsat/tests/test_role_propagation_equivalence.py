"""The redundant role clauses must not remove a single legal schedule.

A "redundant" constraint that quietly cuts solutions is the most expensive kind
of bug in a solver: the answer still looks optimal, and it is optimal — over a
space someone silently shrank. So this suite does not argue about the proof, it
ENUMERATES. For each small problem it lists every feasible schedule twice, once
with the clauses and once without, and demands the two sets be equal.

The problems are built so the two implications actually bite:
  - the day amplitude exceeds the maximum shift, so opening and closing the
    same day is impossible;
  - the night between two consecutive days is shorter than the minimum rest, so
    closing one and opening the next is impossible.

A problem where neither bites would pass this test while proving nothing.

    python -m pytest experiments/planning-v3-cpsat/tests/test_role_propagation_equivalence.py
"""
import os
import sys

import pytest
from ortools.sat.python import cp_model

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cpsat_model import build_model  # noqa: E402


def problem(*, employees=2, days=2, opens=360, closes=1200, minimum_shift=240,
            maximum_shift=600, minimum_rest=720, budget=None, contract=None,
            openings=0, closings=0, step=60):
    """A deliberately tiny week, tuned so enumeration stays finite."""
    contract = contract if contract is not None else minimum_shift * days
    budget = budget if budget is not None else contract * employees // days
    dates = [f"2026-07-{20 + index:02d}" for index in range(days)]
    weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    return {
        "version": "v3.0.0", "planningId": "t", "sectorId": "s",
        "period": {"start": dates[0], "end": dates[-1]},
        "timeStepMinutes": step, "objectives": [],
        "rules": {
            "minimumShiftMinutes": minimum_shift, "maximumShiftMinutes": maximum_shift,
            "minimumRestMinutes": minimum_rest, "maximumConsecutiveWorkedDays": days,
            "maximumConsecutiveWorkedDaysSource": "derived-fallback",
            "splitShiftAllowed": False, "maximumSplitMinutes": None,
            "minimumOpeningsPerDay": openings, "exactClosingsPerDay": closings,
        },
        "employees": [{
            "id": f"e{i}", "contractMinutes": contract,
            "workingDays": weekdays[:days], "fixedRestDays": [],
            "canOpen": True, "canClose": True,
            "maximumOpenings": None, "maximumClosings": None,
        } for i in range(employees)],
        "days": [{
            "date": dates[d], "weekDay": weekdays[d], "weekKey": "2026-W30",
            "closed": False, "opensAtMinutes": opens, "closesAtMinutes": closes,
            "budgetMinutes": budget,
        } for d in range(days)],
        "employeeDays": [{
            "employeeId": f"e{i}", "date": dates[d], "available": True, "mandatory": False,
            "earliestStartMinutes": opens, "latestEndMinutes": closes,
            "maximumMinutes": maximum_shift,
        } for i in range(employees) for d in range(days)],
        "demandSlots": [],
    }


class Collect(cp_model.CpSolverSolutionCallback):
    """Records the selected shift geometry of every solution."""

    def __init__(self, handles, problem_):
        super().__init__()
        self._handles = handles
        self._problem = problem_
        self.seen = set()

    def on_solution_callback(self):
        chosen = []
        for (ei, di, ci), var in self._handles["x"].items():
            if self.Value(var):
                candidate = self._handles["pool"][(ei, di)][ci]
                chosen.append((ei, di, candidate["start"], candidate["end"]))
        self.seen.add(tuple(sorted(chosen)))


def every_schedule(problem_, with_roles):
    """The complete feasible set, as shift geometries — no objective stated."""
    model, handles = build_model(problem_, None, with_role_propagation=with_roles)
    solver = cp_model.CpSolver()
    solver.parameters.enumerate_all_solutions = True
    solver.parameters.num_search_workers = 1
    solver.parameters.max_time_in_seconds = 60.0
    collector = Collect(handles, problem_)
    status = solver.Solve(model, collector)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE, cp_model.INFEASIBLE)
    return collector.seen


CASES = {
    # Amplitude 840 > 600: opening and closing the same day is impossible.
    # Night 360 - 1200 + 1440 = 600 < 720: closing then opening is impossible.
    # Both implications bite — the Drive shape, in miniature.
    "both-implications-bite": problem(),
    "with-an-exact-closing": problem(closings=1, openings=1),
    "three-days": problem(days=3, contract=720, closings=1, openings=1),
    "three-employees": problem(employees=3, closings=1, openings=1),
    # A short day: amplitude 480 <= 600, so implication (1) does NOT apply and
    # opening-and-closing is legal. The clauses must stay out of the way.
    "short-day-implication-one-idle": problem(opens=480, closes=960, minimum_shift=120,
                                              maximum_shift=600, step=120),
    # A long night: 960 - 720 + 1440 = 1680 >= 720, implication (2) idle.
    "long-night-implication-two-idle": problem(opens=480, closes=720, minimum_shift=120,
                                               maximum_shift=240, minimum_rest=600, step=120),
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_feasible_space_is_identical(name):
    case = CASES[name]
    without = every_schedule(case, with_roles=False)
    with_roles = every_schedule(case, with_roles=True)
    assert without == with_roles, (
        f"{name}: {len(without)} plannings sans les clauses, {len(with_roles)} avec. "
        f"Perdus : {sorted(without - with_roles)[:3]}"
    )


def test_the_enumeration_is_not_vacuous():
    # A test comparing two empty sets would pass while proving nothing.
    assert len(every_schedule(CASES["both-implications-bite"], with_roles=False)) > 1


def test_implications_actually_bite_on_the_drive_shape():
    """The Drive geometry really does make both clauses non-trivial."""
    case = CASES["both-implications-bite"]
    rules = case["rules"]
    day = case["days"][0]
    amplitude = day["closesAtMinutes"] - day["opensAtMinutes"]
    night = case["days"][1]["opensAtMinutes"] - day["closesAtMinutes"] + 1440
    assert amplitude > rules["maximumShiftMinutes"], "implication (1) serait inerte"
    assert night < rules["minimumRestMinutes"], "implication (2) serait inerte"
