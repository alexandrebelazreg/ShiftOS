"""Step 2 — how many minutes each employee works each day.

A SMALL MILP, deliberately. The global engine decides minutes and hours in one
model of twenty-eight thousand binaries; this one answers only "how long", over
thirty integer variables, and hands the answer to a placement that then only has
to decide "when". Splitting the question is the whole reason this engine is
fast.

The problem solved here
-----------------------
Find integer ``minutes[e][d]`` with

    row sums    Σ_d m[e][d] = contract(e)      exact
    column sums Σ_e m[e][d] = budget(d)        for legacy exact budgets
                |Σ_e m[e][d] - target(d)|     minimised for flexible targets
    each cell   minDaily(e) ≤ m[e][d] ≤ ceiling(e,d)   on available days
                m[e][d] = 0                             elsewhere
    every cell a multiple of the time step

Une cellule obligatoire porte directement sa durée minimale. Une cellule
disponible mais facultative reçoit un petit binaire « travaille / repos » : sa
durée vaut alors zéro, ou au moins le minimum quotidien. Cela respecte enfin la
distinction du contrat entre ``available`` et ``mandatory`` sans agrandir le
MILP de placement.

What the objective is for
-------------------------
Contracts are exact. Daily percentages are targets, so the model may also move
minutes between days when availability or coverage makes that useful.
Two things are worth steering:

- **avoid forcing a split.** A duration above the continuous cap can only be
  worked in two pieces, and a split punches a 45-to-90 minute hole in the middle
  of someone's day. On a thin day that hole is unfillable, and the day becomes
  infeasible for a reason that has nothing to do with demand;
- **keep each employee's days even.** A week where one day is ten hours and the
  next is four is legal and unpleasant, and it also concentrates coverage where
  it is not needed.

Splits are penalised far more heavily than imbalance, so imbalance can never buy
one.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Iterator

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix

from shiftos_highs.demand import _daily_ceiling


@dataclass(frozen=True, slots=True)
class Cell:
    employee_index: int
    day_index: int
    minimum: int
    maximum: int
    #: Longest stretch this employee can work in one piece on this day.
    continuous_maximum: int
    mandatory: bool


@dataclass(frozen=True, slots=True)
class Allocation:
    """``minutes[employeeIndex][dayIndex]``, always a multiple of the step."""

    minutes: tuple[tuple[int, ...], ...]
    #: Where it came from, for the report: the MILP or a 2×2 swap of it.
    origin: str

    def signature(self) -> str:
        return "|".join(",".join(str(value) for value in row) for row in self.minutes)


@dataclass(frozen=True, slots=True)
class AllocationSolveResult:
    """One allocation MILP outcome, without confusing timeout and proof.

    SciPy returns ``x is None`` both when HiGHS proves the model infeasible and
    when it stops before finding an incumbent.  The fast pipeline used to throw
    that distinction away and could therefore report a timed-out feasibility
    probe as a proven impossibility.  Keeping the native status beside the
    optional allocation makes the only proof-producing caller check the fact it
    actually needs.
    """

    allocation: Allocation | None
    solver_status: int

    @property
    def proven_infeasible(self) -> bool:
        # scipy.optimize.milp: 2 means the model was proven infeasible.
        return self.solver_status == 2


@dataclass(frozen=True, slots=True)
class AllocationModel:
    employees: tuple[str, ...]
    dates: tuple[str, ...]
    cells: tuple[tuple[Cell | None, ...], ...]
    step: int

    def cell(self, employee_index: int, day_index: int) -> Cell | None:
        return self.cells[employee_index][day_index]


def allocation_infeasibility_details(
    problem: dict[str, Any], model: AllocationModel
) -> dict[str, Any]:
    """Explain the arithmetic around an allocation proof in manager terms.

    HiGHS can prove that the transportation polytope is empty, but its native
    status cannot say which row or column caused it. The simple bounds below
    catch the common, actionable cases without pretending they are a second
    proof: a contract outside the sum of its daily bounds, or a daily budget
    outside the sum of the employees' bounds.
    """
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted(
        [day for day in problem["days"] if not day["closed"]],
        key=lambda day: day["date"],
    )
    employee_conflicts: list[dict[str, Any]] = []
    for employee_index, employee in enumerate(employees):
        cells = [cell for cell in model.cells[employee_index] if cell is not None]
        minimum = sum(cell.minimum for cell in cells if cell.mandatory)
        maximum = sum(cell.maximum for cell in cells)
        contract = int(employee["contractMinutes"])
        if minimum <= contract <= maximum:
            continue
        first_name = str(employee.get("firstName") or "").strip()
        last_name = str(employee.get("lastName") or "").strip()
        employee_conflicts.append(
            {
                "employeeId": str(employee["id"]),
                "employeeName": f"{first_name} {last_name}".strip()
                or str(employee["id"]),
                "contractMinutes": contract,
                "minimumPossibleMinutes": minimum,
                "maximumPossibleMinutes": maximum,
                "availableDayCount": len(cells),
                "reason": (
                    "contract-below-mandatory-minimum"
                    if contract < minimum
                    else "contract-exceeds-available-capacity"
                ),
                "differenceMinutes": (
                    minimum - contract if contract < minimum else contract - maximum
                ),
            }
        )

    day_conflicts: list[dict[str, Any]] = []
    for day_index, day in enumerate(days):
        if day.get("budgetMode", "exact") == "target":
            continue
        cells = [
            model.cell(employee_index, day_index)
            for employee_index in range(len(employees))
        ]
        usable = [cell for cell in cells if cell is not None]
        minimum = sum(cell.minimum for cell in usable if cell.mandatory)
        maximum = sum(cell.maximum for cell in usable)
        budget = int(day["budgetMinutes"])
        if minimum <= budget <= maximum:
            continue
        day_conflicts.append(
            {
                "date": day["date"],
                "budgetMinutes": budget,
                "minimumMandatoryMinutes": minimum,
                "maximumCapacityMinutes": maximum,
                "availableEmployeeCount": len(usable),
                "reason": (
                    "budget-below-mandatory-minimum"
                    if budget < minimum
                    else "budget-exceeds-daily-capacity"
                ),
                "differenceMinutes": (
                    minimum - budget if budget < minimum else budget - maximum
                ),
            }
        )

    return {
        "allocationEmployeeConflicts": employee_conflicts,
        "allocationDayConflicts": day_conflicts,
        "allocationTotals": {
            "employeeCount": len(employees),
            "openDayCount": len(days),
            "contractMinutes": sum(int(employee["contractMinutes"]) for employee in employees),
            "budgetMinutes": sum(int(day["budgetMinutes"]) for day in days),
        },
    }


def _forced_sector_role_minimums(
    problem: dict[str, Any],
    employees: list[dict[str, Any]],
    entries: dict[tuple[str, str], dict[str, Any]],
    step: int,
) -> dict[tuple[str, str], int]:
    """Minutes forced when one employee alone must open and close a sector.

    The role preflight proves whether such a day is possible, but the allocation
    MILP used to know nothing about the span attached to those two roles. It
    could therefore allocate four ordinary hours to the only fish-counter
    opener/closer, after which every placement shape was necessarily rejected.

    This is a bound, not a heuristic: if the same sole eligible employee must
    hold both boundaries, their worked minutes are the opening/closing span
    minus at most the largest legal break. Two legal segments must also each
    reach the global minimum shift duration.
    """
    sectors = problem.get("sectors") or []
    if not sectors:
        return {}

    rules = problem.get("rules") or {}
    minimum_segment = int(rules.get("minimumShiftMinutes") or 0)
    continuous_cap = int(
        rules.get("maximumContinuousMinutes")
        or rules.get("maximumShiftMinutes")
        or 0
    )
    forced: dict[tuple[str, str], int] = {}

    for sector in sectors:
        sector_id = str(sector.get("id"))
        split_rules = (
            sector.get("splitRules")
            if isinstance(sector.get("splitRules"), dict)
            else rules
        )
        assigned = [
            employee
            for employee in employees
            if sector_id
            in [str(value) for value in employee.get("allowedSectorIds") or []]
        ]

        for sector_day in sector.get("days") or []:
            if bool(sector_day.get("closed")):
                continue
            if int(sector_day.get("minimumOpenings") or 0) < 1:
                continue
            if int(sector_day.get("exactClosings") or 0) < 1:
                continue

            date = str(sector_day.get("date"))
            opens_at = sector_day.get("opensAtMinutes")
            closes_at = sector_day.get("closesAtMinutes")
            if not isinstance(opens_at, int) or not isinstance(closes_at, int):
                continue

            usable: list[tuple[dict[str, Any], dict[str, Any]]] = []
            for employee in assigned:
                employee_id = str(employee.get("id"))
                entry = entries.get((employee_id, date))
                if entry is None or not bool(entry.get("available")):
                    continue
                usable.append((employee, entry))

            opening_candidates = [
                employee
                for employee, entry in usable
                if bool(employee.get("canOpen"))
                and int(entry.get("earliestStartMinutes") or 0) <= opens_at
                and int(entry.get("latestEndMinutes") or 0) > opens_at
            ]
            closing_candidates = [
                employee
                for employee, entry in usable
                if bool(employee.get("canClose"))
                and int(entry.get("earliestStartMinutes") or 0) < closes_at
                and int(entry.get("latestEndMinutes") or 0) >= closes_at
            ]
            if len(opening_candidates) != 1 or len(closing_candidates) != 1:
                continue
            employee = opening_candidates[0]
            if str(employee.get("id")) != str(closing_candidates[0].get("id")):
                continue

            span = closes_at - opens_at
            required = span
            split_possible = (
                bool(split_rules.get("splitShiftAllowed"))
                and bool(employee.get("canSplitShift"))
                and int(split_rules.get("maximumSplitsPerDay") or 1) >= 1
            )
            if split_possible:
                maximum_gap_value = split_rules.get("maximumSplitMinutes")
                maximum_gap = (
                    int(maximum_gap_value)
                    if maximum_gap_value is not None
                    else max(0, span - 2 * minimum_segment)
                )
                split_minimum = max(2 * minimum_segment, span - maximum_gap)
                required = min(span, split_minimum)
            elif span > continuous_cap:
                # The structural preflight reports this impossibility. Keeping
                # the full span here also prevents a misleading short-duration
                # allocation if this helper is called on its own.
                required = span

            required = -(-required // step) * step
            key = (str(employee.get("id")), date)
            forced[key] = max(forced.get(key, 0), required)

    return forced


def build_allocation_model(problem: dict[str, Any]) -> AllocationModel:
    step = int(problem["timeStepMinutes"])
    rules = problem["rules"]
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    entries = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }
    forced_role_minimums = _forced_sector_role_minimums(
        problem, employees, entries, step
    )

    cells: list[tuple[Cell | None, ...]] = []
    for employee_index, employee in enumerate(employees):
        row: list[Cell | None] = []
        for day_index, day in enumerate(days):
            entry = entries.get((str(employee["id"]), day["date"]))
            if entry is None or not entry["available"]:
                row.append(None)
                continue
            ceiling = _daily_ceiling(employee, entry, rules)
            minimum = max(
                int(employee["minimumDailyMinutes"]),
                int(rules["minimumShiftMinutes"]),
                forced_role_minimums.get((str(employee["id"]), day["date"]), 0),
            )
            minimum = -(-minimum // step) * step
            continuous = int(rules.get("maximumContinuousMinutes") or ceiling)
            row.append(
                Cell(
                    employee_index=employee_index,
                    day_index=day_index,
                    minimum=minimum,
                    maximum=(ceiling // step) * step,
                    continuous_maximum=min(ceiling, continuous),
                    mandatory=(
                        bool(entry.get("mandatory"))
                        or (str(employee["id"]), day["date"])
                        in forced_role_minimums
                    ),
                )
            )
        cells.append(tuple(row))

    return AllocationModel(
        employees=tuple(str(e["id"]) for e in employees),
        dates=tuple(d["date"] for d in days),
        cells=tuple(cells),
        step=step,
    )


def solve_allocation(
    problem: dict[str, Any],
    model: AllocationModel,
    *,
    time_limit: float,
    weights: dict[tuple[int, int], float] | None = None,
    even_weight: float = 1.0,
    origin: str = "milp",
) -> AllocationSolveResult:
    """Run the allocation MILP and preserve its proof-bearing solver status.

    `weights` is what makes several FAMILIES out of one model. The feasible set
    never changes — contracts stay exact and targets stay soft either way — so every family
    returns a legal allocation; they differ only in which legal one they prefer.

    A weight is a per-cell reward on minutes: give an employee more of a day's
    budget because they can open it, because their window spans its peak, or
    because the last placement fell short exactly there. `even_weight` scales
    the L1 pull toward a regular week, which is worth having and worth being
    able to switch off — a regular week is precisely the wrong shape for a
    demand profile with peaks, and the earlier engine could not express anything
    else.
    """
    step = model.step
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])

    # One integer column per available cell, counted in STEPS rather than
    # minutes: the step multiple then holds by construction instead of needing a
    # divisibility constraint the solver would have to discover.
    columns: dict[tuple[int, int], int] = {}
    for employee_index in range(len(employees)):
        for day_index in range(len(days)):
            if model.cell(employee_index, day_index) is not None:
                columns[(employee_index, day_index)] = len(columns)

    if not columns:
        # No variables is an empty model, not a solver proof.  Structural
        # validation normally catches it before this point; preserving the
        # distinction here keeps this function honest when called directly.
        return AllocationSolveResult(allocation=None, solver_status=4)

    # A second column per splittable cell: how many steps above the continuous
    # cap it goes. Linked below, and the only thing the objective really cares
    # about.
    overflow: dict[tuple[int, int], int] = {}
    for key, _ in columns.items():
        cell = model.cell(*key)
        assert cell is not None
        if cell.maximum > cell.continuous_maximum:
            overflow[key] = len(columns) + len(overflow)

    # One deviation column per cell: how far it sits from an even share of the
    # employee's week, in steps.
    #
    # It needs its own variable. An earlier version put `-target` straight on
    # the minute column, which looks like a pull toward the target and is in
    # fact a NO-OP: the row sum is already fixed, so that term contributes
    # `-target × contract` whatever the distribution. The objective had exactly
    # one active term — the split penalty — and HiGHS returned an arbitrary
    # vertex, which on Drive meant most cells pinned at their 480 ceiling. Long
    # rigid shifts have few legal starts and overshoot every peak, so the
    # placement could never reach zero.
    deviation: dict[tuple[int, int], int] = {}
    for key in columns:
        deviation[key] = len(columns) + len(overflow) + len(deviation)

    works: dict[tuple[int, int], int] = {}
    for key in columns:
        cell = model.cell(*key)
        assert cell is not None
        if not cell.mandatory:
            works[key] = len(columns) + len(overflow) + len(deviation) + len(works)

    day_deviation: dict[int, int] = {}
    for day_index, day in enumerate(days):
        if day.get("budgetMode", "exact") == "target":
            day_deviation[day_index] = (
                len(columns) + len(overflow) + len(deviation) + len(works) + len(day_deviation)
            )

    total = len(columns) + len(overflow) + len(deviation) + len(works) + len(day_deviation)

    rows: list[int] = []
    cols: list[int] = []
    values: list[float] = []
    lower: list[float] = []
    upper: list[float] = []

    def add(coefficients: dict[int, float], lb: float, ub: float) -> None:
        row = len(lower)
        for column, value in coefficients.items():
            if value:
                rows.append(row)
                cols.append(column)
                values.append(float(value))
        lower.append(lb)
        upper.append(ub)

    for employee_index, employee in enumerate(employees):
        contract = int(employee["contractMinutes"])
        coefficients = {
            column: 1.0
            for (index, _day), column in columns.items()
            if index == employee_index
        }
        add(coefficients, contract / step, contract / step)

    for day_index, day in enumerate(days):
        budget = int(day["budgetMinutes"])
        coefficients = {
            column: 1.0
            for (_employee, index), column in columns.items()
            if index == day_index
        }
        if day_index not in day_deviation:
            add(coefficients, budget / step, budget / step)
        else:
            dev = day_deviation[day_index]
            add({**coefficients, dev: -1.0}, -np.inf, budget / step)
            add({column: -value for column, value in coefficients.items()} | {dev: -1.0}, -np.inf, -budget / step)

    # overflow ≥ minutes − continuousCap, in steps. The objective pushes it down,
    # so it settles at exactly the excess.
    for key, column in overflow.items():
        cell = model.cell(*key)
        assert cell is not None
        add({columns[key]: 1.0, column: -1.0}, -np.inf, cell.continuous_maximum / step)

    # Optional day: either zero, or a complete legal shift. Mandatory days keep
    # the historical positive lower bound and need no binary.
    for key, work_column in works.items():
        cell = model.cell(*key)
        assert cell is not None
        minute_column = columns[key]
        add({minute_column: 1.0, work_column: -cell.maximum / step}, -np.inf, 0.0)
        add({minute_column: 1.0, work_column: -cell.minimum / step}, 0.0, np.inf)

    lower_bounds = np.zeros(total)
    upper_bounds = np.zeros(total)
    objective = np.zeros(total)

    for key, column in columns.items():
        cell = model.cell(*key)
        assert cell is not None
        lower_bounds[column] = cell.minimum / step if cell.mandatory else 0.0
        upper_bounds[column] = cell.maximum / step

    for column in works.values():
        upper_bounds[column] = 1.0

    for day_index, column in day_deviation.items():
        maximum = sum(
            model.cell(employee_index, day_index).maximum
            for employee_index in range(len(employees))
            if model.cell(employee_index, day_index) is not None
        )
        upper_bounds[column] = (maximum + int(days[day_index]["budgetMinutes"])) / step + 1.0
        # A target matters, but coverage-oriented families may move minutes to
        # another day when that produces a genuinely better week.
        objective[column] = 2.0

    # |m − target|, as two inequalities per cell. Minimised, so the deviation
    # column settles at exactly the absolute gap.
    for employee_index, employee in enumerate(employees):
        worked = sum(1 for (e, _d) in columns if e == employee_index) or 1
        target = int(employee["contractMinutes"]) / worked / step
        for key, column in columns.items():
            if key[0] != employee_index:
                continue
            dev = deviation[key]
            add({column: 1.0, dev: -1.0}, -np.inf, target)
            add({column: -1.0, dev: -1.0}, -np.inf, -target)
            cell = model.cell(*key)
            assert cell is not None
            # Generous on purpose: a bound tight against a fractional target
            # would be rounded down by integrality and make the model infeasible
            # for a reason that has nothing to do with the week.
            upper_bounds[dev] = (
                max(abs(cell.maximum / step - target), abs(cell.minimum / step - target)) + 1.0
            )
            objective[dev] = even_weight

    # The family's own preference: reward minutes on the cells it favours.
    # Scaled below the split penalty so a preference can never buy a forced
    # split, and above the evenness term so a family that wants an uneven week
    # gets one.
    if weights:
        for key, weight in weights.items():
            column = columns.get(key)
            if column is not None:
                objective[column] -= weight * 10.0

    for key, column in overflow.items():
        cell = model.cell(*key)
        assert cell is not None
        upper_bounds[column] = (cell.maximum - cell.continuous_maximum) / step
        # Heavy: a forced split must never be bought by a smoother week.
        objective[column] = 1_000.0

    # Minutes and overflow are integers; the deviation columns are continuous —
    # they only measure a distance, and forcing them integer would round a
    # fractional target and blur the very thing they exist to compare.
    integrality = np.ones(total, dtype=np.int8)
    for column in deviation.values():
        integrality[column] = 0
    for column in day_deviation.values():
        integrality[column] = 0

    result = milp(
        objective,
        integrality=integrality,
        bounds=Bounds(lower_bounds, upper_bounds),
        constraints=LinearConstraint(
            coo_matrix((values, (rows, cols)), shape=(len(lower), total)).tocsr(),
            np.array(lower),
            np.array(upper),
        ),
        options={"time_limit": float(time_limit), "mip_rel_gap": 0.0},
    )

    if result.x is None:
        return AllocationSolveResult(
            allocation=None,
            solver_status=int(result.status),
        )

    minutes = [[0] * len(days) for _ in employees]
    for (employee_index, day_index), column in columns.items():
        minutes[employee_index][day_index] = int(round(result.x[column])) * step

    return AllocationSolveResult(
        allocation=Allocation(
            minutes=tuple(tuple(row) for row in minutes),
            origin=origin,
        ),
        solver_status=int(result.status),
    )


def solve_polarised(
    problem: dict[str, Any],
    model: AllocationModel,
    *,
    time_limit: float,
    mode: str,
    origin: str,
    cell_priority: dict[tuple[int, int], float] | None = None,
    critical_days: frozenset[int] = frozenset(),
) -> Allocation | None:
    """A root that refuses the middle.

    The plain MILP pulls every cell toward an even share, and an even week is
    the wrong shape for a demand profile with peaks: five identical shifts
    cannot put three people at noon and one at nine. The oracle's Drive
    allocation is visibly polarised — several cells sitting at the 240-minute
    minimum so that others can reach 600 — and no amount of 2×2 nudging from a
    regular week reaches that in a reasonable budget.

    So this model gives every cell a binary "carries load today":

        m[e][d] ≤ minimum + (ceiling − minimum) · h[e][d]

    With ``h = 0`` the cell is pinned at its minimum; with ``h = 1`` it is free
    up to its ceiling. Nothing in between is expressed, which is the point —
    the objective then only has to say how many cells carry load, and where.

    Modes, all generic — no employee and no weekday is named anywhere:

    ``concentrate``   fewest carriers per day; the rest sit at their minimum.
    ``spread``        the opposite, for the days where breadth beats depth.
    ``parity``        a fixed alternation, giving a reproducible extreme that
                      neither of the other two produces.
    ``weighted``      carriers chosen by ``cell_priority`` — used to favour the
                      people who offer the most legal starts, since a cell with
                      more possible starts is worth more to the placement.
    ``critical``      concentrate only on the days named critical, leave the
                      others free. Different days want different shapes.
    """
    step = model.step
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])

    columns: dict[tuple[int, int], int] = {}
    for employee_index in range(len(employees)):
        for day_index in range(len(days)):
            if model.cell(employee_index, day_index) is not None:
                columns[(employee_index, day_index)] = len(columns)
    if not columns:
        return None

    carriers = {key: len(columns) + offset for offset, key in enumerate(sorted(columns))}
    overflow: dict[tuple[int, int], int] = {}
    for key in sorted(columns):
        cell = model.cell(*key)
        assert cell is not None
        if cell.maximum > cell.continuous_maximum:
            overflow[key] = len(columns) + len(carriers) + len(overflow)

    total = len(columns) + len(carriers) + len(overflow)

    rows: list[int] = []
    cols: list[int] = []
    values: list[float] = []
    lower: list[float] = []
    upper: list[float] = []

    def add(coefficients: dict[int, float], lb: float, ub: float) -> None:
        row = len(lower)
        for column, value in coefficients.items():
            if value:
                rows.append(row)
                cols.append(column)
                values.append(float(value))
        lower.append(lb)
        upper.append(ub)

    for employee_index, employee in enumerate(employees):
        contract = int(employee["contractMinutes"])
        add(
            {c: 1.0 for (e, _d), c in columns.items() if e == employee_index},
            contract / step,
            contract / step,
        )
    for day_index, day in enumerate(days):
        budget = int(day["budgetMinutes"])
        add(
            {c: 1.0 for (_e, d), c in columns.items() if d == day_index},
            budget / step,
            budget / step,
        )

    lower_bounds = np.zeros(total)
    upper_bounds = np.zeros(total)
    objective = np.zeros(total)

    for key, column in columns.items():
        cell = model.cell(*key)
        assert cell is not None
        lower_bounds[column] = cell.minimum / step
        upper_bounds[column] = cell.maximum / step

        carrier = carriers[key]
        upper_bounds[carrier] = 1.0
        span = (cell.maximum - cell.minimum) / step
        # m − span·h ≤ minimum : h = 0 pins the cell at its minimum.
        add({column: 1.0, carrier: -span}, -np.inf, cell.minimum / step)

        day_index = key[1]
        if mode == "concentrate":
            objective[carrier] = 1.0
        elif mode == "spread":
            objective[carrier] = -1.0
        elif mode == "parity":
            objective[carrier] = 1.0 if (key[0] + day_index) % 2 == 0 else -1.0
        elif mode == "weighted":
            objective[carrier] = -float((cell_priority or {}).get(key, 0.0))
        elif mode == "critical":
            objective[carrier] = 1.0 if day_index in critical_days else -0.5

    for key, column in overflow.items():
        cell = model.cell(*key)
        assert cell is not None
        upper_bounds[column] = (cell.maximum - cell.continuous_maximum) / step
        add({columns[key]: 1.0, column: -1.0}, -np.inf, cell.continuous_maximum / step)
        # Still the heaviest term: a forced split may never be bought by shape.
        objective[column] = 1_000.0

    integrality = np.ones(total, dtype=np.int8)
    result = milp(
        objective,
        integrality=integrality,
        bounds=Bounds(lower_bounds, upper_bounds),
        constraints=LinearConstraint(
            coo_matrix((values, (rows, cols)), shape=(len(lower), total)).tocsr(),
            np.array(lower),
            np.array(upper),
        ),
        options={"time_limit": float(time_limit), "mip_rel_gap": 0.0},
    )
    if result.x is None:
        return None

    minutes = [[0] * len(days) for _ in employees]
    for (employee_index, day_index), column in columns.items():
        minutes[employee_index][day_index] = int(round(result.x[column])) * step
    return Allocation(minutes=tuple(tuple(row) for row in minutes), origin=origin)


def repair_large_neighbourhood(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    free_days: list[int],
    *,
    time_limit: float,
    variants: int = 4,
    deadline: float | None = None,
) -> list[Allocation]:
    """Free a few whole days at once and re-allocate them.

    A 2×2 swap moves minutes around one rectangle. Reaching a differently
    shaped week that way takes many successive swaps, each of which must
    improve on its own to be kept — so a transformation that only pays off once
    complete is unreachable. Measured on Drive: the improvement chain climbed in
    fifteen-minute steps and stalled two slots short.

    This releases EVERY employee's minutes on the chosen days simultaneously and
    re-solves them together. Both invariants are preserved by construction
    rather than repaired afterwards:

    - each day still receives exactly its budget, because the column sums are
      re-imposed;
    - each employee still owes exactly their contract, because the sum of what
      they had on those days is re-imposed as their sub-total — the untouched
      days keep whatever they had.

    Several diversified answers are returned, not one: the point is to offer the
    placement genuinely different shapes for the same days, and only the real
    score after placement decides between them.
    """
    step = model.step
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    chosen = sorted(set(free_days))
    if not chosen:
        return []

    columns: dict[tuple[int, int], int] = {}
    for employee_index in range(len(employees)):
        for day_index in chosen:
            if model.cell(employee_index, day_index) is not None:
                columns[(employee_index, day_index)] = len(columns)
    if not columns:
        return []

    carriers = {key: len(columns) + offset for offset, key in enumerate(sorted(columns))}
    total = len(columns) + len(carriers)

    rows: list[int] = []
    cols: list[int] = []
    values: list[float] = []
    lower: list[float] = []
    upper: list[float] = []

    def add(coefficients: dict[int, float], lb: float, ub: float) -> None:
        row = len(lower)
        for column, value in coefficients.items():
            if value:
                rows.append(row)
                cols.append(column)
                values.append(float(value))
        lower.append(lb)
        upper.append(ub)

    # Column sums: each freed day keeps its exact budget.
    for day_index in chosen:
        budget = int(days[day_index]["budgetMinutes"])
        add({c: 1.0 for (_e, d), c in columns.items() if d == day_index}, budget / step, budget / step)

    # Row sub-sums: each employee keeps exactly what they had across these days,
    # so the untouched part of their week still adds up to their contract.
    for employee_index in range(len(employees)):
        subtotal = sum(allocation.minutes[employee_index][d] for d in chosen)
        keys = [key for key in columns if key[0] == employee_index]
        if not keys:
            if subtotal != 0:
                return []
            continue
        add({columns[key]: 1.0 for key in keys}, subtotal / step, subtotal / step)

    lower_bounds = np.zeros(total)
    upper_bounds = np.zeros(total)
    for key, column in columns.items():
        cell = model.cell(*key)
        assert cell is not None
        lower_bounds[column] = cell.minimum / step
        # The FULL ceiling, not the continuous one. Capping at the continuous
        # limit silently forbids splits on the freed days, and an anchor whose
        # splitter already worked past it then has an unreachable row sub-total:
        # the local MILP returns nothing and the whole neighbourhood is skipped
        # without saying why.
        upper_bounds[column] = cell.maximum / step
        carrier = carriers[key]
        upper_bounds[carrier] = 1.0
        span = (cell.maximum - cell.minimum) / step
        add({column: 1.0, carrier: -span}, -np.inf, cell.minimum / step)

    integrality = np.ones(total, dtype=np.int8)
    constraint = LinearConstraint(
        coo_matrix((values, (rows, cols)), shape=(len(lower), total)).tocsr(),
        np.array(lower),
        np.array(upper),
    )

    # Four deterministic shapes for the same freed days.
    shapes: list[tuple[str, dict[int, float]]] = []
    for name, sign in (("concentrate", 1.0), ("spread", -1.0)):
        shapes.append((name, {carriers[key]: sign for key in columns}))
    shapes.append(
        ("parity", {carriers[key]: (1.0 if (key[0] + key[1]) % 2 == 0 else -1.0) for key in columns})
    )
    shapes.append(
        ("front-loaded", {carriers[key]: float(key[1] - min(chosen) + 1) for key in columns})
    )

    produced: list[Allocation] = []
    seen: set[str] = {allocation.signature()}
    label = "+".join(days[d]["date"][-5:] for d in chosen)

    for name, coefficients in shapes[:variants]:
        if deadline is not None and time.perf_counter() >= deadline:
            break
        objective = np.zeros(total)
        for column, value in coefficients.items():
            objective[column] = value
        solver_limit = float(time_limit)
        if deadline is not None:
            solver_limit = min(
                solver_limit,
                max(0.05, deadline - time.perf_counter()),
            )
        result = milp(
            objective,
            integrality=integrality,
            bounds=Bounds(lower_bounds, upper_bounds),
            constraints=constraint,
            options={"time_limit": solver_limit, "mip_rel_gap": 0.0},
        )
        if result.x is None:
            continue
        minutes = [list(row) for row in allocation.minutes]
        for (employee_index, day_index), column in columns.items():
            minutes[employee_index][day_index] = int(round(result.x[column])) * step
        candidate = Allocation(
            minutes=tuple(tuple(row) for row in minutes),
            origin=f"lns[{label}/{name}]",
        )
        signature = candidate.signature()
        if signature not in seen:
            seen.add(signature)
            produced.append(candidate)

    return produced


def build_families(
    problem: dict[str, Any],
    model: AllocationModel,
    demand: Any,
    *,
    short_days: frozenset[int] = frozenset(),
) -> list[tuple[str, dict[tuple[int, int], float] | None, float]]:
    """The deterministic allocation families, as ``(name, weights, evenWeight)``.

    Seven ways of answering "who works how long", each a defensible reading of
    the same week:

    - **even-individual** — a regular week for everyone. The safe default, and
      the wrong shape whenever demand has peaks.
    - **coverage-profile** — minutes to whoever's window overlaps the demand.
    - **opening-priority** / **closing-priority** — minutes to the people who
      can hold the two boundaries, so the placement is not forced to spend a
      short shift on them.
    - **hardest-peaks** — minutes weighted by the tallest moments a person can
      actually reach.
    - **duration-diversity** — deliberately uneven, because covering three
      simultaneous people at noon needs shifts of different lengths, not five
      identical ones.
    - **deficit-guided** — minutes to whoever could have covered what the last
      placement missed. Only available once something has been placed.
    """
    step = model.step
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    entries = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }

    def window(employee_index: int, day_index: int) -> tuple[int, int] | None:
        entry = entries.get((str(employees[employee_index]["id"]), days[day_index]["date"]))
        if entry is None or not entry["available"]:
            return None
        return int(entry["earliestStartMinutes"]), int(entry["latestEndMinutes"])

    def intervals_of(day_index: int) -> list[tuple[int, int]]:
        """``(start, adaptedTarget)`` for one day."""
        day = demand.days.get(days[day_index]["date"])
        if day is None:
            return []
        return [(interval.start, interval.adapted_target) for interval in day.intervals]

    coverage: dict[tuple[int, int], float] = {}
    peaks: dict[tuple[int, int], float] = {}
    opening: dict[tuple[int, int], float] = {}
    closing: dict[tuple[int, int], float] = {}
    diversity: dict[tuple[int, int], float] = {}
    guided: dict[tuple[int, int], float] = {}

    for day_index, day in enumerate(days):
        opens_at = int(day["opensAtMinutes"])
        closes_at = int(day["closesAtMinutes"])
        profile = intervals_of(day_index)
        peak = max((target for _s, target in profile), default=0)

        for employee_index, employee in enumerate(employees):
            key = (employee_index, day_index)
            bounds = window(employee_index, day_index)
            if bounds is None:
                continue
            earliest, latest = bounds

            inside = [
                (start, target) for start, target in profile if earliest <= start < latest
            ]
            coverage[key] = sum(target for _s, target in inside) / max(1, len(profile))
            peaks[key] = sum(
                target for _s, target in inside if target >= peak and peak > 0
            ) / max(1, len(profile))

            if employee["canOpen"] and earliest <= opens_at:
                opening[key] = 1.0
            if employee["canClose"] and latest >= closes_at:
                closing[key] = 1.0

            # Deliberately uneven, by a fixed parity so it stays reproducible.
            diversity[key] = 1.0 if (employee_index + day_index) % 2 == 0 else -1.0

            if day_index in short_days:
                guided[key] = coverage[key] + 1.0

    families: list[tuple[str, dict[tuple[int, int], float] | None, float]] = [
        ("even-individual", None, 1.0),
        ("coverage-profile", coverage, 0.25),
        ("opening-priority", opening, 0.5),
        ("closing-priority", closing, 0.5),
        ("hardest-peaks", peaks, 0.25),
        ("duration-diversity", diversity, 0.0),
    ]
    if short_days:
        families.append(("deficit-guided", guided, 0.1))
    return families


def score_allocation(
    problem: dict[str, Any], model: AllocationModel, demand: Any, allocation: Allocation
) -> tuple[int, ...]:
    """What an allocation is worth, BEFORE any skeleton or placement.

    A lexicographic tuple, in the order the brief fixes. Every term is computed
    from the allocation and the problem alone — no skeleton, no MILP — so
    ranking a dozen candidates costs milliseconds.

    1. **peak reachability** — people short of the tallest moment of each day,
       counting only those whose window AND duration can actually span it;
    2. **boundary reachability** — openings and closings the day cannot field;
    3. **rigidity** — cells pinned at the continuous ceiling. A long shift has
       few legal starts and overshoots every peak, which is how an allocation
       that looks generous places badly;
    4. **start freedom** — total legal starts across the week, negated so more
       is better. The closest cheap proxy for "can the placement manoeuvre";
    5. **duration variety** — negated count of distinct durations, because
       covering three people at noon needs different lengths, not five equal
       ones;
    6. **individual deviation** — last, exactly as the brief orders.
    """
    step = model.step
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    entries = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }
    rules = problem["rules"]
    continuous = int(rules.get("maximumContinuousMinutes") or rules["maximumShiftMinutes"])

    peak_short = 0
    boundary_short = 0
    rigid = 0
    starts = 0
    durations: set[int] = set()
    deviation = 0

    for day_index, day in enumerate(days):
        opens_at = int(day["opensAtMinutes"])
        closes_at = int(day["closesAtMinutes"])
        day_demand = demand.days.get(day["date"])

        peak_target = 0
        peak_span: tuple[int, int] | None = None
        if day_demand is not None:
            for interval in day_demand.intervals:
                if interval.adapted_target > peak_target:
                    peak_target = interval.adapted_target
                    peak_span = (interval.start, interval.end)

        reach_peak = 0
        can_open = 0
        can_close = 0

        for employee_index, employee in enumerate(employees):
            minutes = allocation.minutes[employee_index][day_index]
            if minutes <= 0:
                continue
            entry = entries[(str(employee["id"]), day["date"])]
            earliest = int(entry["earliestStartMinutes"])
            latest = int(entry["latestEndMinutes"])
            durations.add(minutes)
            starts += max(0, (latest - minutes - earliest) // step + 1)
            if minutes >= continuous:
                rigid += 1

            if peak_span is not None:
                low, high = peak_span
                # Can a shift of exactly this length, inside this window, span
                # the peak at all?
                if earliest <= low and latest >= high and minutes >= (high - low):
                    reach_peak += 1
            if employee["canOpen"] and earliest <= opens_at and opens_at + minutes <= latest:
                can_open += 1
            if employee["canClose"] and latest >= closes_at and closes_at - minutes >= earliest:
                can_close += 1

        peak_short += max(0, peak_target - reach_peak)
        opening_demand = int(rules["minimumOpeningsPerDay"])
        if day_demand is not None:
            for interval in day_demand.intervals:
                if interval.start == opens_at:
                    opening_demand = max(opening_demand, interval.adapted_target)
        boundary_short += max(0, opening_demand - can_open)
        boundary_short += max(0, int(rules["exactClosingsPerDay"]) - can_close)

    for employee_index, employee in enumerate(employees):
        worked = [m for m in allocation.minutes[employee_index] if m > 0]
        if not worked:
            continue
        target = int(employee["contractMinutes"]) / len(worked)
        deviation += int(sum(abs(m - target) for m in worked))

    return (peak_short, boundary_short, rigid, -starts, -len(durations), deviation)


def swap_neighbours(
    allocation: Allocation,
    model: AllocationModel,
    *,
    limit: int,
    priority_days: frozenset[int] = frozenset(),
    deltas: tuple[int, ...] | None = None,
) -> Iterator[Allocation]:
    """Step 6 — 2×2 exchanges.

    Move ``δ`` minutes around a rectangle::

        m[e1][d1] −= δ     m[e1][d2] += δ
        m[e2][d1] += δ     m[e2][d2] −= δ

    Row and column sums are untouched by construction, so every neighbour is
    still a valid allocation: contracts and budgets stay exact without being
    re-solved. That is what makes this the right neighbourhood — a move that had
    to repair the sums afterwards would spend more time than the MILP it is
    trying to avoid.

    Note what a 2×2 swap can and cannot do. It never moves minutes BETWEEN days
    — both column sums are preserved — so it cannot make a short day longer.
    What it changes is WHO works those minutes, and that is exactly the lever
    coverage needs: two employees with different windows, roles and rest
    histories cover very different hours with the same duration.

    `priority_days` is where the last placement fell short. Swaps touching one
    of those days are yielded FIRST, because a blind enumeration spends its
    budget rearranging days that were already fine. Ordering only — every
    neighbour is still reachable, and the sequence is fixed, so two runs explore
    identically.
    """
    minutes = [list(row) for row in allocation.minutes]
    employee_count = len(minutes)
    day_count = len(minutes[0]) if minutes else 0
    step = model.step
    produced = 0

    day_pairs = [
        (d1, d2)
        for d1 in range(day_count)
        for d2 in range(d1 + 1, day_count)
    ]
    day_pairs.sort(
        key=lambda pair: (
            0 if (pair[0] in priority_days or pair[1] in priority_days) else 1,
            pair,
        )
    )

    # Deltas from one step up to eight. The small ones fine-tune a day's split
    # between two people; the large ones are what actually reshapes a week the
    # allocation MILP made too uniform — its objective rewards even days, and an
    # even week is precisely the wrong shape for a demand profile with peaks.
    # Up to sixteen steps — four hours. The measured improvement chain on Drive
    # climbed monotonically with the size of the move (+15, +30, +45, +60…),
    # which says the allocation MILP's answer is not a local perturbation away
    # from a good one: it is a differently SHAPED week. Small deltas alone would
    # never cross that distance.
    # Overridable, because the right size of move depends on how the allocation
    # was chosen. One conditioned on a skeleton is already aimed at the demand
    # and needs a nudge; one chosen blind by a shape proxy is a differently
    # SHAPED week and needs a shove.
    if deltas is None:
        deltas = tuple(step * multiple for multiple in (1, 2, 3, 4, 6, 8, 10, 12, 16))

    for d1, d2 in day_pairs:
        for e1 in range(employee_count):
            for e2 in range(e1 + 1, employee_count):
                cells = [
                    model.cell(e1, d1),
                    model.cell(e1, d2),
                    model.cell(e2, d1),
                    model.cell(e2, d2),
                ]
                if any(cell is None for cell in cells):
                    continue

                for delta in deltas:
                    for sign in (1, -1):
                        move = delta * sign
                        candidate = [
                            minutes[e1][d1] - move,
                            minutes[e1][d2] + move,
                            minutes[e2][d1] + move,
                            minutes[e2][d2] - move,
                        ]
                        if any(
                            value < cell.minimum or value > cell.maximum
                            for value, cell in zip(candidate, cells)
                            if cell is not None
                        ):
                            continue

                        neighbour = [list(row) for row in minutes]
                        neighbour[e1][d1] = candidate[0]
                        neighbour[e1][d2] = candidate[1]
                        neighbour[e2][d1] = candidate[2]
                        neighbour[e2][d2] = candidate[3]

                        yield Allocation(
                            minutes=tuple(tuple(row) for row in neighbour),
                            origin=f"swap({model.employees[e1]}/{model.employees[e2]}"
                            f"@{model.dates[d1]}/{model.dates[d2]}{move:+d})",
                        )
                        produced += 1
                        if produced >= limit:
                            return
