from __future__ import annotations

import json
from typing import Any

FNV_PRIME_32 = 0x01000193


def _hash32(value: str, seed: int) -> int:
    digest = seed & 0xFFFFFFFF
    for char in value:
        digest = ((digest ^ ord(char)) * FNV_PRIME_32) & 0xFFFFFFFF
    return digest


def _hash64(value: str) -> str:
    low = _hash32(value, 0x811C9DC5)
    high = _hash32(value, 0x9E3779B9)
    return f"{high:08x}{low:08x}"


def _js_stringify(value: Any) -> str:
    # Matches JSON.stringify for the scalar/object shapes used in Planning V3.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def fingerprint_problem(problem: dict[str, Any]) -> str:
    parts = [
        problem["version"],
        str(problem["planningId"]),
        problem["sectorId"],
        f'{problem["period"]["start"]}..{problem["period"]["end"]}',
        f'step={problem["timeStepMinutes"]}',
        f'rules={_js_stringify(problem["rules"])}',
        f'objectives={",".join(problem["objectives"])}',
    ]
    for employee in sorted(problem["employees"], key=lambda item: str(item["id"])):
        # The daily bounds and the right to split decide what a day may hold, so
        # two rosters differing on them pose different questions. Only the
        # display name is left out — nothing acts on it.
        parts.append(
            f'E|{employee["id"]}|{employee["contractMinutes"]}|'
            f'{".".join(employee["workingDays"])}|{".".join(employee["fixedRestDays"])}|'
            f'{employee["minimumDailyMinutes"]}|{employee["maximumDailyMinutes"]}|'
            f'{1 if employee["canOpen"] else 0}{1 if employee["canClose"] else 0}'
            f'{1 if employee["canSplitShift"] else 0}|'
            f'{employee["maximumOpenings"] if employee["maximumOpenings"] is not None else "-"}|'
            f'{employee["maximumClosings"] if employee["maximumClosings"] is not None else "-"}'
        )
    for day in sorted(problem["days"], key=lambda item: item["date"]):
        parts.append(
            "D|{}|{}|{}|{}|{}".format(
                day["date"],
                1 if day["closed"] else 0,
                day["opensAtMinutes"] if day["opensAtMinutes"] is not None else "-",
                day["closesAtMinutes"] if day["closesAtMinutes"] is not None else "-",
                day["budgetMinutes"],
            )
        )
    # Per-person, per-day availability. The field both sides were blind to for
    # longest, and the most costly one to be blind to: a week where someone is
    # AWAY and the same week where they are there shared one identity, as did
    # two weeks differing only in when a person may arrive or leave. A
    # perturbation campaign built on the old fingerprint silently lost three of
    # its six axes — every scenario looked like the baseline.
    for entry in sorted(
        problem["employeeDays"], key=lambda item: (str(item["employeeId"]), item["date"])
    ):
        parts.append(
            f'A|{entry["employeeId"]}|{entry["date"]}|'
            f'{1 if entry["available"] else 0}{1 if entry["mandatory"] else 0}'
            f'{1 if entry["fixedRest"] else 0}|'
            f'{entry["earliestStartMinutes"]}|{entry["latestEndMinutes"]}|'
            f'{entry["maximumMinutes"]}'
        )
    for slot in sorted(
        problem["demandSlots"],
        key=lambda item: (item["date"], item["startMinutes"], item["id"]),
    ):
        # Mirrors the TypeScript fingerprint exactly, INCLUDING the head-count
        # fields that may be absent. Both sides used to omit
        # `hardMinimumEmployees`, which gave one identity to a week that must
        # never be left unattended and a week where the same shortfall is only a
        # degradation. Absent is written as `-` rather than skipped, so "not
        # declared" and "declared zero" stay distinguishable.
        hard = slot.get("hardMinimumEmployees")
        maximum = slot.get("maximumEmployees")
        parts.append(
            f'S|{slot["id"]}|{slot["date"]}|{slot["startMinutes"]}|{slot["endMinutes"]}|'
            f'{slot["requiredEmployees"]}|{hard if hard is not None else "-"}|'
            f'{maximum if maximum is not None else "-"}'
        )
    return f'p3_{_hash64(chr(10).join(parts))}'


def fingerprint_solution(solution: dict[str, Any]) -> str:
    rows: list[str] = []
    for assignment in solution["assignments"]:
        segments = sorted(assignment["segments"], key=lambda item: item["startMinutes"])
        encoded = ",".join(
            f'{segment["startMinutes"]}-{segment["endMinutes"]}' for segment in segments
        )
        rows.append(f'{assignment["employeeId"]}|{assignment["date"]}|{encoded}')
    rows.sort()
    value = "\n".join([solution["version"], solution["problemFingerprint"], *rows])
    return f's3_{_hash64(value)}'
