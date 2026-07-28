"""Coverage variables and constraints — the corrected semantics.

Split out of :mod:`shiftos_highs.solver` because it is the part that was WRONG,
and the part most likely to be argued about again. Keeping it in one file means
the rule can be read, and disputed, without reading a model builder.

What changed
------------
The parity milestone imposed ``requiredEmployees`` as a HARD lower bound on every
atomic interval. That is not the ShiftOS contract, and it fails in the direction
that matters: a week the team cannot fully cover comes back ``infeasible``, when
the truthful answer is a legal schedule with a measured shortfall. A manager
whose shop can open does not want to be told it cannot.

The corrected semantics has three layers:

``hardMinimumEmployees``
    a hard lower bound. Breaking it is not a worse schedule, it is no schedule.

adapted target (from :mod:`shiftos_highs.demand`)
    a soft goal. Falling short of it costs deficit, which the objective
    minimises — it never makes the model infeasible.

everything above the adapted target
    surplus presence. Not demand, not a target, and never counted as either. It
    still has to be placed, because contracts and budgets are exact.

Under-covered slots
-------------------
``underCoveredSlots`` keeps the OFFICIAL meaning: a business slot is
under-covered when at least one of its atomic intervals is short. It is not the
count of short intervals, and not a sum of minutes. Counting it needs one binary
per slot, forced on by any deficit inside it — which is why the model carries
them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .demand import DemandModel


@dataclass(frozen=True, slots=True)
class AtomicInterval:
    date: str
    start: int
    end: int
    hard_minimum: int
    adapted_target: int
    reference_required: int
    #: Index of the business slot this interval belongs to, for the slot binary.
    slot_indexes: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class CoverageLayout:
    """Where every coverage variable lives in the MILP column vector."""

    candidate_count: int
    intervals: tuple[AtomicInterval, ...]
    slot_ids: tuple[str, ...]
    step: int

    @property
    def deficit_offset(self) -> int:
        return self.candidate_count

    @property
    def slot_offset(self) -> int:
        return self.candidate_count + len(self.intervals)

    @property
    def total_columns(self) -> int:
        return self.slot_offset + len(self.slot_ids)

    def deficit_column(self, interval_index: int) -> int:
        return self.deficit_offset + interval_index

    def slot_column(self, slot_index: int) -> int:
        return self.slot_offset + slot_index


def build_coverage_layout(
    problem: dict[str, Any], demand: DemandModel, candidate_count: int
) -> CoverageLayout:
    """Materialise the atomic intervals and their business-slot membership.

    Intervals come from the demand model, so the adapted target is whatever the
    rescaling decided — the raw ``requiredEmployees`` never reaches the model.
    """
    step = int(problem["timeStepMinutes"])

    slot_ids: list[str] = []
    slot_index_by_id: dict[str, int] = {}
    for slot in sorted(
        problem["demandSlots"], key=lambda item: (item["date"], item["startMinutes"], item["id"])
    ):
        slot_index_by_id[slot["id"]] = len(slot_ids)
        slot_ids.append(slot["id"])

    # Which slots cover which atomic interval. A minute may sit in several.
    membership: dict[tuple[str, int], list[int]] = {}
    for slot in problem["demandSlots"]:
        index = slot_index_by_id[slot["id"]]
        for start in range(int(slot["startMinutes"]), int(slot["endMinutes"]), step):
            membership.setdefault((slot["date"], start), []).append(index)

    intervals: list[AtomicInterval] = []
    for date in sorted(demand.days):
        for interval in demand.days[date].intervals:
            intervals.append(
                AtomicInterval(
                    date=date,
                    start=interval.start,
                    end=interval.end,
                    hard_minimum=interval.hard_minimum,
                    adapted_target=interval.adapted_target,
                    reference_required=interval.reference_required,
                    slot_indexes=tuple(sorted(membership.get((date, interval.start), []))),
                )
            )

    return CoverageLayout(
        candidate_count=candidate_count,
        intervals=tuple(intervals),
        slot_ids=tuple(slot_ids),
        step=step,
    )


def coverage_rows(
    layout: CoverageLayout,
    covering_candidates: dict[tuple[str, int], list[int]],
) -> list[tuple[dict[int, float], float, float]]:
    """The coverage constraints, as ``(coefficients, lower, upper)`` rows.

    Three families, and the difference between them is the whole correction:

    1. **hard floor** — ``Σ x ≥ hardMinimum``. No slack variable exists, so the
       model is infeasible when it cannot be met. That is intended: an
       unreachable floor is a day that cannot open, not a day to apologise for.
    2. **adapted target** — ``Σ x + deficit ≥ adaptedTarget``. The deficit
       variable is what turns a shortfall into a measurement instead of a
       contradiction.
    3. **slot linkage** — ``deficit ≤ adaptedTarget × z_slot``. Forces the
       slot's binary on as soon as any interval inside it is short, which is the
       official definition of an under-covered slot.
    """
    rows: list[tuple[dict[int, float], float, float]] = []
    infinity = float("inf")

    for index, interval in enumerate(layout.intervals):
        columns = covering_candidates.get((interval.date, interval.start), [])
        presence = {column: 1.0 for column in columns}

        if interval.hard_minimum > 0:
            rows.append((dict(presence), float(interval.hard_minimum), infinity))

        if interval.adapted_target > interval.hard_minimum:
            with_deficit = dict(presence)
            with_deficit[layout.deficit_column(index)] = 1.0
            rows.append((with_deficit, float(interval.adapted_target), infinity))

        # `deficit - target * z ≤ 0`, one row per slot the interval belongs to.
        for slot_index in interval.slot_indexes:
            if interval.adapted_target <= 0:
                continue
            rows.append(
                (
                    {
                        layout.deficit_column(index): 1.0,
                        layout.slot_column(slot_index): -float(interval.adapted_target),
                    },
                    -infinity,
                    0.0,
                )
            )

    return rows


def under_covered_slots_objective(layout: CoverageLayout) -> dict[int, float]:
    """Pass 1 — how many business slots are short. Never a sum of minutes."""
    return {layout.slot_column(index): 1.0 for index in range(len(layout.slot_ids))}


def deficit_minutes_objective(layout: CoverageLayout) -> dict[int, float]:
    """Pass 2 — employee-minutes missing, summed over atomic intervals."""
    return {
        layout.deficit_column(index): float(layout.step)
        for index in range(len(layout.intervals))
    }


def business_cost_objective(
    layout: CoverageLayout, budget_by_date: dict[str, int]
) -> dict[int, float]:
    """Pass 3 — deficit weighted by the day it falls on.

    Same definition the CP-SAT reference used: missing minutes multiplied by the
    day's budget, so a shortfall on a heavy day outranks the same shortfall on a
    quiet one.
    """
    return {
        layout.deficit_column(index): float(layout.step) * float(budget_by_date.get(interval.date, 0))
        for index, interval in enumerate(layout.intervals)
    }
