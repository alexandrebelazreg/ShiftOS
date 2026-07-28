from __future__ import annotations

from collections import defaultdict
from datetime import date as Date
from typing import Any


def _days_between(left: str, right: str) -> int:
    return (Date.fromisoformat(right) - Date.fromisoformat(left)).days


def evaluate(problem: dict[str, Any], assignments: list[dict[str, Any]]) -> dict[str, Any]:
    worked: dict[tuple[str, str], list[dict[str, int]]] = {
        (str(item["employeeId"]), item["date"]): sorted(
            item["segments"], key=lambda segment: segment["startMinutes"]
        )
        for item in assignments
    }
    employees = {str(item["id"]): item for item in problem["employees"]}
    days = {item["date"]: item for item in problem["days"]}
    employee_days = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }
    rules = problem["rules"]
    step = int(problem["timeStepMinutes"])
    violations: list[str] = []

    daily_by_employee: dict[str, int] = {}
    daily_by_date: dict[str, int] = defaultdict(int)
    weekly_by_employee: dict[str, int] = defaultdict(int)
    openings: dict[str, int] = defaultdict(int)
    closings: dict[str, int] = defaultdict(int)

    for (employee_id, day_date), segments in worked.items():
        total = sum(segment["endMinutes"] - segment["startMinutes"] for segment in segments)
        daily_by_employee[f"{employee_id}|{day_date}"] = total
        daily_by_date[day_date] += total
        weekly_by_employee[employee_id] += total
        day = days[day_date]
        if segments and segments[0]["startMinutes"] == day["opensAtMinutes"]:
            openings[employee_id] += 1
        if segments and segments[-1]["endMinutes"] == day["closesAtMinutes"]:
            closings[employee_id] += 1

    for employee_id, employee in employees.items():
        if weekly_by_employee[employee_id] != employee["contractMinutes"]:
            violations.append(
                f"contract:{employee_id}:{weekly_by_employee[employee_id]}!={employee['contractMinutes']}"
            )
    for day_date, day in days.items():
        if daily_by_date[day_date] != day["budgetMinutes"]:
            violations.append(f"budget:{day_date}:{daily_by_date[day_date]}!={day['budgetMinutes']}")

    for key, entry in employee_days.items():
        employee_id, day_date = key
        segments = worked.get(key, [])
        total = daily_by_employee.get(f"{employee_id}|{day_date}", 0)
        if entry["mandatory"] and total == 0:
            violations.append(f"mandatory:{employee_id}:{day_date}")
        if (entry["fixedRest"] or not entry["available"]) and total > 0:
            violations.append(f"unavailable:{employee_id}:{day_date}")
        if segments:
            if segments[0]["startMinutes"] < entry["earliestStartMinutes"]:
                violations.append(f"early:{employee_id}:{day_date}")
            if segments[-1]["endMinutes"] > entry["latestEndMinutes"]:
                violations.append(f"late:{employee_id}:{day_date}")
            if total > entry["maximumMinutes"]:
                violations.append(f"daily-max:{employee_id}:{day_date}")

    for (employee_id, day_date), segments in worked.items():
        employee = employees[employee_id]
        total = sum(segment["endMinutes"] - segment["startMinutes"] for segment in segments)
        if total < rules["minimumShiftMinutes"]:
            violations.append(f"minimum-shift:{employee_id}:{day_date}")
        if total > rules["maximumShiftMinutes"]:
            violations.append(f"maximum-shift:{employee_id}:{day_date}")
        for segment in segments:
            duration = segment["endMinutes"] - segment["startMinutes"]
            if duration < rules["minimumShiftMinutes"]:
                violations.append(f"minimum-segment:{employee_id}:{day_date}")
            if rules.get("maximumContinuousMinutes") is not None and duration > rules["maximumContinuousMinutes"]:
                violations.append(f"maximum-continuous:{employee_id}:{day_date}")
            if segment["startMinutes"] % step or segment["endMinutes"] % step:
                violations.append(f"time-step:{employee_id}:{day_date}")
        if len(segments) > 1:
            if not rules["splitShiftAllowed"] or not employee["canSplitShift"]:
                violations.append(f"split-not-allowed:{employee_id}:{day_date}")
            if len(segments) > 2:
                violations.append(f"too-many-segments:{employee_id}:{day_date}")
            for left, right in zip(segments, segments[1:]):
                gap = right["startMinutes"] - left["endMinutes"]
                if rules.get("minimumSplitMinutes") is not None and gap < rules["minimumSplitMinutes"]:
                    violations.append(f"split-too-short:{employee_id}:{day_date}")
                if rules.get("maximumSplitMinutes") is not None and gap > rules["maximumSplitMinutes"]:
                    violations.append(f"split-too-long:{employee_id}:{day_date}")

    ordered_days = sorted(problem["days"], key=lambda item: item["date"])
    for employee_id in employees:
        previous: tuple[str, int] | None = None
        streak = 0
        for day in ordered_days:
            segments = worked.get((employee_id, day["date"]), [])
            if not segments:
                previous = None
                streak = 0
                continue
            streak += 1
            maximum_streak = rules.get("maximumConsecutiveWorkedDays")
            if maximum_streak is not None and streak > maximum_streak:
                violations.append(f"consecutive:{employee_id}:{day['date']}")
            if previous is not None:
                rest = (
                    _days_between(previous[0], day["date"]) * 24 * 60
                    - previous[1]
                    + segments[0]["startMinutes"]
                )
                if rest < rules["minimumRestMinutes"]:
                    violations.append(f"rest:{employee_id}:{day['date']}:{rest}")
            previous = (day["date"], segments[-1]["endMinutes"])

    for day in problem["days"]:
        if day["closed"]:
            continue
        openers = 0
        closers_for_day = 0
        for employee_id, employee in employees.items():
            segments = worked.get((employee_id, day["date"]), [])
            if not segments:
                continue
            if segments[0]["startMinutes"] == day["opensAtMinutes"]:
                openers += 1
                if not employee["canOpen"]:
                    violations.append(f"cannot-open:{employee_id}:{day['date']}")
            if segments[-1]["endMinutes"] == day["closesAtMinutes"]:
                closers_for_day += 1
                if not employee["canClose"]:
                    violations.append(f"cannot-close:{employee_id}:{day['date']}")
        if openers < rules["minimumOpeningsPerDay"]:
            violations.append(f"opening-count:{day['date']}:{openers}")
        if closers_for_day != rules["exactClosingsPerDay"]:
            violations.append(f"closing-count:{day['date']}:{closers_for_day}")

    for employee_id, employee in employees.items():
        if employee["maximumOpenings"] is not None and openings[employee_id] > employee["maximumOpenings"]:
            violations.append(f"maximum-openings:{employee_id}")
        if employee["maximumClosings"] is not None and closings[employee_id] > employee["maximumClosings"]:
            violations.append(f"maximum-closings:{employee_id}")

    under_covered_slots = 0
    total_deficit_minutes = 0
    coverage_details: list[dict[str, Any]] = []
    for slot in problem["demandSlots"]:
        slot_deficit = 0
        minimum_present = 10**9
        atomics: list[dict[str, int]] = []
        for start in range(slot["startMinutes"], slot["endMinutes"], step):
            end = start + step
            present = 0
            for employee_id in employees:
                segments = worked.get((employee_id, slot["date"]), [])
                if any(segment["startMinutes"] <= start and segment["endMinutes"] >= end for segment in segments):
                    present += 1
            minimum_present = min(minimum_present, present)
            missing = max(0, slot["requiredEmployees"] - present)
            slot_deficit += missing * step
            atomics.append({"startMinutes": start, "present": present, "missing": missing})
        if slot_deficit > 0:
            under_covered_slots += 1
            total_deficit_minutes += slot_deficit
            coverage_details.append(
                {
                    "date": slot["date"],
                    "startMinutes": slot["startMinutes"],
                    "endMinutes": slot["endMinutes"],
                    "requiredEmployees": slot["requiredEmployees"],
                    "minimumPresent": 0 if minimum_present == 10**9 else minimum_present,
                    "deficitMinutes": slot_deficit,
                    "atomics": atomics,
                }
            )

    return {
        "validHardConstraints": not violations,
        "violations": violations,
        "underCoveredSlots": under_covered_slots,
        "totalDeficitMinutes": total_deficit_minutes,
        "dailyMinutesByDate": dict(sorted(daily_by_date.items())),
        "weeklyMinutesByEmployee": dict(sorted(weekly_by_employee.items())),
        "openingsByEmployee": dict(sorted(openings.items())),
        "closingsByEmployee": dict(sorted(closings.items())),
        "coverageDetails": coverage_details,
    }
