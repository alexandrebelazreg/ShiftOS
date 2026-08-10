"""Exact lexicographic MILP for ShiftOS paid-leave campaigns.

Reads one JSON request on stdin and writes one JSON response on stdout. SciPy's
HiGHS backend must prove every lexicographic stage optimal; a feasible incumbent
is never returned as an applicable answer.
"""

from __future__ import annotations

import json
import math
import sys
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import csr_matrix


@dataclass
class Variable:
    name: str
    lower: float
    upper: float
    integral: int


class Model:
    def __init__(self) -> None:
        self.variables: list[Variable] = []
        self.rows: list[dict[int, float]] = []
        self.lower: list[float] = []
        self.upper: list[float] = []

    def variable(self, name: str, lower: float = 0.0, upper: float = math.inf, integral: int = 0) -> int:
        index = len(self.variables)
        self.variables.append(Variable(name, lower, upper, integral))
        return index

    def constraint(self, coefficients: dict[int, float], lower: float = -math.inf, upper: float = math.inf) -> None:
        self.rows.append({index: value for index, value in coefficients.items() if abs(value) > 1e-12})
        self.lower.append(lower)
        self.upper.append(upper)

    def solve(self, objective: dict[int, float], time_limit: float):
        count = len(self.variables)
        data: list[float] = []
        row_indices: list[int] = []
        column_indices: list[int] = []
        for row_index, row in enumerate(self.rows):
            for column_index, coefficient in row.items():
                row_indices.append(row_index)
                column_indices.append(column_index)
                data.append(coefficient)
        matrix = csr_matrix((data, (row_indices, column_indices)), shape=(len(self.rows), count))
        c = np.zeros(count)
        for index, coefficient in objective.items():
            c[index] = coefficient
        return milp(
            c=c,
            integrality=np.array([variable.integral for variable in self.variables]),
            bounds=Bounds(
                np.array([variable.lower for variable in self.variables]),
                np.array([variable.upper for variable in self.variables]),
            ),
            constraints=LinearConstraint(matrix, np.array(self.lower), np.array(self.upper)),
            options={"time_limit": max(0.1, time_limit), "presolve": True},
        ), c


def add_to(row: dict[int, float], index: int, value: float) -> None:
    row[index] = row.get(index, 0.0) + value


