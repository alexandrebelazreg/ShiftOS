from __future__ import annotations

from collections import defaultdict
from datetime import date as Date
from typing import Any


def _days_between(left: str, right: str) -> int:
    return (Date.fromisoformat(right) - Date.fromisoformat(left)).days


def _role_implied_by_demand(problem: dict[str, Any], sector_id: str, sector_day: dict[str, Any]) -> bool:
    """Miroir de `shifts.role_implied_by_demand`, sans dependre du moteur rapide."""
    opens_at, closes_at = sector_day.get("opensAtMinutes"), sector_day.get("closesAtMinutes")
    if not isinstance(opens_at, int) or not isinstance(closes_at, int):
        return False
    covered = sorted(
        (int(slot["startMinutes"]), int(slot["endMinutes"]))
        for slot in problem["demandSlots"]
        if str(slot.get("sectorId") or problem["sectorId"]) == sector_id
        and slot["date"] == sector_day["date"]
        and int(slot["requiredEmployees"]) >= 1
    )
    if not covered:
        return False
    reach = opens_at
    for start, end in covered:
        if start > reach:
            return False
        reach = max(reach, end)
    return reach >= closes_at


def evaluate(problem: dict[str, Any], assignments: list[dict[str, Any]]) -> dict[str, Any]:
    worked: dict[tuple[str, str], list[dict[str, int]]] = {
        (str(item["employeeId"]), item["date"]): sorted(
            item["segments"], key=lambda segment: segment["startMinutes"]
        )
        for item in assignments
    }
    assignment_by_key = {
        (str(item["employeeId"]), item["date"]): item for item in assignments
    }
    sector_worked: dict[tuple[str, str, str], list[dict[str, int]]] = defaultdict(list)
    for key, item in assignment_by_key.items():
        blocks = item.get("sectorAssignments")
        if blocks is None:
            blocks = [dict(segment, sectorId=problem["sectorId"]) for segment in item["segments"]]
        for block in blocks:
            sector_worked[(key[0], key[1], str(block["sectorId"]))].append(block)
    employees = {str(item["id"]): item for item in problem["employees"]}
    days = {item["date"]: item for item in problem["days"]}
    employee_days = {
        (str(item["employeeId"]), item["date"]): item for item in problem["employeeDays"]
    }
    rules = problem["rules"]
    sectors = {
        str(sector["id"]): sector for sector in problem.get("sectors") or []
    }
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
        if not problem.get("sectors") and segments and segments[0]["startMinutes"] == day["opensAtMinutes"]:
            openings[employee_id] += 1
        if not problem.get("sectors") and segments and segments[-1]["endMinutes"] == day["closesAtMinutes"]:
            closings[employee_id] += 1

    for employee_id, employee in employees.items():
        if weekly_by_employee[employee_id] != employee["contractMinutes"]:
            violations.append(
                f"contract:{employee_id}:{weekly_by_employee[employee_id]}!={employee['contractMinutes']}"
            )
    for day_date, day in days.items():
        if day.get("budgetMode", "exact") == "exact" and daily_by_date[day_date] != day["budgetMinutes"]:
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
            # Les règles fixes du salarié : une heure imposée n'est pas une borne.
            fixed_start = entry.get("fixedStartMinutes")
            if isinstance(fixed_start, int) and segments[0]["startMinutes"] != fixed_start:
                violations.append(f"fixed-start:{employee_id}:{day_date}")
            fixed_end = entry.get("fixedEndMinutes")
            if isinstance(fixed_end, int) and segments[-1]["endMinutes"] != fixed_end:
                violations.append(f"fixed-end:{employee_id}:{day_date}")
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
            assignment = assignment_by_key[(employee_id, day_date)]
            blocks = assignment.get("sectorAssignments") or [
                dict(segment, sectorId=problem["sectorId"]) for segment in segments
            ]
            used_sector_rules = []
            for sector_id in {str(block["sectorId"]) for block in blocks}:
                sector = sectors.get(sector_id)
                own = sector.get("splitRules") if sector is not None else None
                used_sector_rules.append(own if isinstance(own, dict) else rules)
            if not employee["canSplitShift"] or any(
                not own.get("splitShiftAllowed") for own in used_sector_rules
            ):
                violations.append(f"split-not-allowed:{employee_id}:{day_date}")
            split_count = len(segments) - 1
            if any(
                own.get("maximumSplitsPerDay") is not None
                and split_count > int(own["maximumSplitsPerDay"])
                for own in used_sector_rules
            ):
                violations.append(f"too-many-segments:{employee_id}:{day_date}")
            for left, right in zip(segments, segments[1:]):
                gap = right["startMinutes"] - left["endMinutes"]
                if any(
                    own.get("minimumSplitMinutes") is not None
                    and gap < int(own["minimumSplitMinutes"])
                    for own in used_sector_rules
                ):
                    violations.append(f"split-too-short:{employee_id}:{day_date}")
                if any(
                    own.get("maximumSplitMinutes") is not None
                    and gap > int(own["maximumSplitMinutes"])
                    for own in used_sector_rules
                ):
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
        if problem.get("sectors"):
            for sector in problem["sectors"]:
                own_day = next((entry for entry in sector["days"] if entry["date"] == day["date"]), None)
                if not own_day or own_day["closed"]:
                    continue
                openers = 0
                closers_for_day = 0
                for employee_id, employee in employees.items():
                    blocks = sector_worked.get((employee_id, day["date"], str(sector["id"])), [])
                    if any(block["startMinutes"] == own_day["opensAtMinutes"] for block in blocks):
                        openers += 1
                        openings[employee_id] += 1
                        if not employee["canOpen"]:
                            violations.append(f"cannot-open:{sector['id']}:{employee_id}:{day['date']}")
                    # Un rayon peut s'attarder jusqu'à `latestCloseMinutes` :
                    # ferme celui qui finit dans cette fenêtre, pas seulement
                    # celui qui finit à la minute exacte.
                    latest = max(
                        int(own_day["closesAtMinutes"]),
                        int(own_day.get("latestCloseMinutes") or own_day["closesAtMinutes"]),
                    )
                    if any(
                        own_day["closesAtMinutes"] <= block["endMinutes"] <= latest
                        for block in blocks
                    ):
                        closers_for_day += 1
                        closings[employee_id] += 1
                        if not employee["canClose"]:
                            violations.append(f"cannot-close:{sector['id']}:{employee_id}:{day['date']}")
                # Une exigence que la demande porte deja est comptee comme
                # deficit de couverture, jamais deux fois.
                implied = _role_implied_by_demand(problem, str(sector["id"]), own_day)
                if not implied and openers < own_day["minimumOpenings"]:
                    violations.append(f"opening-count:{sector['id']}:{day['date']}:{openers}")
                # A MINIMUM, like everywhere else the rule is read.
                #
                # This line used to demand equality while the placement MILP
                # imposes `≥`, the mono-sector branch below reads `<` and the
                # TypeScript validator reads `<`. Nothing in the objective
                # penalises a surplus closer, so the MILP was free to build one
                # — and this evaluator then threw the whole placement away as
                # illegal, for a schedule the official validator accepts. On a
                # zone whose five counters close at the same minute that is a
                # placement lost for nothing.
                if not implied and closers_for_day < own_day["exactClosings"]:
                    violations.append(f"closing-count:{sector['id']}:{day['date']}:{closers_for_day}")
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
        if closers_for_day < rules["exactClosingsPerDay"]:
            violations.append(f"closing-count:{day['date']}:{closers_for_day}")

    # Les jours où quelqu'un DOIT ouvrir ou fermer, vérifiés contre les bornes
    # des rayons qu'il sert — le rôle est employé, le comptoir est déduit.
    for (employee_id, day_date), entry in employee_days.items():
        segments = worked.get((employee_id, day_date), [])
        if not segments:
            continue
        allowed = [str(value) for value in employees[employee_id].get("allowedSectorIds") or []]
        opens_at = sorted(
            int(own["opensAtMinutes"])
            for sector in problem.get("sectors") or []
            if str(sector["id"]) in allowed
            for own in sector["days"]
            if own["date"] == day_date and not own["closed"]
        )
        closes_at = sorted(
            int(own["closesAtMinutes"])
            for sector in problem.get("sectors") or []
            if str(sector["id"]) in allowed
            for own in sector["days"]
            if own["date"] == day_date and not own["closed"]
        )
        if entry.get("mustOpen") and (not opens_at or segments[0]["startMinutes"] != opens_at[0]):
            violations.append(f"must-open:{employee_id}:{day_date}")
        if entry.get("mustClose") and (not closes_at or segments[-1]["endMinutes"] != closes_at[-1]):
            violations.append(f"must-close:{employee_id}:{day_date}")

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
            sector_id = str(slot.get("sectorId") or problem["sectorId"])
            for employee_id in employees:
                segments = sector_worked.get((employee_id, slot["date"], sector_id), [])
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
