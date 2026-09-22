"""One inexpensive quality measure for placement and incumbent selection.

Coverage uses atomic sector/minute cells, independent of how demand windows
were split by the editor. Secondary costs are bounded below one coverage step.
No extra solve is required for preferences, stability or historical fairness.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date
from typing import Any
from .policy import POLICY

DARK_COUNTER_WEIGHT = POLICY["darkCounterWeight"]
OPENING_PRIORITY_MINUTES = POLICY["openingPriorityMinutes"]
OPENING_DARK_MULTIPLIER = POLICY["openingDarkMultiplier"]


@dataclass(frozen=True)
class FairnessTerm:
    employee_id: str
    sector_id: str | None
    kind: str
    history: int
    denominator: int
    weight: float
    maximum: int

    def matches(self, day: str, blocks: list[dict], days: dict) -> int:
        if self.kind == "saturday" and date.fromisoformat(day).weekday() != 5:
            return 0
        seen = set()
        for block in blocks:
            sid = str(block["sectorId"])
            if self.sector_id is not None and sid != self.sector_id:
                continue
            own = days.get((sid, day))
            if own is None or own["closed"]:
                continue
            matches = (block["startMinutes"] == own["opensAtMinutes"]) if self.kind == "opening" else (
                own["closesAtMinutes"] <= block["endMinutes"] <= (own.get("latestCloseMinutes") or own["closesAtMinutes"]))
            if matches:
                seen.add(sid)
        return len(seen)

    def cost(self, count: int) -> float:
        # Opportunity-weighted squared load. Unlike dividing by denominator²,
        # this does not make a first closing prohibitively costly for newcomers.
        return self.weight * (count * count + 2 * self.history * count) / self.denominator


def opening_priority_cells(problem: dict) -> set[tuple[str, str, int]]:
    step = int(problem["timeStepMinutes"])
    return {
        (str(sector["id"]), day["date"], minute)
        for sector in problem.get("sectors") or []
        for day in sector["days"] if not day["closed"]
        for minute in range(day["opensAtMinutes"], min(day["closesAtMinutes"],
                           day["opensAtMinutes"] + OPENING_PRIORITY_MINUTES), step)
    }


class Quality:
    def __init__(self, problem: dict[str, Any]):
        self.problem = problem
        self.step = int(problem["timeStepMinutes"])
        self.priority = opening_priority_cells(problem)
        self.targets: dict[tuple[str, str, int], int] = {}
        for slot in problem["demandSlots"]:
            for minute in range(slot["startMinutes"], slot["endMinutes"], self.step):
                key = (str(slot.get("sectorId") or problem["sectorId"]), slot["date"], minute)
                self.targets[key] = max(self.targets.get(key, 0), int(slot["requiredEmployees"]))
        self.employees = {str(e["id"]): e for e in problem["employees"]}
        self.sectors = {str(s["id"]): s for s in problem.get("sectors") or []}
        self.days = {(sid, d["date"]): d for sid, s in self.sectors.items() for d in s["days"]}
        self.history = {(str(h.get("sectorId") or problem["sectorId"]), str(h["employeeId"])): h
                        for h in problem.get("closingHistory") or []}
        self.baseline = {(str(a["employeeId"]), a["date"]): a
                         for a in problem.get("stabilityAssignments") or []}
        self.fairness: list[FairnessTerm] = []
        for eid, employee in self.employees.items():
            share = max(1, min(5, len(employee.get("workingDays") or [])))
            history = []
            for sid in employee.get("allowedSectorIds") or []:
                policy = self.sectors.get(sid, {}).get("closingFairness") or {}
                h = self.history.get((sid, eid), {})
                if employee.get("canClose"):
                    for kind, enabled, count, opportunities, weight in (
                        ("closing", "balanceClosings", "closings", "opportunities", 1),
                        ("saturday", "balanceSaturdayClosings", "saturdayClosings", "saturdayOpportunities", 2),
                    ):
                        if policy.get(enabled):
                            self.fairness.append(FairnessTerm(eid, sid, kind, h.get(count, 0),
                                max(1, h.get(opportunities, 0) + share), weight, len(problem["days"])))
                    if policy.get("balanceClosings"):
                        history.append(h)
            if history:
                self.fairness.append(FairnessTerm(eid, None, "closing", sum(h.get("closings", 0) for h in history),
                    max(h.get("opportunities", 0) for h in history) + share, .25, 2 * len(problem["days"])))
            if employee.get("canOpen"):
                self.fairness.append(FairnessTerm(eid, None, "opening", 0, share, 1, 2 * len(problem["days"])))
        # Every worked day costs at most: 2 roles x 3 history units, two
        # preferences, one switch, one split and one baseline change, plus rank.
        rank_bound = sum(max(0, len(e.get("allowedSectorIds") or []) - 1) * e["contractMinutes"]
                         / self.step for e in self.employees.values())
        self.scale = (self.step / 4) / max(1, rank_bound + 32 * len(self.employees) * len(problem["days"])
                                         + sum(t.cost(t.maximum) for t in self.fairness))

    def assignment_cost(self, employee_id: str, day: str, segments: list[dict], blocks: list[dict]) -> float:
        employee = self.employees[employee_id]
        allowed = employee.get("allowedSectorIds") or [self.problem["sectorId"]]
        ranks = {str(sid): rank for rank, sid in enumerate(allowed)}
        cost = sum(ranks.get(str(b["sectorId"]), len(allowed)) *
                   (b["endMinutes"] - b["startMinutes"]) / self.step for b in blocks)
        sequence = [str(b["sectorId"]) for b in blocks]
        cost += 2 * sum(a != b for a, b in zip(sequence, sequence[1:]))
        cost += max(0, len(segments) - 1)
        opened, closed = set(), set()
        for block in blocks:
            sid = str(block["sectorId"])
            own = self.days.get((sid, day))
            if not own or own["closed"]:
                continue
            if block["startMinutes"] == own["opensAtMinutes"]:
                opened.add(sid)
            if own["closesAtMinutes"] <= block["endMinutes"] <= (own.get("latestCloseMinutes") or own["closesAtMinutes"]):
                closed.add(sid)
        cost += int(bool(employee.get("prefersOpening")) and not opened)
        cost += int(bool(employee.get("prefersClosing")) and not closed)
        baseline = self.baseline.get((employee_id, day))
        if self.baseline:
            cost += int(baseline is None or baseline["segments"] != segments or
                        ("sectorAssignments" in baseline and baseline["sectorAssignments"] != blocks))
            if baseline is not None:
                cost -= 1  # Credit for retaining a baseline day; omission also counts as a change.
        return cost * self.scale

    def score(self, assignments: list[dict] | tuple[dict, ...]) -> tuple[float, int, int]:
        present: Counter = Counter()
        secondary = len(self.baseline) * self.scale
        for assignment in assignments:
            blocks = assignment.get("sectorAssignments") or [dict(s, sectorId=self.problem["sectorId"])
                                                            for s in assignment["segments"]]
            for block in blocks:
                for minute in range(block["startMinutes"], block["endMinutes"], self.step):
                    present[(str(block["sectorId"]), assignment["date"], minute)] += 1
            secondary += self.assignment_cost(str(assignment["employeeId"]), assignment["date"],
                                              assignment["segments"], blocks)
        weighted = deficit = dark_minutes = 0
        for term in self.fairness:
            count = sum(term.matches(a["date"], a.get("sectorAssignments") or [], self.days)
                        for a in assignments if str(a["employeeId"]) == term.employee_id)
            secondary += term.cost(count) * self.scale
        for key, target in self.targets.items():
            missing = max(0, target - present[key])
            dark = int(target > 0 and present[key] == 0)
            weight = DARK_COUNTER_WEIGHT * (OPENING_DARK_MULTIPLIER if key in self.priority else 1)
            weighted += (missing + (weight - 1) * dark) * self.step
            deficit += missing * self.step
            dark_minutes += dark * self.step
        return (weighted + secondary, deficit, dark_minutes)
