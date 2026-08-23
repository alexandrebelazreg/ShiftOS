from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from .candidates import Candidate, generate_candidates
from .coverage_model import (
    build_coverage_layout,
    business_cost_objective,
    coverage_rows,
    deficit_minutes_objective,
    under_covered_slots_objective,
)
from .demand import build_demand_model
from .evaluate import evaluate
from .fingerprint import fingerprint_problem, fingerprint_solution

# HiGHS statuses that SciPy surfaces through ``result.status``.
_SCIPY_OPTIMAL = 0
_SCIPY_LIMIT = 1
_SCIPY_INFEASIBLE = 2


class _Rows:
    """A sparse constraint accumulator.

    Kept as a tiny class rather than four parallel lists threaded through every
    function: the rows are built by several modules and a dropped list is the
    kind of mistake that produces a silently weaker model.
    """

    def __init__(self) -> None:
        self.rows: list[int] = []
        self.cols: list[int] = []
        self.values: list[float] = []
        self.lower: list[float] = []
        self.upper: list[float] = []

    def add(
        self,
        coefficients: dict[int, float],
        lb: float = -np.inf,
        ub: float = np.inf,
    ) -> None:
        row = len(self.lower)
        for column, value in coefficients.items():
            if value:
                self.rows.append(row)
                self.cols.append(column)
                self.values.append(float(value))
        self.lower.append(float(lb))
        self.upper.append(float(ub))

    def to_constraint(self, columns: int) -> LinearConstraint:
        matrix = coo_matrix(
            (self.values, (self.rows, self.cols)), shape=(len(self.lower), columns)
        ).tocsr()
        return LinearConstraint(matrix, np.array(self.lower), np.array(self.upper))


def _covering_candidates(
    candidates: list[Candidate], step: int
) -> dict[tuple[str, int], list[int]]:
    """``{(date, intervalStart): [candidate columns present then]}``."""
    covering: dict[tuple[str, int], list[int]] = defaultdict(list)
    for candidate in candidates:
        for segment in candidate.segments:
            for start in range(segment.start, segment.end, step):
                covering[(candidate.date, start)].append(candidate.index)
    return covering


def _structural_rows(
    problem: dict[str, Any],
    candidates: list[Candidate],
    by_assignment: dict[tuple[str, str], list[int]],
    rows: _Rows,
) -> None:
    """Everything that is not coverage: assignment, contracts, budgets, roles, rest.

    Unchanged from the parity milestone — none of it was wrong, and none of it
    is touched by the coverage correction.
    """
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    open_days = sorted(
        [item for item in problem["days"] if not item["closed"]], key=lambda item: item["date"]
    )
    all_days = sorted(problem["days"], key=lambda item: item["date"])
    rules = problem["rules"]

    by_date: dict[str, list[int]] = defaultdict(list)
    for candidate in candidates:
        by_date[candidate.date].append(candidate.index)

    # Exactly one candidate per mandatory employee-day.
    for key in sorted(by_assignment):
        rows.add({index: 1 for index in by_assignment[key]}, 1, 1)

    # Exact weekly contracts.
    for employee in employees:
        employee_id = str(employee["id"])
        rows.add(
            {
                candidate.index: candidate.worked_minutes
                for candidate in candidates
                if candidate.employee_id == employee_id
            },
            employee["contractMinutes"],
            employee["contractMinutes"],
        )

    # Exact daily budgets. This is what keeps surplus presence PLANNABLE: the
    # minutes above the adapted target still have to land somewhere.
    for day in open_days:
        if day.get("budgetMode", "exact") == "exact":
            rows.add(
                {index: candidates[index].worked_minutes for index in by_date[day["date"]]},
                day["budgetMinutes"],
                day["budgetMinutes"],
            )

    # Openings and closings.
    for day in open_days:
        rows.add(
            {
                index: 1
                for index in by_date[day["date"]]
                if candidates[index].first_start == day["opensAtMinutes"]
            },
            rules["minimumOpeningsPerDay"],
            np.inf,
        )
        rows.add(
            {
                index: 1
                for index in by_date[day["date"]]
                if candidates[index].last_end == day["closesAtMinutes"]
            },
            rules["exactClosingsPerDay"],
            np.inf,
        )

    day_by_date = {day["date"]: day for day in open_days}
    for employee in employees:
        employee_id = str(employee["id"])
        if employee["maximumOpenings"] is not None:
            rows.add(
                {
                    candidate.index: 1
                    for candidate in candidates
                    if candidate.employee_id == employee_id
                    and candidate.first_start == day_by_date[candidate.date]["opensAtMinutes"]
                },
                -np.inf,
                employee["maximumOpenings"],
            )
        if employee["maximumClosings"] is not None:
            rows.add(
                {
                    candidate.index: 1
                    for candidate in candidates
                    if candidate.employee_id == employee_id
                    and candidate.last_end == day_by_date[candidate.date]["closesAtMinutes"]
                },
                -np.inf,
                employee["maximumClosings"],
            )

    # Rest between consecutive WORKED days. A closed or unavailable day resets
    # the chain, exactly like the independent TypeScript validator.
    for employee in employees:
        employee_id = str(employee["id"])
        previous_date: str | None = None
        for day in all_days:
            key = (employee_id, day["date"])
            if day["closed"] or key not in by_assignment:
                previous_date = None
                continue
            if previous_date is not None:
                coefficients: dict[int, float] = {}
                for index in by_assignment[key]:
                    coefficients[index] = coefficients.get(index, 0) + candidates[index].first_start
                for index in by_assignment[(employee_id, previous_date)]:
                    coefficients[index] = coefficients.get(index, 0) - candidates[index].last_end
                rows.add(coefficients, rules["minimumRestMinutes"] - 24 * 60, np.inf)
            previous_date = day["date"]



