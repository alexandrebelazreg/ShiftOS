"""Step 5 — the exact placement MILP, one per (allocation, skeleton) pair.

Small by construction. The durations are fixed by the allocation and the roles
by the skeleton, so this model only chooses WHEN each shift starts: a few dozen
binaries per worked day instead of the twenty-eight thousand the global engine
carries. That is the whole speed story — the same question, asked in three
pieces instead of one.

Exactness inside its own scope
------------------------------
The objective is lexicographic and it is enforced by weighting, not by two
solves: ``BIG × underCoveredSlots + deficitMinutes`` with ``BIG`` strictly
greater than any deficit the week could possibly carry. One extra short slot
then always outweighs every minute of deficit that could be saved, so the
ordering is exact and one MILP does the work of two passes.

What it is NOT is a claim about the WEEK. This model is optimal for the
allocation and skeleton it was given; both were chosen heuristically upstream,
so the pipeline never reports its answer as a global optimum.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from shiftos_highs.demand import DemandModel

from .allocation import Allocation, AllocationModel
from .shifts import ShiftSpace

_SCIPY_OPTIMAL = 0
_SCIPY_INFEASIBLE = 2


@dataclass(frozen=True, slots=True)
class PlacementResult:
    assignments: tuple[dict[str, Any], ...] | None
    under_covered_slots: int
    deficit_minutes: int
    proven: bool
    infeasible: bool
    seconds: float


class _Rows:
    def __init__(self) -> None:
        self.rows: list[int] = []
        self.cols: list[int] = []
        self.values: list[float] = []
        self.lower: list[float] = []
        self.upper: list[float] = []

    def add(self, coefficients: dict[int, float], lb: float, ub: float) -> None:
        row = len(self.lower)
        for column, value in coefficients.items():
            if value:
                self.rows.append(row)
                self.cols.append(column)
                self.values.append(float(value))
        self.lower.append(lb)
        self.upper.append(ub)

    def constraint(self, columns: int) -> LinearConstraint:
        matrix = coo_matrix(
            (self.values, (self.rows, self.cols)), shape=(len(self.lower), columns)
        ).tocsr()
        return LinearConstraint(matrix, np.array(self.lower), np.array(self.upper))


def place(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    space: ShiftSpace,
    demand: DemandModel,
    *,
    time_limit: float,
) -> PlacementResult:
    import time

    started = time.perf_counter()
    if space.impossible:
        return PlacementResult(None, 0, 0, True, True, time.perf_counter() - started)

    step = model.step
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    rules = problem["rules"]

    shifts = space.shifts
    shift_count = len(shifts)
    if shift_count == 0:
        return PlacementResult(None, 0, 0, True, True, time.perf_counter() - started)

    # ── Columns ─────────────────────────────────────────────────────────────
    intervals: list[tuple[str, int, int, int]] = []  # date, start, hard, target
    slot_of_interval: list[list[int]] = []
    slot_ids: list[str] = []
    slot_index: dict[str, int] = {}

    for slot in sorted(
        problem["demandSlots"], key=lambda s: (s["date"], s["startMinutes"], s["id"])
    ):
        slot_index[slot["id"]] = len(slot_ids)
        slot_ids.append(slot["id"])

    membership: dict[tuple[str, int], list[int]] = {}
    for slot in problem["demandSlots"]:
        index = slot_index[slot["id"]]
        for start in range(int(slot["startMinutes"]), int(slot["endMinutes"]), step):
            membership.setdefault((slot["date"], start), []).append(index)

    for date in sorted(demand.days):
        for interval in demand.days[date].intervals:
            intervals.append((date, interval.start, interval.hard_minimum, interval.adapted_target))
            slot_of_interval.append(sorted(membership.get((date, interval.start), [])))

    deficit_offset = shift_count
    slot_offset = deficit_offset + len(intervals)
    columns = slot_offset + len(slot_ids)

    rows = _Rows()

    # Exactly one shift per worked cell.
    for key, bucket in sorted(space.by_cell.items()):
        if bucket:
            rows.add({index: 1.0 for index in bucket}, 1, 1)

    # ── Coverage ────────────────────────────────────────────────────────────
    covering: dict[tuple[str, int], list[int]] = {}
    for shift in shifts:
        date = days[shift.day_index]["date"]
        for segment in shift.segments:
            for start in range(segment.start, segment.end, step):
                covering.setdefault((date, start), []).append(shift.index)

    for index, (date, start, hard, target) in enumerate(intervals):
        presence = {column: 1.0 for column in covering.get((date, start), [])}
        if hard > 0:
            rows.add(dict(presence), float(hard), np.inf)
        if target > hard:
            with_deficit = dict(presence)
            with_deficit[deficit_offset + index] = 1.0
            rows.add(with_deficit, float(target), np.inf)
        for slot in slot_of_interval[index]:
            if target > 0:
                rows.add(
                    {deficit_offset + index: 1.0, slot_offset + slot: -float(target)},
                    -np.inf,
                    0.0,
                )

    # ── Rest between consecutive worked days ────────────────────────────────
    rest = int(rules["minimumRestMinutes"])
    for employee_index in range(len(employees)):
        worked = [
            day_index
            for day_index in range(len(days))
            if allocation.minutes[employee_index][day_index] > 0
        ]
        for position in range(1, len(worked)):
            previous, current = worked[position - 1], worked[position]
            gap = (current - previous) * 1_440
            coefficients: dict[int, float] = {}
            for index in space.by_cell.get((employee_index, current), ()):
                coefficients[index] = coefficients.get(index, 0.0) + shifts[index].first_start
            for index in space.by_cell.get((employee_index, previous), ()):
                coefficients[index] = coefficients.get(index, 0.0) - shifts[index].last_end
            rows.add(coefficients, rest - gap, np.inf)

    # ── Objective ───────────────────────────────────────────────────────────
    #
    # Lexicographic by weighting: BIG must exceed every deficit the week could
    # carry, so one extra short slot can never be traded for saved minutes.
    biggest_deficit = sum(target for _d, _s, _h, target in intervals) * step
    big = float(biggest_deficit + 1) * 10.0

    objective = np.zeros(columns)
    for index in range(len(intervals)):
        objective[deficit_offset + index] = float(step)
    for index in range(len(slot_ids)):
        objective[slot_offset + index] = big
    # A whisper of preference for plain hours, far below any coverage term.
    for shift in shifts:
        objective[shift.index] = (len(shift.segments) - 1) * 1e-3 + shift.index * 1e-9

    lower_bounds = np.zeros(columns)
    upper_bounds = np.ones(columns)
    for index, (_date, _start, _hard, target) in enumerate(intervals):
        upper_bounds[deficit_offset + index] = float(target)

    result = milp(
        objective,
        integrality=np.ones(columns, dtype=np.int8),
        bounds=Bounds(lower_bounds, upper_bounds),
        constraints=rows.constraint(columns),
        options={"time_limit": float(max(1.0, time_limit)), "mip_rel_gap": 0.0},
    )
    seconds = time.perf_counter() - started

    if result.status == _SCIPY_INFEASIBLE:
        return PlacementResult(None, 0, 0, True, True, seconds)
    if result.x is None:
        return PlacementResult(None, 0, 0, False, False, seconds)

    chosen = [shift for shift in shifts if result.x[shift.index] > 0.5]
    assignments = [
        {
            "employeeId": model.employees[shift.employee_index],
            "date": days[shift.day_index]["date"],
            "segments": [
                {"startMinutes": s.start, "endMinutes": s.end} for s in shift.segments
            ],
        }
        for shift in chosen
    ]
    assignments.sort(key=lambda item: (item["date"], item["employeeId"]))

    deficit = sum(
        int(round(result.x[deficit_offset + index])) for index in range(len(intervals))
    ) * step
    short = sum(
        1 for index in range(len(slot_ids)) if result.x[slot_offset + index] > 0.5
    )

    return PlacementResult(
        assignments=tuple(assignments),
        under_covered_slots=short,
        deficit_minutes=deficit,
        proven=result.status == _SCIPY_OPTIMAL,
        infeasible=False,
        seconds=seconds,
    )
