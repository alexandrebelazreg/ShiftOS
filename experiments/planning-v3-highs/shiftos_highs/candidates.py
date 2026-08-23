from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True, slots=True)
class Segment:
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class Candidate:
    employee_id: str
    date: str
    segments: tuple[Segment, ...]
    worked_minutes: int
    index: int

    @property
    def first_start(self) -> int:
        return self.segments[0].start

    @property
    def last_end(self) -> int:
        return self.segments[-1].end

    @property
    def split_count(self) -> int:
        return max(0, len(self.segments) - 1)

    def covers(self, start: int, end: int) -> bool:
        return any(segment.start <= start and segment.end >= end for segment in self.segments)


def _minute_range(start: int, stop_inclusive: int, step: int) -> Iterable[int]:
    if stop_inclusive < start:
        return ()
    return range(start, stop_inclusive + 1, step)


def generate_candidates(problem: dict[str, Any]) -> tuple[list[Candidate], dict[tuple[str, str], list[int]]]:
    step = int(problem["timeStepMinutes"])
    rules = problem["rules"]
    employees = {str(employee["id"]): employee for employee in problem["employees"]}
    employee_days = {
        (str(entry["employeeId"]), entry["date"]): entry for entry in problem["employeeDays"]
    }
    days = {day["date"]: day for day in problem["days"]}

    candidates: list[Candidate] = []
    by_assignment: dict[tuple[str, str], list[int]] = {}

    for employee_id in sorted(employees):
        employee = employees[employee_id]
        for date in sorted(days):
            day = days[date]
            entry = employee_days[(employee_id, date)]
            # Planiteo has no optional days.
            #
            # A fixed rest day, a complete unavailability or a full-day absence
            # forbids work outright; every other open day is worked. The solver
            # therefore never chooses between working and resting — it chooses
            # the duration, the start and end, the opening or closing role, and
            # the split when one is allowed.
            #
            # So availability is the ONLY criterion here. The `mandatory` flag
            # is not consulted: it is a derived field in the problem model, and
            # treating a disagreement between the two as an error used to make
            # this solver refuse problems it can perfectly well answer.
            if day["closed"] or not entry["available"]:
                continue

            lower = int(entry["earliestStartMinutes"])
            upper = int(entry["latestEndMinutes"])
            minimum = max(int(employee["minimumDailyMinutes"]), int(rules["minimumShiftMinutes"]))
            maximum = min(
                int(employee["maximumDailyMinutes"]),
                int(entry["maximumMinutes"]),
                int(rules["maximumShiftMinutes"]),
            )
            maximum_continuous = int(rules.get("maximumContinuousMinutes") or maximum)
            key = (employee_id, date)
            by_assignment[key] = []

            # Continuous shifts.
            for duration in _minute_range(minimum, min(maximum, maximum_continuous), step):
                for start in _minute_range(lower, upper - duration, step):
                    end = start + duration
                    if start == day["opensAtMinutes"] and not employee["canOpen"]:
                        continue
                    if end == day["closesAtMinutes"] and not employee["canClose"]:
                        continue
                    index = len(candidates)
                    candidates.append(
                        Candidate(
                            employee_id=employee_id,
                            date=date,
                            segments=(Segment(start, end),),
                            worked_minutes=duration,
                            index=index,
                        )
                    )
                    by_assignment[key].append(index)

            # Split shifts, including opportunistic splits below the continuous cap.
            if bool(employee["canSplitShift"]) and bool(rules["splitShiftAllowed"]):
                minimum_gap = int(rules.get("minimumSplitMinutes") or 0)
                maximum_gap = rules.get("maximumSplitMinutes")
                if maximum_gap is None:
                    maximum_gap = upper - lower
                maximum_gap = int(maximum_gap)
                minimum_segment = int(rules["minimumShiftMinutes"])

                for first_duration in _minute_range(minimum_segment, maximum, step):
                    for second_duration in _minute_range(
                        minimum_segment,
                        maximum - first_duration,
                        step,
                    ):
                        total = first_duration + second_duration
                        if total < minimum or total > maximum:
                            continue
                        for gap in _minute_range(minimum_gap, maximum_gap, step):
                            span = total + gap
                            for start in _minute_range(lower, upper - span, step):
                                first_end = start + first_duration
                                second_start = first_end + gap
                                end = second_start + second_duration
                                if start == day["opensAtMinutes"] and not employee["canOpen"]:
                                    continue
                                if end == day["closesAtMinutes"] and not employee["canClose"]:
                                    continue
                                index = len(candidates)
                                candidates.append(
                                    Candidate(
                                        employee_id=employee_id,
                                        date=date,
                                        segments=(
                                            Segment(start, first_end),
                                            Segment(second_start, end),
                                        ),
                                        worked_minutes=total,
                                        index=index,
                                    )
                                )
                                by_assignment[key].append(index)

            if not by_assignment[key]:
                # A day that MUST be worked and has no legal shape is a genuine
                # contradiction in the problem, not a day to skip: the minimum
                # segment cannot fit in the employee's window, or the window is
                # narrower than the shortest legal shift.
                raise ValueError(
                    f"Aucun shift légal pour {employee_id} le {date} : la journée est "
                    f"travaillable mais aucune forme ne respecte les durées et la fenêtre."
                )

    return candidates, by_assignment