def _closing_fairness_objectives(
    problem: dict[str, Any], candidates: list[Candidate], layout: Any
) -> list[tuple[str, dict[int, float]]]:
    """Secondary passes that spread closings, run AFTER coverage is frozen.

    Each pass is a plain linear objective over the candidate columns: a
    candidate that ends exactly at closing costs its employee's current load,
    everything else costs nothing. Minimising it therefore hands the closing to
    whoever is carrying the least — and, because it runs only once coverage,
    deficit and business cost are already pinned by `rows.add(...)`, it can
    reorder WHO closes without ever changing HOW MANY slots are covered.

    Loads are integer permille, not decimals. The MILP needs floats in the end,
    but the value fed to it is derived from an exact integer ratio, so two runs
    on two machines rank the same employees the same way.

    Returned empty when no balance is switched on, which keeps the pass list —
    and therefore the diagnostics and the proof — identical to before.
    """
    rules = problem.get("rules") or {}
    fairness = rules.get("closingFairness")
    if not fairness:
        return []
    balance_general = bool(fairness.get("balanceClosings"))
    balance_saturday = bool(fairness.get("balanceSaturdayClosings"))
    if not (balance_general or balance_saturday):
        return []

    history = {str(entry["employeeId"]): entry for entry in (problem.get("closingHistory") or [])}
    closes_at = {
        day["date"]: day["closesAtMinutes"]
        for day in problem["days"]
        if not day["closed"] and day["closesAtMinutes"] is not None
    }
    saturdays = {
        day["date"]
        for day in problem["days"]
        if not day["closed"] and _weekday(day["date"]) == 5
    }

    def permille(employee_id: str, closings_key: str, opportunities_key: str) -> float:
        entry = history.get(employee_id)
        if not entry:
            return 0.0
        opportunities = int(entry[opportunities_key])
        if opportunities <= 0:
            # No opportunity is no load — and the lightest possible claim on the
            # next closing, which is why it sits below a genuine zero.
            return -1.0
        return float((int(entry[closings_key]) * 1000) // opportunities)

    def objective(only_saturday: bool, closings_key: str, opportunities_key: str) -> dict[int, float]:
        costs: dict[int, float] = {}
        for candidate in candidates:
            if only_saturday and candidate.date not in saturdays:
                continue
            if candidate.last_end != closes_at.get(candidate.date):
                continue
            weight = permille(candidate.employee_id, closings_key, opportunities_key)
            if weight != 0.0:
                costs[candidate.index] = weight
        return costs

    passes: list[tuple[str, dict[int, float]]] = []
    # Saturday first: the problem declares `saturday-closing-fairness` ahead of
    # `closing-fairness`, and a lexicographic solver enforces that order by the
    # order it freezes the passes in.
    if balance_saturday:
        passes.append(("4-saturday-closing-fairness", objective(True, "saturdayClosings", "saturdayOpportunities")))
    if balance_general:
        passes.append(("5-closing-fairness", objective(False, "closings", "opportunities")))
    return [(name, costs) for name, costs in passes if costs]


def _weekday(date: str) -> int:
    from datetime import date as _date

    year, month, day = (int(part) for part in date.split("-"))
    return _date(year, month, day).weekday()


def _tie_break_costs(
    problem: dict[str, Any], candidates: list[Candidate], layout: Any
) -> np.ndarray:
    """The final pass: a readable, deterministic preference among equals.

    Two business preferences, then pure determinism:

    - keep each employee's days close to an even share of their contract;
    - place SURPLUS presence where the reference demand is high rather than in
      the troughs. Surplus is not demand — it is minutes the contracts force
      onto the week — so the only question is where they do the most good, and
      a busy hour is a better answer than a dead one.

    The remaining terms exist solely to make the optimum unique.
    """
    employees = {str(item["id"]): item for item in problem["employees"]}
    employee_days = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }
    step = int(problem["timeStepMinutes"])

    # Availability alone — Planiteo has no optional days, so every open day an
    # employee is available for is a day they work.
    worked_day_counts: dict[str, int] = defaultdict(int)
    for (employee_id, _date), entry in employee_days.items():
        if entry["available"]:
            worked_day_counts[employee_id] += 1

    reference_by_interval = {
        (interval.date, interval.start): interval.reference_required
        for interval in layout.intervals
    }
    peak = max([value for value in reference_by_interval.values()] or [1]) or 1

    costs = np.zeros(layout.total_columns, dtype=float)
    for candidate in candidates:
        worked_days = worked_day_counts.get(candidate.employee_id, 0) or 1
        target = employees[candidate.employee_id]["contractMinutes"] / worked_days
        deviation = abs(candidate.worked_minutes - target)

        # Reward covering high-demand moments. Bounded well below the deviation
        # term so it can only ever break a tie, never buy one.
        richness = 0.0
        for segment in candidate.segments:
            for start in range(segment.start, segment.end, step):
                richness += reference_by_interval.get((candidate.date, start), 0) / peak

        costs[candidate.index] = (
            deviation * 1000.0
            - richness * 0.5
            + candidate.split_count * 10.0
            + candidate.first_start * 0.001
            + candidate.last_end * 0.000001
            + candidate.index * 1e-9
        )
    return costs


