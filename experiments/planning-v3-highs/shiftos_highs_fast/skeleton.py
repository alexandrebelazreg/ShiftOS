"""Step 3 — who opens, who closes, who splits.

Decided BEFORE any exact hour, because these are WEEKLY facts. "At most two
closings each" is a sentence about the week; deciding it while placing Monday
means discovering on Saturday that the only eligible closer is at their cap.

Never one greedy skeleton
-------------------------
An earlier TypeScript engine handed each duty to whoever had taken the fewest so
far and kept the first result. Fair, and blind: coverage was never consulted, so
a skeleton leaving one opener against a demand of four ranked exactly as well as
one leaving four. An audit measured the cost — six of eight under-covered slots
were already unavoidable the moment that skeleton was fixed.

So candidates come from several deterministic FAMILIES, are deduplicated by role
signature, and are ranked by the deficit each has ALREADY made unavoidable,
before a single placement is attempted.

The bound that makes ranking honest
-----------------------------------
``max_presence_profile`` is an UPPER bound on how many people can be on the floor
at each instant:

- a designated opener starts exactly at opening, so across the opening cell the
  people present are precisely the openers, and nobody else may join them;
- a designated closer ends exactly at closing, symmetrically;
- anyone else could be anywhere inside their own window, so they count as
  present everywhere in it.

The third rule over-counts on purpose. Over-counting presence under-counts the
deficit, which keeps the score a LOWER bound: a skeleton this says will lose 135
minutes will lose at least that. It never punishes a skeleton for a shortfall a
clever placement could have avoided.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Any, Callable, Iterator

from shiftos_highs.demand import DemandModel

from .allocation import Allocation, AllocationModel


@dataclass(frozen=True, slots=True)
class DayRoles:
    day_index: int
    openers: tuple[int, ...]
    closers: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class Skeleton:
    roles: tuple[DayRoles, ...]
    family: str
    score: tuple[int, ...]

    def signature(self) -> str:
        return "|".join(
            f"{r.day_index}:{'.'.join(map(str, sorted(r.openers)))}"
            f"/{'.'.join(map(str, sorted(r.closers)))}"
            for r in sorted(self.roles, key=lambda item: item.day_index)
        )

    def opens(self, employee_index: int, day_index: int) -> bool:
        for entry in self.roles:
            if entry.day_index == day_index:
                return employee_index in entry.openers
        return False

    def closes(self, employee_index: int, day_index: int) -> bool:
        for entry in self.roles:
            if entry.day_index == day_index:
                return employee_index in entry.closers
        return False


@dataclass(frozen=True, slots=True)
class DayFacts:
    day_index: int
    date: str
    opens_at: int
    closes_at: int
    #: How many openers the demand would USE at the opening instant.
    opening_demand: int
    #: How many the RULE requires. A floor the generator may never go below.
    minimum_openings: int
    closing_demand: int
    opener_pool: tuple[int, ...]
    closer_pool: tuple[int, ...]
    peak_demand: int

    @property
    def opener_margin(self) -> int:
        return len(self.opener_pool) - self.opening_demand

    @property
    def closer_margin(self) -> int:
        return len(self.closer_pool) - self.closing_demand


@dataclass(frozen=True, slots=True)
class WeekFacts:
    days: tuple[DayFacts, ...]
    #: Useful days per permitted use, per employee. Above 1 means contended.
    opening_contention: tuple[float, ...]
    closing_contention: tuple[float, ...]
    minimum_rest: int

    def by_index(self, day_index: int) -> DayFacts | None:
        for day in self.days:
            if day.day_index == day_index:
                return day
        return None


def _contention(useful_days: int, cap: float) -> float:
    if cap <= 0:
        return float("inf")
    if cap == float("inf"):
        return 0.0 if useful_days == 0 else 1.0
    return useful_days / cap


def analyse_week(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    demand: DemandModel,
) -> WeekFacts:
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    entries = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }
    rules = problem["rules"]

    facts: list[DayFacts] = []
    for day_index, day in enumerate(days):
        opens_at = int(day["opensAtMinutes"])
        closes_at = int(day["closesAtMinutes"])

        openers: list[int] = []
        closers: list[int] = []
        for employee_index, employee in enumerate(employees):
            minutes = allocation.minutes[employee_index][day_index]
            if minutes <= 0:
                continue
            entry = entries[(str(employee["id"]), day["date"])]
            # Eligible only if the ALLOCATED minutes actually reach the boundary
            # from inside the employee's own window. Four hours for someone who
            # may not start before 08:00 cannot hold a 06:00 opening, and no
            # placement will make them able to.
            if (
                employee["canOpen"]
                and entry["earliestStartMinutes"] <= opens_at
                and opens_at + minutes <= entry["latestEndMinutes"]
            ):
                openers.append(employee_index)
            if (
                employee["canClose"]
                and entry["latestEndMinutes"] >= closes_at
                and closes_at - minutes >= entry["earliestStartMinutes"]
            ):
                closers.append(employee_index)

        opening_demand = int(rules["minimumOpeningsPerDay"])
        peak = 0
        day_demand = demand.days.get(day["date"])
        if day_demand is not None:
            for interval in day_demand.intervals:
                peak = max(peak, interval.adapted_target)
                if interval.start == opens_at:
                    opening_demand = max(
                        opening_demand, interval.adapted_target, interval.hard_minimum
                    )

        facts.append(
            DayFacts(
                day_index=day_index,
                date=day["date"],
                opens_at=opens_at,
                closes_at=closes_at,
                opening_demand=opening_demand,
                minimum_openings=int(rules["minimumOpeningsPerDay"]),
                closing_demand=int(rules["exactClosingsPerDay"]),
                opener_pool=tuple(openers),
                closer_pool=tuple(closers),
                peak_demand=peak,
            )
        )

    opening_contention: list[float] = []
    closing_contention: list[float] = []
    for employee_index, employee in enumerate(employees):
        useful_open = sum(1 for day in facts if employee_index in day.opener_pool and day.opening_demand > 0)
        can_close = sum(1 for day in facts if employee_index in day.closer_pool)
        open_cap = employee["maximumOpenings"]
        close_cap = employee["maximumClosings"]
        opening_contention.append(
            _contention(useful_open, float("inf") if open_cap is None else float(open_cap))
        )
        closing_contention.append(
            _contention(can_close, float("inf") if close_cap is None else float(close_cap))
        )

    return WeekFacts(
        days=tuple(facts),
        opening_contention=tuple(opening_contention),
        closing_contention=tuple(closing_contention),
        minimum_rest=int(rules["minimumRestMinutes"]),
    )


def rest_conflict(week: WeekFacts, close_day: int, open_day: int) -> bool:
    """Would closing one day stop this employee from opening a later one?"""
    if open_day <= close_day:
        return False
    closer = week.by_index(close_day)
    opener = week.by_index(open_day)
    if closer is None or opener is None:
        return False
    rest = (open_day - close_day) * 1_440 - closer.closes_at + opener.opens_at
    return rest < week.minimum_rest


def max_presence_profile(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    demand: DemandModel,
    roles: DayRoles,
    day: DayFacts,
) -> list[int]:
    """Upper bound on concurrent presence, per atomic cell of one day."""
    step = model.step
    entries = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))

    end = day.closes_at
    day_demand = demand.days.get(day.date)
    if day_demand is not None:
        for interval in day_demand.intervals:
            end = max(end, interval.end)
    cells = max(0, -(-(end - day.opens_at) // step))
    profile = [0] * cells

    def cover(start: int, stop: int) -> None:
        first = max(0, (start - day.opens_at) // step)
        last = min(cells - 1, -(-(stop - day.opens_at) // step) - 1)
        for cell in range(first, last + 1):
            profile[cell] += 1

    for employee_index, employee in enumerate(employees):
        minutes = allocation.minutes[employee_index][day.day_index]
        if minutes <= 0:
            continue
        if employee_index in roles.openers:
            cover(day.opens_at, day.opens_at + minutes)
            continue
        if employee_index in roles.closers:
            cover(day.closes_at - minutes, day.closes_at)
            continue
        # Everyone else could be anywhere inside their own window — EXCEPT on
        # the two boundary cells.
        #
        # The shift generator enforces `(start == opensAt) == opens` and
        # `(end == closesAt) == closes`, so at the opening cell the people on
        # the floor are exactly the designated openers and at the closing cell
        # exactly the designated closers. Nobody else can be there, whatever the
        # placement does.
        #
        # Counting them there anyway is not a loose bound, it is a FALSE one in
        # the only place where the skeleton alone decides coverage. It made a
        # Saturday wanting four openers score identically with three, because
        # the missing fourth was counted present at 06:00 regardless — and the
        # engine then lost that slot in every schedule it built, with no way to
        # see why. Measured on Drive: with the bound as it was, the four-opener
        # Saturday never reached the ranked set at any depth and the engine
        # stalled at one short slot. Excluding the boundary puts it first and
        # scores the three-opener alternatives at exactly the 1 slot / 15 min
        # they go on to lose. Necessary, and on its own not sufficient — that
        # skeleton's first allocation has no placement, which is handled where
        # the pipeline records an unplaced couple.
        #
        # Excluding a cell they cannot occupy removes impossible presence, so
        # this stays an upper bound on presence and the score stays a lower
        # bound on the deficit. The two guards keep it exact when a window
        # genuinely reaches past a boundary: someone whose window starts before
        # opening could hold the opening cell without starting on it, and
        # symmetrically at closing.
        entry = entries[(str(employee["id"]), day.date)]
        earliest = int(entry["earliestStartMinutes"])
        latest = int(entry["latestEndMinutes"])
        if earliest >= day.opens_at:
            earliest = max(earliest, day.opens_at + step)
        if latest <= day.closes_at:
            latest = min(latest, day.closes_at - step)
        cover(earliest, latest)

    return profile


def score_skeleton(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    demand: DemandModel,
    week: WeekFacts,
    roles: tuple[DayRoles, ...],
) -> tuple[int, ...]:
    """A lexicographic tuple, never a weighted sum.

    Order: structural breaches, slots already doomed, minutes already doomed,
    contended capability spent where alternatives existed, rest fragility, and
    only then fairness.
    """
    step = model.step
    structural = 0
    doomed_slots = 0
    doomed_minutes = 0

    for entry in roles:
        day = week.by_index(entry.day_index)
        if day is None:
            continue
        # Opening is a FLOOR the rule sets; closing is EXACT. A day short of
        # either is not a worse skeleton, it is a malformed one — the placement
        # will have no shift on the boundary and the hard floor there fails.
        if len(entry.openers) < min(day.minimum_openings, len(day.opener_pool)):
            structural += 1
        if len(entry.closers) != min(day.closing_demand, len(day.closer_pool)):
            structural += 1

        profile = max_presence_profile(problem, model, allocation, demand, entry, day)
        day_demand = demand.days.get(day.date)
        if day_demand is None:
            continue

        by_slot: dict[str, tuple[int, int]] = {}
        for interval in day_demand.intervals:
            cell = (interval.start - day.opens_at) // step
            present = profile[cell] if 0 <= cell < len(profile) else 0
            if present < interval.adapted_target:
                missing = (interval.adapted_target - present) * step
                key = f"{day.date}"
                short, minutes = by_slot.get(key, (0, 0))
                by_slot[key] = (short + 1, minutes + missing)
        for short, minutes in by_slot.values():
            doomed_slots += short
            doomed_minutes += minutes

    waste = 0
    for entry in roles:
        day = week.by_index(entry.day_index)
        if day is None:
            continue
        for employee_index in entry.openers:
            contention = week.opening_contention[employee_index]
            if contention > 1:
                waste += max(0, day.opener_margin) * int(round(contention))
        for employee_index in entry.closers:
            contention = week.closing_contention[employee_index]
            if contention > 1:
                waste += max(0, day.closer_margin) * int(round(contention))

    fragility = 0
    for entry in roles:
        for employee_index in entry.closers:
            for later in week.days:
                if not rest_conflict(week, entry.day_index, later.day_index):
                    continue
                if employee_index not in later.opener_pool:
                    continue
                fragility += 4 if later.opener_margin <= 0 else 2 if later.opener_margin == 1 else 1

    openings: dict[int, int] = {}
    closings: dict[int, int] = {}
    for entry in roles:
        for index in entry.openers:
            openings[index] = openings.get(index, 0) + 1
        for index in entry.closers:
            closings[index] = closings.get(index, 0) + 1
    spread = (max(openings.values(), default=0) - min(openings.values(), default=0)) + (
        max(closings.values(), default=0) - min(closings.values(), default=0)
    )

    return (structural, doomed_slots, doomed_minutes, waste, fragility, spread)


Family = tuple[str, Callable[[WeekFacts], list[DayFacts]], Callable[[WeekFacts, int], float], Callable[[WeekFacts, int], float]]


def _families() -> list[Family]:
    def critical_first(week: WeekFacts) -> list[DayFacts]:
        return sorted(
            week.days,
            key=lambda day: (day.opener_margin, day.closer_margin, -day.opening_demand, day.day_index),
        )

    def chronological(week: WeekFacts) -> list[DayFacts]:
        return sorted(week.days, key=lambda day: day.day_index)

    def peak_first(week: WeekFacts) -> list[DayFacts]:
        return sorted(
            week.days, key=lambda day: (-day.peak_demand, day.opener_margin, day.day_index)
        )

    def abundant_openers(week: WeekFacts, index: int) -> float:
        return week.opening_contention[index]

    def abundant_closers(week: WeekFacts, index: int) -> float:
        return week.closing_contention[index]

    def scarce_openers_last(week: WeekFacts, index: int) -> float:
        return -week.opening_contention[index]

    return [
        ("critical-days-first", critical_first, abundant_openers, abundant_closers),
        ("chronological", chronological, abundant_openers, abundant_closers),
        ("peak-demand-first", peak_first, abundant_openers, abundant_closers),
        ("scarce-openers-last", critical_first, scarce_openers_last, abundant_closers),
    ]


def _walk(
    week: WeekFacts,
    employees: list[dict[str, Any]],
    order: list[DayFacts],
    opener_key: Callable[[WeekFacts, int], float],
    closer_key: Callable[[WeekFacts, int], float],
    limit: int,
) -> list[tuple[DayRoles, ...]]:
    openings_used = [0] * len(employees)
    closings_used = [0] * len(employees)
    opens_on: list[list[int]] = [[] for _ in employees]
    closes_on: list[list[int]] = [[] for _ in employees]
    chosen: list[DayRoles] = []
    found: list[tuple[DayRoles, ...]] = []

    def cap_open(index: int) -> float:
        value = employees[index]["maximumOpenings"]
        return float("inf") if value is None else float(value)

    def cap_close(index: int) -> float:
        value = employees[index]["maximumClosings"]
        return float("inf") if value is None else float(value)

    def may_open(index: int, day_index: int) -> bool:
        return all(not rest_conflict(week, close, day_index) for close in closes_on[index])

    def may_close(index: int, day_index: int) -> bool:
        return all(not rest_conflict(week, day_index, open_day) for open_day in opens_on[index])

    def assign(position: int) -> None:
        if len(found) >= limit:
            return
        if position == len(order):
            found.append(tuple(chosen))
            return

        day = order[position]
        closers_sorted = sorted(day.closer_pool, key=lambda i: (closer_key(week, i), closings_used[i], i))
        openers_sorted = sorted(day.opener_pool, key=lambda i: (opener_key(week, i), openings_used[i], i))
        opener_target = min(day.opening_demand, len(openers_sorted))

        for closers in combinations(closers_sorted, min(day.closing_demand, len(closers_sorted))):
            if any(closings_used[i] + 1 > cap_close(i) for i in closers):
                continue
            if any(not may_close(i, day.day_index) for i in closers):
                continue

            # Opening is a FLOOR. Sizes descend from the useful count DOWN TO
            # the rule's minimum — never below it. More openers is strictly
            # better coverage, so the best size is tried first, and a day may
            # open short of the DEMAND rather than make the week infeasible; it
            # may not open short of the RULE, which would leave the opening
            # instant uncovered and every placement infeasible.
            opener_floor = min(day.minimum_openings, len(openers_sorted))
            for opener_count in range(opener_target, opener_floor - 1, -1):
                for openers in combinations(openers_sorted, opener_count):
                    if any(openings_used[i] + 1 > cap_open(i) for i in openers):
                        continue
                    if any(not may_open(i, day.day_index) for i in openers):
                        continue
                    if set(openers) & set(closers):
                        continue

                    for i in openers:
                        openings_used[i] += 1
                        opens_on[i].append(day.day_index)
                    for i in closers:
                        closings_used[i] += 1
                        closes_on[i].append(day.day_index)
                    chosen.append(DayRoles(day.day_index, tuple(openers), tuple(closers)))

                    assign(position + 1)

                    chosen.pop()
                    for i in closers:
                        closings_used[i] -= 1
                        closes_on[i].pop()
                    for i in openers:
                        openings_used[i] -= 1
                        opens_on[i].pop()
                    if len(found) >= limit:
                        return

    assign(0)
    return found


def _probe(model: AllocationModel, pick: Callable[[Any], int]) -> Allocation:
    """A stand-in allocation built from the cell bounds, not from a solver.

    The support of the matrix is settled by availability alone — ShiftOS has no
    optional days — so "who is on the floor which day" is known before any
    allocation exists. Only the durations are unknown, and the two questions the
    skeleton machinery asks about durations want opposite extremes.
    """
    return Allocation(
        minutes=tuple(
            tuple(0 if cell is None else pick(cell) for cell in row) for row in model.cells
        ),
        origin="probe",
    )


def generate_skeletons_from_capacity(
    problem: dict[str, Any],
    model: AllocationModel,
    demand: DemandModel,
    *,
    per_family: int = 6,
    keep: int = 8,
) -> list[Skeleton]:
    """Skeletons ranked BEFORE any allocation exists.

    Two probes, because eligibility and presence pull in opposite directions:

    - **the minimum probe decides the pools.** Whether someone CAN hold an
      opening is a question about the shortest shift they might work — a longer
      one is only harder to fit against their window — so probing with the
      minimum keeps every genuinely eligible candidate and invents none;
    - **the maximum probe scores the skeleton.** ``max_presence_profile`` is an
      upper bound on who is on the floor, and it stays an upper bound only if
      each role covers the LONGEST stretch it could. Probing presence with the
      minimum would under-count presence, over-count the deficit, and start
      rejecting skeletons for shortfalls a real allocation would never have.

    Both are correct for their own question and neither is a guess about the
    allocation, which does not exist yet.
    """
    week = analyse_week(problem, model, _probe(model, lambda cell: cell.minimum), demand)
    presence = _probe(model, lambda cell: cell.maximum)
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))

    by_signature: dict[str, Skeleton] = {}
    for name, order_of, opener_key, closer_key in _families():
        for roles in _walk(week, employees, order_of(week), opener_key, closer_key, per_family):
            score = score_skeleton(problem, model, presence, demand, week, roles)
            skeleton = Skeleton(roles=roles, family=name, score=score)
            signature = skeleton.signature()
            if signature not in by_signature:
                by_signature[signature] = skeleton

    ranked = sorted(by_signature.values(), key=lambda item: (item.score, item.signature()))
    return ranked[:keep]


def generate_skeletons(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    demand: DemandModel,
    *,
    per_family: int = 6,
    keep: int = 8,
) -> list[Skeleton]:
    """Build, deduplicate and rank. Never a single greedy result."""
    week = analyse_week(problem, model, allocation, demand)
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))

    by_signature: dict[str, Skeleton] = {}
    for name, order_of, opener_key, closer_key in _families():
        for roles in _walk(week, employees, order_of(week), opener_key, closer_key, per_family):
            score = score_skeleton(problem, model, allocation, demand, week, roles)
            skeleton = Skeleton(roles=roles, family=name, score=score)
            signature = skeleton.signature()
            # Two families reaching the same assignment describe the same
            # schedule; placing it twice would spend a budget to rediscover it.
            if signature not in by_signature:
                by_signature[signature] = skeleton

    ranked = sorted(by_signature.values(), key=lambda item: (item.score, item.signature()))
    return ranked[:keep]