def main(payload: dict[str, Any]) -> dict[str, Any]:
    started = time.monotonic()
    deadline = started + float(payload.get("timeoutSeconds", 60))
    model = Model()
    employees = {employee["id"]: employee for employee in payload["employees"]}
    choices: dict[tuple[str, str], int] = {}
    choice_rank: dict[tuple[str, str], int] = {}

    for employee in payload["employees"]:
        employee_id = employee["id"]
        for choice in employee["choices"]:
            key = (employee_id, choice["weekId"])
            choices[key] = model.variable(f"grant:{employee_id}:{choice['weekId']}", 0, 1, 1)
            choice_rank[key] = int(choice["rank"])
        row = {choices[(employee_id, choice["weekId"])]: 1.0 for choice in employee["choices"]}
        target = int(employee["targetWeeks"])
        model.constraint(row, target, target)

    # Pair common-week variables. Each reciprocal pair is described once.
    common_variables: list[tuple[int, int]] = []
    seen_pairs: set[tuple[str, str]] = set()
    for employee in payload["employees"]:
        partner_id = employee.get("linkedEmployeeId")
        if not partner_id or partner_id not in employees:
            continue
        pair = tuple(sorted((employee["id"], partner_id)))
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        left, right = pair
        common_weeks = sorted(
            {week for emp, week in choices if emp == left}
            & {week for emp, week in choices if emp == right}
        )
        seniority_weight = max(int(employees[left]["seniorityOrder"]), int(employees[right]["seniorityOrder"]))
        for week_id in common_weeks:
            z = model.variable(f"common:{left}:{right}:{week_id}", 0, 1, 1)
            x_left = choices[(left, week_id)]
            x_right = choices[(right, week_id)]
            model.constraint({z: 1.0, x_left: -1.0}, upper=0.0)
            model.constraint({z: 1.0, x_right: -1.0}, upper=0.0)
            model.constraint({z: 1.0, x_left: -1.0, x_right: -1.0}, lower=-1.0)
            common_variables.append((z, seniority_weight))

    # Rank-use and mixed-plan variables.
    mixed_variables: list[int] = []
    for employee in payload["employees"]:
        employee_id = employee["id"]
        rank_used: list[int] = []
        for rank in (1, 2, 3):
            rank_choices = [
                index for (emp, week), index in choices.items()
                if emp == employee_id and choice_rank[(emp, week)] == rank
            ]
            if not rank_choices:
                continue
            used = model.variable(f"rank-used:{employee_id}:{rank}", 0, 1, 1)
            rank_used.append(used)
            for choice in rank_choices:
                model.constraint({choice: 1.0, used: -1.0}, upper=0.0)
            model.constraint({used: 1.0, **{choice: -1.0 for choice in rank_choices}}, upper=0.0)
        if len(rank_used) > 1:
            mixed = model.variable(f"mixed:{employee_id}", 0, 1, 1)
            model.constraint({mixed: 1.0, **{used: -1.0 for used in rank_used}}, lower=-1.0)
            mixed_variables.append(mixed)

    # Reinforcement variables by applicable pool and coverage cell.
    reinforcement: dict[tuple[str, str, str], int] = {}
    for pool in payload["reinforcementPools"]:
        row: dict[int, float] = {}
        for cell in payload["coverage"]:
            applies = (
                pool["startWeekId"] <= cell["weekId"] <= pool["endWeekId"]
                and (pool["scope"] == "global" or pool.get("sectorId") == cell["sectorId"])
            )
            if not applies:
                continue
            key = (pool["id"], cell["sectorId"], cell["weekId"])
            variable = model.variable(f"reinforce:{':'.join(key)}", 0, float(pool["totalHours"]), 0)
            reinforcement[key] = variable
            row[variable] = 1.0
        model.constraint(row, upper=float(pool["totalHours"]))

    deficit_variables: list[int] = []
    for cell in payload["coverage"]:
        deficit = model.variable(
            f"deficit:{cell['sectorId']}:{cell['weekId']}",
            0,
            float(cell["toleratedDeficitHours"]),
            0,
        )
        deficit_variables.append(deficit)
        row: dict[int, float] = {deficit: -1.0}
        for employee in payload["employees"]:
            if employee.get("sectorId") != cell["sectorId"]:
                continue
            choice = choices.get((employee["id"], cell["weekId"]))
            if choice is not None:
                add_to(row, choice, float(employee["contractHours"]))
        for pool in payload["reinforcementPools"]:
            variable = reinforcement.get((pool["id"], cell["sectorId"], cell["weekId"]))
            if variable is not None:
                add_to(row, variable, -1.0)
        # absent - reinforcement - deficit <= base - minimum
        model.constraint(row, upper=float(cell["baseContractHours"]) - float(cell["minimumHours"]))

    objectives: list[tuple[str, dict[int, float]]] = []
    objectives.append(("priority_common_weeks", {index: -1.0 for index, _ in common_variables}))
    objectives.append(("priority_seniority", {index: -float(weight) for index, weight in common_variables}))
    for rank in (1, 2, 3):
        objectives.append((
            f"wish_{rank}",
            {index: -1.0 for key, index in choices.items() if choice_rank[key] == rank},
        ))
    objectives.append(("mixed_plans", {index: 1.0 for index in mixed_variables}))
    objectives.append(("coverage_deficit", {index: 1.0 for index in deficit_variables}))
    max_history = max((int(employee["firstChoiceHistory"]) for employee in payload["employees"]), default=0)
    objectives.append((
        "equity",
        {
            index: -float(max_history - int(employees[employee_id]["firstChoiceHistory"]) + 1)
            for (employee_id, week_id), index in choices.items()
            if choice_rank[(employee_id, week_id)] == 1
        },
    ))
    objectives.append(("reinforcement_used", {index: 1.0 for index in reinforcement.values()}))

    solution = None
    objective_values: dict[str, float] = {}
    for name, objective in objectives:
        if not objective:
            objective_values[name] = 0.0
            continue
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return failure("non_optimal", "Le temps imparti ne permet pas de prouver l’optimum.", started)
        result, vector = model.solve(objective, remaining)
        if result.status == 2:
            return failure("infeasible", "Aucune attribution ne respecte les minimums et leurs marges.", started)
        if result.status != 0 or result.x is None:
            return failure("non_optimal", "Le solveur n’a pas prouvé l’optimum de tous les objectifs.", started)
        solution = result.x
        value = float(np.dot(vector, solution))
        objective_values[name] = round(-value if name.startswith("wish_") or name.startswith("priority_") or name == "equity" else value, 6)
        tolerance = 1e-7 if all(model.variables[index].integral for index in objective) else 1e-6
        model.constraint(objective, value - tolerance, value + tolerance)

    if solution is None:
        result, _ = model.solve({}, max(0.1, deadline - time.monotonic()))
        if result.status != 0 or result.x is None:
            return failure("non_optimal", "Le solveur n’a pas prouvé l’optimum.", started)
        solution = result.x

    grants: dict[str, list[str]] = {employee["id"]: [] for employee in payload["employees"]}
    for (employee_id, week_id), index in choices.items():
        if solution[index] > 0.5:
            grants[employee_id].append(week_id)
    for weeks in grants.values():
        weeks.sort()

    allocations: list[dict[str, Any]] = []
    for (pool_id, sector_id, week_id), index in reinforcement.items():
        hours = float(solution[index])
        if hours > 1e-6:
            allocations.append({
                "poolId": pool_id,
                "sectorId": sector_id,
                "weekId": week_id,
                "hours": round(hours, 4),
            })

    return {
        "status": "optimal",
        "grants": grants,
        "reinforcementAllocations": allocations,
        "objectiveValues": objective_values,
        "durationMs": round((time.monotonic() - started) * 1000),
    }


def failure(status: str, message: str, started: float) -> dict[str, Any]:
    return {
        "status": status,
        "message": message,
        "durationMs": round((time.monotonic() - started) * 1000),
    }


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        response = main(request)
    except Exception as exc:  # The route translates this to a non-applicable error.
        response = {"status": "error", "message": str(exc), "durationMs": 0}
    sys.stdout.write(json.dumps(response, ensure_ascii=False))