def _diagnostics(**values: Any) -> dict[str, Any]:
    return dict(values)


def solve(problem: dict[str, Any], *, time_limit_seconds: float = 45.0) -> dict[str, Any]:
    """Solve one ``PlanningProblemV3``.

    Statuses, and what each one promises:

    ``optimal``
        every lexicographic pass finished and the last one was proven optimal.
    ``feasible-time-limit``
        a legal schedule was found and kept, but a pass ran out of time. The
        schedule is real; its optimality is not claimed.
    ``timeout-without-solution``
        the budget ran out with no incumbent. Proves NOTHING about the problem.
    ``infeasible-proven``
        no schedule exists — either the hard floors exceed the day's capacity,
        which the demand model settles before any search, or HiGHS proved it.
    ``invalid-problem``
        the input does not describe a problem this solver can express.
    ``backend-error``
        a schedule was produced and the independent evaluator rejected it. That
        is a defect here, never a verdict about the week.
    """
    started = time.perf_counter()
    fingerprint = fingerprint_problem(problem)

    def elapsed() -> float:
        return time.perf_counter() - started

    def remaining() -> float:
        return max(1.0, time_limit_seconds - elapsed())

    # ── Demand rescaling, before anything is modelled ────────────────────────
    demand = build_demand_model(problem)
    if demand.infeasible_days:
        return {
            "status": "infeasible-proven",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": _diagnostics(
                reason="day-cannot-be-staffed",
                infeasibleDays=[
                    {"date": date, "reason": demand.days[date].infeasible_reason}
                    for date in demand.infeasible_days
                ],
                totalSeconds=elapsed(),
                proof="structural",
            ),
        }

    try:
        candidate_started = time.perf_counter()
        candidates, by_assignment = generate_candidates(problem)
        candidate_seconds = time.perf_counter() - candidate_started
    except ValueError as error:
        return {
            "status": "invalid-problem",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": _diagnostics(reason=str(error), totalSeconds=elapsed(), proof="none"),
        }

    if not candidates:
        # Nobody can work at all. Only infeasible if something was actually
        # demanded; an empty day with no floor is simply an empty day.
        needs_cover = any(
            interval.hard_minimum > 0 or interval.adapted_target > 0
            for day in demand.days.values()
            for interval in day.intervals
        )
        return {
            "status": "infeasible-proven" if needs_cover else "invalid-problem",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": _diagnostics(
                reason="no-candidate-shift-exists",
                totalSeconds=elapsed(),
                proof="structural" if needs_cover else "none",
            ),
        }

    # ── Model ────────────────────────────────────────────────────────────────
    model_started = time.perf_counter()
    step = int(problem["timeStepMinutes"])
    layout = build_coverage_layout(problem, demand, len(candidates))
    covering = _covering_candidates(candidates, step)

    rows = _Rows()
    _structural_rows(problem, candidates, by_assignment, rows)
    for coefficients, lb, ub in coverage_rows(layout, covering):
        rows.add(coefficients, lb, ub)

    columns = layout.total_columns
    integrality = np.ones(columns, dtype=np.int8)
    lower_bounds = np.zeros(columns)
    upper_bounds = np.ones(columns)
    # Deficit columns are general integers, capped by their own target: you
    # cannot miss more than the target asked for.
    for index, interval in enumerate(layout.intervals):
        upper_bounds[layout.deficit_column(index)] = float(interval.adapted_target)
    bounds = Bounds(lower_bounds, upper_bounds)
    model_seconds = time.perf_counter() - model_started

    budget_by_date = {day["date"]: int(day["budgetMinutes"]) for day in problem["days"]}

    # ── Lexicographic passes ────────────────────────────────────────────────
    #
    # SciPy exposes a single objective, so the order is enforced by solving,
    # freezing the optimum as a constraint, and solving again. Never a weighted
    # sum: a weighted sum lets a tie-break buy an under-covered slot.
    passes: list[tuple[str, dict[int, float]]] = [
        ("1-under-covered-slots", under_covered_slots_objective(layout)),
        ("2-deficit-minutes", deficit_minutes_objective(layout)),
        ("3-business-cost", business_cost_objective(layout, budget_by_date)),
        # Closing fairness runs here, under a frozen coverage: pass 1 pinned the
        # under-covered slots, pass 2 the deficit minutes and pass 3 their
        # business cost, so nothing below can buy fairness with a shortfall.
        *_closing_fairness_objectives(problem, candidates, layout),
    ]

    incumbent: np.ndarray | None = None
    pass_reports: list[dict[str, Any]] = []
    hit_limit = False
    milp_seconds = 0.0

    for name, objective_map in passes:
        vector = np.zeros(columns, dtype=float)
        for column, value in objective_map.items():
            vector[column] = value

        pass_started = time.perf_counter()
        result = milp(
            vector,
            integrality=integrality,
            bounds=bounds,
            constraints=rows.to_constraint(columns),
            options={"time_limit": remaining(), "mip_rel_gap": 0.0},
        )
        pass_seconds = time.perf_counter() - pass_started
        milp_seconds += pass_seconds

        if result.status == _SCIPY_INFEASIBLE:
            return {
                "status": "infeasible-proven",
                "problemFingerprint": fingerprint,
                "solution": None,
                "diagnostics": _diagnostics(
                    reason=f"proven-infeasible-in-pass-{name}",
                    candidateCount=len(candidates),
                    candidateGenerationSeconds=candidate_seconds,
                    modelBuildSeconds=model_seconds,
                    milpSeconds=milp_seconds,
                    totalSeconds=elapsed(),
                    passes=pass_reports,
                    proof="solver",
                ),
            }

        if result.x is not None:
            incumbent = result.x

        pass_reports.append(
            {
                "name": name,
                "scipyStatus": int(result.status),
                "message": result.message,
                "objective": None if result.fun is None else float(result.fun),
                "proven": result.status == _SCIPY_OPTIMAL,
                "seconds": pass_seconds,
            }
        )

        if result.status != _SCIPY_OPTIMAL or result.x is None:
            # The level is not proven, so freezing it would pin a value that may
            # not be the optimum. Stop here and keep whatever is in hand.
            hit_limit = True
            break

        # Freeze this level, then let the next pass optimise underneath it.
        rows.add(objective_map, -np.inf, float(result.fun))

        if name == "1-under-covered-slots" and result.fun is not None and result.fun < 0.5:
            # Zero slots short means every deficit variable is zero, so passes 2
            # and 3 are already at their optimum. Proven, not assumed — the slot
            # linkage forces a binary on for any non-zero deficit.
            pass_reports.append(
                {
                    "name": "2-and-3-skipped",
                    "reason": "zero-under-covered-slots-implies-zero-deficit",
                    "proven": True,
                    "seconds": 0.0,
                }
            )
            for index in range(len(layout.intervals)):
                upper_bounds[layout.deficit_column(index)] = 0.0
            bounds = Bounds(lower_bounds, upper_bounds)
            break

    # ── Final pass: deterministic preference among equals ───────────────────
    if not hit_limit:
        vector = _tie_break_costs(problem, candidates, layout)
        pass_started = time.perf_counter()
        result = milp(
            vector,
            integrality=integrality,
            bounds=bounds,
            constraints=rows.to_constraint(columns),
            options={"time_limit": remaining(), "mip_rel_gap": 0.0},
        )
        pass_seconds = time.perf_counter() - pass_started
        milp_seconds += pass_seconds
        if result.x is not None:
            incumbent = result.x
        pass_reports.append(
            {
                "name": "4-secondary",
                "scipyStatus": int(result.status),
                "message": result.message,
                "objective": None if result.fun is None else float(result.fun),
                "proven": result.status == _SCIPY_OPTIMAL,
                "seconds": pass_seconds,
            }
        )
        if result.status != _SCIPY_OPTIMAL:
            hit_limit = True

    if incumbent is None:
        return {
            "status": "timeout-without-solution",
            "problemFingerprint": fingerprint,
            "solution": None,
            "diagnostics": _diagnostics(
                reason="time-limit-reached-before-any-incumbent",
                candidateCount=len(candidates),
                candidateGenerationSeconds=candidate_seconds,
                modelBuildSeconds=model_seconds,
                milpSeconds=milp_seconds,
                totalSeconds=elapsed(),
                passes=pass_reports,
                proof="none",
            ),
        }

    # ── Read the schedule back ──────────────────────────────────────────────
    selected = [candidate for candidate in candidates if incumbent[candidate.index] > 0.5]
    assignments = [
        {
            "employeeId": candidate.employee_id,
            "date": candidate.date,
            "segments": [
                {"startMinutes": segment.start, "endMinutes": segment.end}
                for segment in candidate.segments
            ],
        }
        for candidate in selected
    ]
    assignments.sort(key=lambda item: (item["date"], item["employeeId"]))

    report = evaluate(problem, assignments)
    solution = {
        "version": "v3.0.0",
        "problemFingerprint": fingerprint,
        "assignments": assignments,
        "declaredMetrics": {"totalDeficitMinutes": report["totalDeficitMinutes"]},
    }

    deficit_units = sum(
        int(round(incumbent[layout.deficit_column(index)]))
        for index in range(len(layout.intervals))
    )
    adapted_slots_short = sum(
        1
        for index in range(len(layout.slot_ids))
        if incumbent[layout.slot_column(index)] > 0.5
    )

    diagnostics = _diagnostics(
        candidateCount=len(candidates),
        selectedCandidateCount=len(selected),
        candidateGenerationSeconds=candidate_seconds,
        modelBuildSeconds=model_seconds,
        milpSeconds=milp_seconds,
        totalSeconds=elapsed(),
        passes=pass_reports,
        adaptedTargetShortSlots=adapted_slots_short,
        adaptedTargetDeficitMinutes=deficit_units * step,
        surplusMinutesByDate={
            date: day.surplus_minutes for date, day in sorted(demand.days.items())
        },
        proof="lexicographic-passes-proven" if not hit_limit else "incumbent-not-proven",
    )

    if not report["validHardConstraints"]:
        # The model produced something its own evaluator rejects. A defect here,
        # never a statement about the week.
        return {
            "status": "backend-error",
            "problemFingerprint": fingerprint,
            "solution": solution,
            "evaluation": report,
            "diagnostics": diagnostics,
        }

    return {
        "status": "feasible-time-limit" if hit_limit else "optimal",
        "problemFingerprint": fingerprint,
        "solutionFingerprint": fingerprint_solution(solution),
        "solution": solution,
        "evaluation": report,
        "diagnostics": diagnostics,
    }
