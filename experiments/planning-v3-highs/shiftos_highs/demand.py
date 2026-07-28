"""Adaptive demand rescaling.

A PURE module. It reads a ``PlanningProblemV3`` and returns numbers; it builds no
model, calls no solver and imports nothing from :mod:`shiftos_highs.solver`. That
separation is deliberate — the rescaling is a business rule about what the day
*should* look like, and it has to be testable, and wrong-able, on its own.

Why it exists
-------------
``requiredEmployees`` is a NORMAL-DAY figure: it describes the shape of a busy
Saturday with everyone present. Feed it unchanged to a solver on a week with two
people off sick and the answer is either "infeasible" — which is false, the shop
can still open — or a schedule that misses the target everywhere and reports a
deficit nobody could have avoided. Neither tells a manager anything.

So three quantities are kept apart, and only the third reaches the objective:

``referenceRequiredEmployees``
    the configured, historical demand. It is never used as a constraint. Its job
    is to carry the SHAPE of the day: which moments matter more than others.

``hardMinimumEmployees``
    the operational floor. Never rescaled, never traded, never softened. If the
    available minutes cannot cover it, the day is genuinely infeasible and this
    module says so rather than quietly lowering the bar.

adapted target
    the floor, plus the volume actually available distributed over the reference
    profile's relative weights. This is the soft objective the MILP minimises the
    deficit against.

Units
-----
Everything is counted in ATOMIC COVERAGE UNITS: one unit is one employee present
for one time step. Working in units rather than minutes keeps the rounding
honest — a target of "2.4 employees" is meaningless, and the largest-remainder
pass below turns the fractional distribution back into whole people without
losing or inventing a single unit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class Interval:
    """One atomic coverage interval of one day."""

    date: str
    start: int
    end: int
    #: Employees that must be present. A hard floor, never rescaled.
    hard_minimum: int
    #: Employees the configured demand asks for on a normal day.
    reference_required: int
    #: Employees the day can actually aim for, given what is available.
    adapted_target: int

    @property
    def reference_flexible(self) -> int:
        """Units of the reference profile that sit ABOVE the hard floor."""
        return max(self.reference_required - self.hard_minimum, 0)

    @property
    def adapted_flexible(self) -> int:
        return max(self.adapted_target - self.hard_minimum, 0)


@dataclass(frozen=True, slots=True)
class DayDemand:
    date: str
    step: int
    intervals: tuple[Interval, ...]
    #: Minutes the day may actually place, after absences and unavailability.
    available_worked_minutes: int
    #: Employee-minutes the hard floors alone consume.
    total_hard_minutes: int
    #: What is left to distribute over the reference profile.
    available_flexible_minutes: int
    #: True when the day cannot be staffed at all — see `infeasible_reason`.
    structurally_infeasible: bool
    #: Why, when it is. `None` when the day is fine.
    infeasible_reason: str | None
    #: True when the reference profile asks for nothing above the floors.
    flat_profile: bool
    #: True when the day can place more minutes than the reference profile asks
    #: for. The excess is surplus to schedule, never demand to meet.
    capacity_exceeds_reference: bool

    @property
    def total_adapted_minutes(self) -> int:
        return sum(interval.adapted_target for interval in self.intervals) * self.step

    @property
    def surplus_minutes(self) -> int:
        """Minutes the day must place that no target asks for."""
        return max(0, self.available_worked_minutes - self.total_adapted_minutes)


@dataclass(frozen=True, slots=True)
class DemandModel:
    days: dict[str, DayDemand] = field(default_factory=dict)

    @property
    def infeasible_days(self) -> tuple[str, ...]:
        return tuple(
            sorted(date for date, day in self.days.items() if day.structurally_infeasible)
        )

    def target(self, date: str, start: int) -> int:
        day = self.days.get(date)
        if day is None:
            return 0
        for interval in day.intervals:
            if interval.start == start:
                return interval.adapted_target
        return 0

    def floor(self, date: str, start: int) -> int:
        day = self.days.get(date)
        if day is None:
            return 0
        for interval in day.intervals:
            if interval.start == start:
                return interval.hard_minimum
        return 0


def _atomic_profile(problem: dict[str, Any], date: str, step: int) -> dict[int, tuple[int, int]]:
    """``{start: (hard_minimum, reference_required)}`` for one day.

    Overlapping slots take the MAXIMUM on both figures: two slots asking for one
    and three people over the same minute ask for three, not four, and a floor
    declared by either binds.
    """
    profile: dict[int, tuple[int, int]] = {}
    for slot in problem["demandSlots"]:
        if slot["date"] != date:
            continue
        hard = int(slot.get("hardMinimumEmployees") or 0)
        reference = int(slot["requiredEmployees"])
        for start in range(int(slot["startMinutes"]), int(slot["endMinutes"]), step):
            previous_hard, previous_reference = profile.get(start, (0, 0))
            profile[start] = (max(previous_hard, hard), max(previous_reference, reference))
    return profile


def workable_capacity_minutes(problem: dict[str, Any], date: str) -> int:
    """Minutes the people actually present could work on this day.

    An entry that is absent, on fixed rest or otherwise unavailable contributes
    exactly ZERO, never its nominal maximum — that is what "an absent person
    creates no workable hours" means in arithmetic. The cap per employee is the
    tightest of their own daily maximum, the day's own ceiling for them, and the
    rule's shift maximum.
    """
    rules = problem["rules"]
    employees = {str(item["id"]): item for item in problem["employees"]}

    capacity = 0
    for entry in problem["employeeDays"]:
        if entry["date"] != date or not entry["available"]:
            continue
        capacity += _daily_ceiling(employees[str(entry["employeeId"])], entry, rules)
    return capacity


def _daily_ceiling(employee: dict[str, Any], entry: dict[str, Any], rules: dict[str, Any]) -> int:
    """The most minutes ONE employee can work on ONE day.

    The subtle part is the continuous cap. Someone who may not split cannot work
    longer than one uninterrupted stretch, whatever their daily maximum says —
    so a team of two non-splitters caps at twice the continuous limit, not twice
    the shift limit. Ignoring that overstated a reduced Drive week's capacity by
    240 minutes and let a day look staffable that the candidate generator could
    never fill.

    For someone who may split, the break itself has to fit in the window
    alongside both stretches, so the gap is subtracted rather than assumed free.
    """
    # The window is optional: a caller measuring capacity from a partial problem
    # still gets the caps that do not depend on it. Missing means unbounded, not
    # zero — a bound nobody stated must never invent a restriction.
    if "latestEndMinutes" in entry and "earliestStartMinutes" in entry:
        window = int(entry["latestEndMinutes"]) - int(entry["earliestStartMinutes"])
    else:
        window = None

    caps = [
        int(employee["maximumDailyMinutes"]),
        int(entry["maximumMinutes"]),
        int(rules["maximumShiftMinutes"]),
    ]
    if window is not None:
        caps.append(window)
    base = min(caps)

    continuous = rules.get("maximumContinuousMinutes")
    if continuous is None:
        return max(0, base)
    continuous = int(continuous)

    may_split = (
        bool(rules.get("splitShiftAllowed"))
        and bool(employee.get("canSplitShift"))
        and int(rules.get("maximumSplitsPerDay") or 1) >= 1
    )
    if not may_split:
        return max(0, min(base, continuous))

    minimum_gap = int(rules.get("minimumSplitMinutes") or 0)
    split_caps = [base, 2 * continuous]
    if window is not None:
        split_caps.append(window - minimum_gap)
    return max(0, min(split_caps))


def budget_minutes(problem: dict[str, Any], date: str) -> int | None:
    day = next((item for item in problem["days"] if item["date"] == date), None)
    if day is None:
        return None
    budget = day.get("budgetMinutes")
    return None if budget is None else int(budget)


def available_worked_minutes(problem: dict[str, Any], date: str) -> int:
    """Minutes this day will actually place.

    The budget is the volume the sector decided to spend, and it is the figure
    to distribute whenever the problem carries one. But a budget is a DECISION,
    not a capacity: it cannot be worked by people who are not there. So it is
    capped by what the available employees could actually work.

    When the budget is the smaller of the two, the day simply spends less than
    it could. When the CAPACITY is the smaller one, the day has been told to
    place more minutes than exist — and because daily budgets are exact in this
    model, that is not a target to miss but a contradiction. `build_day_demand`
    reports it as such rather than letting a MILP discover it.
    """
    capacity = workable_capacity_minutes(problem, date)
    budget = budget_minutes(problem, date)
    if budget is None:
        return capacity
    return min(budget, capacity)


def _largest_remainder(
    raw: list[float], total_units: int, tie_break: list[int]
) -> list[int]:
    """Round a fractional distribution to whole units, preserving the total.

    Floor everything, then hand the leftover units to the largest fractional
    remainders. Ties break on ``tie_break`` — the interval's start minute — so
    two runs on the same input distribute the same units to the same intervals.
    A plain ``round`` would not preserve the total, and preserving it is the
    whole point: the adapted targets must add up to what the day will place.
    """
    floors = [int(value) for value in raw]
    assigned = sum(floors)
    leftover = total_units - assigned
    if leftover <= 0:
        return floors

    order = sorted(
        range(len(raw)),
        key=lambda index: (-(raw[index] - floors[index]), tie_break[index], index),
    )
    for position in range(leftover):
        floors[order[position % len(order)]] += 1
    return floors


def build_day_demand(problem: dict[str, Any], date: str) -> DayDemand:
    step = int(problem["timeStepMinutes"])
    profile = _atomic_profile(problem, date, step)
    starts = sorted(profile)

    hard_units = [profile[start][0] for start in starts]
    reference_units = [profile[start][1] for start in starts]
    flexible_units = [
        max(reference - hard, 0) for hard, reference in zip(hard_units, reference_units)
    ]

    capacity = workable_capacity_minutes(problem, date)
    budget = budget_minutes(problem, date)
    available = available_worked_minutes(problem, date)
    total_hard_minutes = sum(hard_units) * step

    # Two ways a day can be impossible, and they are NOT the same failure.
    reason: str | None = None
    if budget is not None and budget > capacity:
        # The day was told to place more minutes than the people present can
        # work. Daily budgets are exact in this model, so this is a
        # contradiction in the instruction, not a target to fall short of. It
        # shows up on a reduced team whose remaining people are capped below
        # what the sector's weekly distribution still asks of the day.
        reason = "daily-budget-exceeds-workable-capacity"
    elif available < total_hard_minutes:
        # The floors alone exceed what the day can staff: a day that cannot be
        # opened, never a deficit to accept.
        reason = "hard-floor-exceeds-available-minutes"

    if reason is not None:
        intervals = tuple(
            Interval(date, start, start + step, hard_units[index], reference_units[index], hard_units[index])
            for index, start in enumerate(starts)
        )
        return DayDemand(
            date=date,
            step=step,
            intervals=intervals,
            available_worked_minutes=available,
            total_hard_minutes=total_hard_minutes,
            available_flexible_minutes=0,
            structurally_infeasible=True,
            infeasible_reason=reason,
            flat_profile=sum(flexible_units) == 0,
            capacity_exceeds_reference=False,
        )

    total_reference_flexible = sum(flexible_units)

    # Rescaling only ever goes DOWN.
    #
    # The formula distributes what is available over the reference profile's
    # shape, which is right when the team has shrunk. When the team is larger
    # than the demand it inverts: on the canonical Drive week the contracts
    # total 11 025 minutes against 7 620 minutes of demand, so an uncapped
    # distribution would spread the whole budget as target and ask for a third
    # more people than the business ever configured. Every extra minute would
    # then read as a deficit, and the reference schedule — which covers the real
    # profile exactly — would score as under-covered.
    #
    # So the flexible volume is capped by the reference profile. Above it there
    # is no demand to meet, only minutes to place; those are surplus, exactly as
    # they are when the profile is flat.
    available_flexible_minutes = min(
        available - total_hard_minutes,
        total_reference_flexible * step,
    )

    if total_reference_flexible == 0:
        # The reference profile asks for nothing above the floors. Inventing a
        # target here would manufacture demand the business never expressed; the
        # spare minutes stay spare and become plannable surplus.
        adapted = list(hard_units)
        flat = True
    else:
        available_flexible_units = available_flexible_minutes // step
        raw = [
            hard_units[index]
            + available_flexible_units * (flexible_units[index] / total_reference_flexible)
            for index in range(len(starts))
        ]
        total_units = sum(hard_units) + available_flexible_units
        adapted = _largest_remainder(raw, total_units, starts)
        flat = False

    intervals = tuple(
        Interval(
            date=date,
            start=start,
            end=start + step,
            hard_minimum=hard_units[index],
            reference_required=reference_units[index],
            adapted_target=adapted[index],
        )
        for index, start in enumerate(starts)
    )

    return DayDemand(
        date=date,
        step=step,
        intervals=intervals,
        available_worked_minutes=available,
        total_hard_minutes=total_hard_minutes,
        available_flexible_minutes=available_flexible_minutes,
        structurally_infeasible=False,
        infeasible_reason=None,
        flat_profile=flat,
        capacity_exceeds_reference=(
            available - total_hard_minutes > total_reference_flexible * step
        ),
    )


def build_demand_model(problem: dict[str, Any]) -> DemandModel:
    """Adapted targets for every open day of the problem."""
    days = {}
    for day in sorted(problem["days"], key=lambda item: item["date"]):
        if day["closed"]:
            continue
        days[day["date"]] = build_day_demand(problem, day["date"])
    return DemandModel(days=days)
