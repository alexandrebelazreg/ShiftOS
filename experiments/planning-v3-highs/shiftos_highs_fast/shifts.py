"""Step 4 — the reduced shift space.

The global engine enumerates every start crossed with every duration: on the
Drive week that is 28 542 shapes, the overwhelming majority of which contradict
the contracts before anything has been placed. Here the duration is already
DECIDED by the allocation, so only the start is free — and the skeleton fixes
even that for the people holding a role.

What survives:

- a designated opener has exactly ONE legal start;
- a designated closer has exactly one;
- everyone else is forbidden from landing on either boundary, which is the
  two-sided reading the skeleton promised. Without it, a non-opener drifting
  onto the opening minute would silently create an extra opening and break a
  weekly cap that was already arbitrated.

Splits come in two kinds, and both are generated:

- **forced** — the allocated minutes exceed one uninterrupted stretch, so the
  day is only legal in two pieces;
- **opportunistic** — the minutes would fit in one stretch, but two pieces may
  cover two peaks a single block cannot reach. Bounded hard: they multiply the
  space fastest and pay off least, so they are generated only when the day
  actually has two separated peaks.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from shiftos_highs.demand import DemandModel

from .allocation import Allocation, AllocationModel
from .skeleton import Skeleton


@dataclass(frozen=True, slots=True)
class Segment:
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class Shift:
    employee_index: int
    day_index: int
    segments: tuple[Segment, ...]
    minutes: int
    opens: bool
    closes: bool
    index: int

    @property
    def first_start(self) -> int:
        return self.segments[0].start

    @property
    def last_end(self) -> int:
        return self.segments[-1].end

    def covers(self, start: int, end: int) -> bool:
        return any(s.start <= start and s.end >= end for s in self.segments)


@dataclass(frozen=True, slots=True)
class ShiftSpace:
    shifts: tuple[Shift, ...]
    by_cell: dict[tuple[int, int], tuple[int, ...]]
    #: Cells the skeleton left with no legal shape at all.
    impossible: tuple[tuple[int, int], ...]


def _steps(low: int, high: int, step: int) -> range:
    if high < low:
        return range(0)
    return range(low, high + 1, step)


def _tighten_for_rest(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    skeleton: Skeleton,
) -> dict[tuple[int, int], tuple[int, int]]:
    """Push the rest rule into the windows BEFORE generating anything.

    The skeleton has already fixed the only two times known exactly: a closer
    ends at closing, an opener starts at opening. Both can be pushed onto their
    neighbour's window — someone who closes cannot start the next worked day
    before ``close + rest``, and someone who opens cannot have ended the previous
    one after ``open − rest``.

    Doing this here rather than rejecting violations later is the difference
    between a search that works and one that does not: the clashing candidates
    are never generated.
    """
    entries = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    rest = int(problem["rules"]["minimumRestMinutes"])

    windows: dict[tuple[int, int], tuple[int, int]] = {}
    for employee_index, employee in enumerate(employees):
        for day_index, day in enumerate(days):
            entry = entries.get((str(employee["id"]), day["date"]))
            if entry is None:
                continue
            windows[(employee_index, day_index)] = (
                int(entry["earliestStartMinutes"]),
                int(entry["latestEndMinutes"]),
            )

    for employee_index in range(len(employees)):
        worked = [
            day_index
            for day_index in range(len(days))
            if allocation.minutes[employee_index][day_index] > 0
        ]
        for position in range(1, len(worked)):
            previous, current = worked[position - 1], worked[position]
            gap = (current - previous) * 1_440

            if skeleton.closes(employee_index, previous):
                floor = int(days[previous]["closesAtMinutes"]) + rest - gap
                earliest, latest = windows[(employee_index, current)]
                if floor > earliest:
                    windows[(employee_index, current)] = (floor, latest)

            if skeleton.opens(employee_index, current):
                ceiling = int(days[current]["opensAtMinutes"]) + gap - rest
                earliest, latest = windows[(employee_index, previous)]
                if ceiling < latest:
                    windows[(employee_index, previous)] = (earliest, ceiling)

    return windows


def _peak_gaps(demand: DemandModel, date: str, step: int) -> list[tuple[int, int]]:
    """Troughs between two peaks — where an opportunistic split may help."""
    day = demand.days.get(date)
    if day is None:
        return []
    targets = [interval.adapted_target for interval in day.intervals]
    if not targets:
        return []
    peak = max(targets)
    if peak < 2:
        return []

    gaps: list[tuple[int, int]] = []
    inside = False
    start = 0
    for index, interval in enumerate(day.intervals):
        low = targets[index] < peak
        if low and not inside:
            inside, start = True, interval.start
        elif not low and inside:
            inside = False
            gaps.append((start, interval.start))
    return gaps


def generate_shifts(
    problem: dict[str, Any],
    model: AllocationModel,
    allocation: Allocation,
    skeleton: Skeleton,
    demand: DemandModel,
    *,
    opportunistic_splits: bool = True,
) -> ShiftSpace:
    step = model.step
    rules = problem["rules"]
    employees = sorted(problem["employees"], key=lambda item: str(item["id"]))
    days = sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])
    windows = _tighten_for_rest(problem, model, allocation, skeleton)

    minimum_segment = int(rules["minimumShiftMinutes"])
    continuous_cap = int(rules.get("maximumContinuousMinutes") or rules["maximumShiftMinutes"])
    split_allowed = bool(rules.get("splitShiftAllowed"))
    minimum_gap = int(rules.get("minimumSplitMinutes") or 0)
    maximum_gap = rules.get("maximumSplitMinutes")

    shifts: list[Shift] = []
    by_cell: dict[tuple[int, int], list[int]] = {}
    impossible: list[tuple[int, int]] = []

    for employee_index, employee in enumerate(employees):
        for day_index, day in enumerate(days):
            minutes = allocation.minutes[employee_index][day_index]
            if minutes <= 0:
                continue

            key = (employee_index, day_index)
            earliest, latest = windows[key]
            opens_at = int(day["opensAtMinutes"])
            closes_at = int(day["closesAtMinutes"])
            opens = skeleton.opens(employee_index, day_index)
            closes = skeleton.closes(employee_index, day_index)
            bucket: list[int] = []

            def emit(segments: tuple[Segment, ...]) -> None:
                index = len(shifts)
                shifts.append(
                    Shift(
                        employee_index=employee_index,
                        day_index=day_index,
                        segments=segments,
                        minutes=minutes,
                        opens=segments[0].start == opens_at,
                        closes=segments[-1].end == closes_at,
                        index=index,
                    )
                )
                bucket.append(index)

            # ── One uninterrupted stretch ────────────────────────────────────
            if minutes <= continuous_cap:
                if opens:
                    starts = [opens_at]
                elif closes:
                    starts = [closes_at - minutes]
                else:
                    starts = list(_steps(earliest, latest - minutes, step))
                for start in starts:
                    end = start + minutes
                    if start < earliest or end > latest:
                        continue
                    if (start == opens_at) != opens:
                        continue
                    if (end == closes_at) != closes:
                        continue
                    emit((Segment(start, end),))

            # ── Two stretches with a break ───────────────────────────────────
            may_split = (
                split_allowed
                and bool(employee["canSplitShift"])
                and int(rules.get("maximumSplitsPerDay") or 1) >= 1
            )
            forced = minutes > continuous_cap
            if may_split and (forced or opportunistic_splits):
                gap_high = int(maximum_gap) if maximum_gap is not None else latest - earliest
                gap_low = max(minimum_gap, step)
                troughs = _peak_gaps(demand, day["date"], step)

                for first in _steps(minimum_segment, min(continuous_cap, minutes - minimum_segment), step):
                    second = minutes - first
                    if second < minimum_segment or second > continuous_cap:
                        continue
                    for gap in _steps(gap_low, gap_high, step):
                        span = minutes + gap
                        for start in _steps(earliest, latest - span, step):
                            first_end = start + first
                            second_start = first_end + gap
                            end = second_start + second
                            if (start == opens_at) != opens:
                                continue
                            if (end == closes_at) != closes:
                                continue
                            # An opportunistic split is only kept when its break
                            # actually sits in a trough. Otherwise it costs a
                            # hole and buys nothing.
                            if not forced and troughs:
                                if not any(
                                    low <= first_end and second_start <= high
                                    for low, high in troughs
                                ):
                                    continue
                            elif not forced:
                                continue
                            emit((Segment(start, first_end), Segment(second_start, end)))

            if not bucket:
                impossible.append(key)
            by_cell[key] = bucket

    return ShiftSpace(
        shifts=tuple(shifts),
        by_cell={key: tuple(value) for key, value in by_cell.items()},
        impossible=tuple(impossible),
    )
