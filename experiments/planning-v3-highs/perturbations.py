"""A deterministic perturbation campaign around the canonical Drive week.

Why a campaign and not more fixtures
------------------------------------
Three scenarios say the engine answers three problems. They say nothing about
the shape of its failure elsewhere, and a heuristic that is excellent on its
development case and brittle one step away is worse than a slow one that
degrades predictably — because the brittleness is invisible until a real roster
hits it.

So this walks OUT from Drive along the six axes a real sector actually moves on,
one axis at a time, and asks the same three questions of every result: is it
legal, is it honest about what it could not do, and how long did it take.

Coherence is decided BEFORE running
-----------------------------------
A perturbation can make a week genuinely impossible — take a day's budget below
what the available people must work, or leave someone a contract their remaining
days cannot hold. Those are not engine failures and must not be counted as such,
so every scenario is classified first, by arithmetic that has nothing to do with
the solver:

``feasible``    every necessary condition holds. The engine must NOT answer
                `infeasible-proven`; if it does, that is a false diagnostic and
                the oracle is asked to settle it.
``impossible``  a necessary condition fails. `infeasible-proven` is then the
                correct answer, and a schedule would be the defect.

The conditions are necessary, not sufficient — a `feasible` scenario can still
turn out impossible for a subtler reason involving rest or roles. That is why a
disagreement is escalated to the oracle rather than reported as a verdict.

Nothing here is random. The scenario list is a fixed enumeration, so two runs on
two machines produce the same set in the same order.

    experiments/planning-v3-highs> python perturbations.py --time-limit 60
    experiments/planning-v3-highs> python perturbations.py --oracle --oracle-time-limit 300
"""

from __future__ import annotations

import argparse
import copy
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterator

from shiftos_highs.demand import _daily_ceiling
from shiftos_highs.fingerprint import fingerprint_problem

ROOT = Path(__file__).resolve().parent
FIXTURES = ROOT / "fixtures" / "perturbations"
RESULTS = ROOT / "results" / "perturbations"

WEEKDAYS = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)


# ── Coherence ───────────────────────────────────────────────────────────────


def _employees(problem: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(problem["employees"], key=lambda item: str(item["id"]))


def _open_days(problem: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted([d for d in problem["days"] if not d["closed"]], key=lambda d: d["date"])


def _entry(problem: dict[str, Any], employee_id: str, date: str) -> dict[str, Any] | None:
    for item in problem["employeeDays"]:
        if str(item["employeeId"]) == employee_id and item["date"] == date:
            return item
    return None


def _cell_bounds(problem: dict[str, Any], employee: dict[str, Any], date: str) -> tuple[int, int]:
    """What this person must and may work on this day, or (0, 0) if away."""
    entry = _entry(problem, str(employee["id"]), date)
    if entry is None or not entry["available"]:
        return (0, 0)
    rules = problem["rules"]
    step = int(problem["timeStepMinutes"])
    ceiling = _daily_ceiling(employee, entry, rules)
    minimum = max(int(employee["minimumDailyMinutes"]), int(rules["minimumShiftMinutes"]))
    minimum = -(-minimum // step) * step
    return (minimum, (ceiling // step) * step)


def _close_day(entry: dict[str, Any]) -> None:
    """Mark a day as not worked, the way the builder represents it."""
    entry["available"] = False
    entry["fixedRest"] = True
    entry["mandatory"] = False
    # The ceiling goes to zero WITH the flag. A rest day the builder produces
    # carries `maximumMinutes: 0`, and leaving a non-zero one behind would
    # describe a roster the application cannot emit.
    entry["maximumMinutes"] = 0


def _open_day(entry: dict[str, Any], employee: dict[str, Any], day: dict[str, Any]) -> None:
    """Make a day workable again, ceiling and window included.

    Flipping `available` alone is not enough and fails silently. A rest day
    carries `maximumMinutes: 0`; flip the flag without restoring the ceiling and
    the day is nominally workable with a maximum of nothing, so no shift of any
    length fits. The first version of this campaign did exactly that, and the
    whole fixed-rest axis came back with no legal schedule — a result about the
    generator, reported as a result about the engine, until the oracle called the
    problem malformed rather than hard.
    """
    entry["available"] = True
    entry["fixedRest"] = False
    entry["mandatory"] = True
    entry["maximumMinutes"] = int(employee["maximumDailyMinutes"])
    if not entry.get("earliestStartMinutes") and not entry.get("latestEndMinutes"):
        entry["earliestStartMinutes"] = int(day["opensAtMinutes"])
        entry["latestEndMinutes"] = int(day["closesAtMinutes"])


def coherence(problem: dict[str, Any]) -> list[str]:
    """Necessary conditions, checked by arithmetic. Empty means none failed."""
    problems: list[str] = []
    step = int(problem["timeStepMinutes"])
    days = _open_days(problem)
    employees = _employees(problem)

    total_contracts = sum(int(e["contractMinutes"]) for e in employees)
    total_budget = sum(int(d["budgetMinutes"]) for d in days)
    if total_contracts != total_budget:
        problems.append(f"contrats {total_contracts} ≠ budgets {total_budget}")

    for day in days:
        low = high = 0
        for employee in employees:
            minimum, maximum = _cell_bounds(problem, employee, day["date"])
            low += minimum
            high += maximum
        budget = int(day["budgetMinutes"])
        if budget < low:
            problems.append(f"{day['date']}: budget {budget} < minimum imposé {low}")
        if budget > high:
            problems.append(f"{day['date']}: budget {budget} > capacité {high}")
        if budget % step:
            problems.append(f"{day['date']}: budget {budget} hors du pas de {step}")

    for employee in employees:
        low = high = 0
        for day in days:
            minimum, maximum = _cell_bounds(problem, employee, day["date"])
            low += minimum
            high += maximum
        contract = int(employee["contractMinutes"])
        if contract < low:
            problems.append(f"{employee['id']}: contrat {contract} < minimum imposé {low}")
        if contract > high:
            problems.append(f"{employee['id']}: contrat {contract} > capacité {high}")

    for day in days:
        openable = sum(
            1
            for employee in employees
            if employee["canOpen"]
            and (entry := _entry(problem, str(employee["id"]), day["date"])) is not None
            and entry["available"]
            and int(entry["earliestStartMinutes"]) <= int(day["opensAtMinutes"])
        )
        if openable < int(problem["rules"]["minimumOpeningsPerDay"]):
            problems.append(f"{day['date']}: {openable} ouvreur(s) possible(s)")
        closable = sum(
            1
            for employee in employees
            if employee["canClose"]
            and (entry := _entry(problem, str(employee["id"]), day["date"])) is not None
            and entry["available"]
            and int(entry["latestEndMinutes"]) >= int(day["closesAtMinutes"])
        )
        if closable < int(problem["rules"]["exactClosingsPerDay"]):
            problems.append(f"{day['date']}: {closable} fermeur(s) possible(s)")

    return problems


def rebalance(problem: dict[str, Any]) -> bool:
    """Push the daily budgets back onto the contracts, in step multiples.

    Deterministic by construction: days are visited in date order and every move
    is one step, so the same input always produces the same budgets.
    """
    step = int(problem["timeStepMinutes"])
    days = _open_days(problem)
    employees = _employees(problem)
    target = sum(int(e["contractMinutes"]) for e in employees)

    bounds: dict[str, tuple[int, int]] = {}
    for day in days:
        low = high = 0
        for employee in employees:
            minimum, maximum = _cell_bounds(problem, employee, day["date"])
            low += minimum
            high += maximum
        bounds[day["date"]] = (low, high)
        day["budgetMinutes"] = max(low, min(high, int(day["budgetMinutes"])))

    for _ in range(1_000):
        delta = target - sum(int(d["budgetMinutes"]) for d in days)
        if delta == 0:
            return True
        moved = False
        for day in days:
            if delta == 0:
                break
            low, high = bounds[day["date"]]
            if delta > 0 and int(day["budgetMinutes"]) + step <= high:
                day["budgetMinutes"] = int(day["budgetMinutes"]) + step
                delta -= step
                moved = True
            elif delta < 0 and int(day["budgetMinutes"]) - step >= low:
                day["budgetMinutes"] = int(day["budgetMinutes"]) - step
                delta += step
                moved = True
        if not moved:
            return False
    return False


# ── The six axes ────────────────────────────────────────────────────────────

Scenario = tuple[str, str, str, dict[str, Any]]


def _peak_slot(problem: dict[str, Any], date: str) -> dict[str, Any] | None:
    slots = [s for s in problem["demandSlots"] if s["date"] == date]
    if not slots:
        return None
    return max(slots, key=lambda s: (int(s["requiredEmployees"]), -int(s["startMinutes"])))


def axis_demand(base: dict[str, Any]) -> Iterator[Scenario]:
    """Move the demand in quarter-hours, and change how much of it there is."""
    step = int(base["timeStepMinutes"])
    for multiple in (-2, -1, 1, 2):
        shift = multiple * step
        problem = copy.deepcopy(base)
        # Closed days carry no opening hour at all, so the map is built from the
        # open ones and a slot outside it is left where it is.
        opens = {d["date"]: int(d["opensAtMinutes"]) for d in _open_days(problem)}
        closes = {d["date"]: int(d["closesAtMinutes"]) for d in _open_days(problem)}
        for slot in problem["demandSlots"]:
            if slot["date"] not in opens:
                continue
            low, high = opens[slot["date"]], closes[slot["date"]]
            slot["startMinutes"] = max(low, min(high - step, int(slot["startMinutes"]) + shift))
            slot["endMinutes"] = max(
                slot["startMinutes"] + step, min(high, int(slot["endMinutes"]) + shift)
            )
        yield (
            f"demande-decalage{shift:+d}",
            "demande",
            f"toute la demande décalée de {shift:+d} minutes",
            problem,
        )

    for day in _open_days(base):
        for delta in (1, -1):
            problem = copy.deepcopy(base)
            slot = _peak_slot(problem, day["date"])
            if slot is None:
                continue
            wanted = int(slot["requiredEmployees"]) + delta
            if wanted < int(slot["hardMinimumEmployees"] or 0) or wanted > len(base["employees"]):
                continue
            slot["requiredEmployees"] = wanted
            yield (
                f"demande-pic{delta:+d}-{day['date']}",
                "demande",
                f"pic du {day['date']} porté à {wanted} personnes",
                problem,
            )


def axis_fixed_rest(base: dict[str, Any]) -> Iterator[Scenario]:
    """Move one person's fixed rest onto a different weekday."""
    days = _open_days(base)
    open_weekdays = [d["weekDay"] for d in days]
    for employee in _employees(base):
        # Derived from the actual `employeeDays`, not from `fixedRestDays`.
        #
        # The two do not always agree: a roster may leave someone off an open
        # day through the day entry alone and never name the weekday in the
        # employee's declared rests. Reading the declaration missed three of the
        # five people here and left this axis with two scenarios out of five.
        # Availability is what the solver acts on, so availability is what a
        # perturbation of it has to start from.
        current = [
            day["weekDay"]
            for day in days
            if (entry := _entry(base, str(employee["id"]), day["date"])) is not None
            and not entry["available"]
        ]
        if not current:
            continue
        for target in open_weekdays:
            if target in current:
                continue
            problem = copy.deepcopy(base)
            person = next(e for e in problem["employees"] if str(e["id"]) == str(employee["id"]))
            person["fixedRestDays"] = sorted(
                set(person["fixedRestDays"]) - {current[0]} | {target}
            )
            person["workingDays"] = sorted(
                set(person["workingDays"]) - {target} | {current[0]},
                key=WEEKDAYS.index,
            )
            for day in problem["days"]:
                entry = _entry(problem, str(employee["id"]), day["date"])
                if entry is None:
                    continue
                if day["weekDay"] == target:
                    _close_day(entry)
                elif day["weekDay"] == current[0] and not day["closed"]:
                    _open_day(entry, person, day)
            if not rebalance(problem):
                continue
            yield (
                f"repos-{employee['id']}-{target}",
                "repos-fixes",
                f"{employee['id']} se repose {target} au lieu de {current[0]}",
                problem,
            )
            break  # one target per person keeps the campaign readable

    # Moving a rest only reaches the people who have one. Granting a rest to
    # someone who works every open day is the same axis from the other side, and
    # it is the harder question: the week loses a body it was counting on and the
    # remaining days have to absorb both the coverage and that person's contract.
    for employee in _employees(base):
        rested = [
            day["weekDay"]
            for day in days
            if (entry := _entry(base, str(employee["id"]), day["date"])) is not None
            and not entry["available"]
        ]
        if rested:
            continue
        for target in open_weekdays:
            problem = copy.deepcopy(base)
            person = next(e for e in problem["employees"] if str(e["id"]) == str(employee["id"]))
            person["fixedRestDays"] = sorted(set(person["fixedRestDays"]) | {target})
            person["workingDays"] = sorted(
                set(person["workingDays"]) - {target}, key=WEEKDAYS.index
            )
            for day in problem["days"]:
                if day["weekDay"] != target:
                    continue
                entry = _entry(problem, str(employee["id"]), day["date"])
                if entry is not None:
                    _close_day(entry)
            if not rebalance(problem):
                continue
            yield (
                f"repos-ajoute-{employee['id']}-{target}",
                "repos-fixes",
                f"{employee['id']} gagne un repos le {target}",
                problem,
            )
            break


def axis_earliest_start(base: dict[str, Any]) -> Iterator[Scenario]:
    """Change when someone may first arrive."""
    step = int(base["timeStepMinutes"])
    for employee in _employees(base)[:3]:
        for minutes in (360, 420, 480, 540):
            problem = copy.deepcopy(base)
            touched = False
            for entry in problem["employeeDays"]:
                if str(entry["employeeId"]) != str(employee["id"]):
                    continue
                if int(entry["earliestStartMinutes"]) == minutes:
                    continue
                entry["earliestStartMinutes"] = minutes
                touched = True
            if not touched:
                continue
            hours, rest = divmod(minutes, 60)
            yield (
                f"debut-{employee['id']}-{minutes}",
                "heure-de-debut",
                f"{employee['id']} ne peut pas commencer avant {hours:02d}h{rest:02d}",
                problem,
            )


def axis_absence(base: dict[str, Any]) -> Iterator[Scenario]:
    """One person away for one, two or three days."""
    days = _open_days(base)
    for employee in _employees(base):
        for count in (1, 2, 3):
            problem = copy.deepcopy(base)
            away = [
                day
                for day in days
                if (entry := _entry(problem, str(employee["id"]), day["date"])) is not None
                and entry["available"]
            ][:count]
            if len(away) < count:
                continue
            for day in away:
                entry = _entry(problem, str(employee["id"]), day["date"])
                assert entry is not None
                _close_day(entry)
                # An absence is not a fixed rest. Both stop the day being worked
                # and the solver treats them alike, but conflating them in the
                # fixture would describe the wrong roster.
                entry["fixedRest"] = False
            if not rebalance(problem):
                continue
            yield (
                f"absence-{employee['id']}-{count}j",
                "absences",
                f"{employee['id']} absent {count} jour(s) : "
                + ", ".join(day["date"] for day in away),
                problem,
            )


def axis_budgets(base: dict[str, Any]) -> Iterator[Scenario]:
    """Move minutes between two days, keeping the weekly total exact."""
    days = _open_days(base)
    for offset in (1, 2, 3):
        for amount in (15, 60, 120):
            problem = copy.deepcopy(base)
            source = _open_days(problem)[0]
            target = _open_days(problem)[offset]
            source["budgetMinutes"] = int(source["budgetMinutes"]) - amount
            target["budgetMinutes"] = int(target["budgetMinutes"]) + amount
            yield (
                f"budget-{amount}min-j0-vers-j{offset}",
                "budgets",
                f"{amount} minutes déplacées du {source['date']} vers {target['date']}",
                problem,
            )
    # And one that goes too far on purpose, to check the engine says so.
    problem = copy.deepcopy(base)
    open_days = _open_days(problem)
    open_days[0]["budgetMinutes"] = int(open_days[0]["budgetMinutes"]) - 600
    open_days[1]["budgetMinutes"] = int(open_days[1]["budgetMinutes"]) + 600
    yield (
        "budget-600min-j0-vers-j1",
        "budgets",
        f"600 minutes déplacées du {open_days[0]['date']} vers {open_days[1]['date']}",
        problem,
    )
    _ = days


def axis_splits(base: dict[str, Any]) -> Iterator[Scenario]:
    """Take away the right to split, one person at a time, then everyone."""
    people = _employees(base)
    for count in (1, 2, 3, 5):
        problem = copy.deepcopy(base)
        for employee in _employees(problem)[:count]:
            employee["canSplitShift"] = False
        names = ", ".join(str(e["id"]) for e in people[:count])
        yield (
            f"coupures-interdites-{count}",
            "coupures",
            f"coupure retirée à {names}",
            problem,
        )
    problem = copy.deepcopy(base)
    problem["rules"]["splitShiftAllowed"] = False
    yield ("coupures-interdites-secteur", "coupures", "coupure interdite au niveau du secteur", problem)


AXES: tuple[tuple[str, Callable[[dict[str, Any]], Iterator[Scenario]]], ...] = (
    ("demande", axis_demand),
    ("repos-fixes", axis_fixed_rest),
    ("heure-de-debut", axis_earliest_start),
    ("absences", axis_absence),
    ("budgets", axis_budgets),
    ("coupures", axis_splits),
)


def build_scenarios(base: dict[str, Any]) -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []
    # Deduplicated on the WHOLE problem, not on its fingerprint.
    #
    # `fingerprint_problem` is blind to `earliestStartMinutes`,
    # `latestEndMinutes`, `available`, `canSplitShift` and
    # `maximumDailyMinutes`. Deduplicating on it silently deleted three entire
    # axes of this campaign — every start-hour scenario, every split-capability
    # scenario, and the one and two day absences — because each looked like the
    # baseline. Two materially different weeks sharing one identity is a defect
    # in its own right; it is reported, not worked around, and the campaign
    # simply compares the problems themselves.
    seen: set[str] = {json.dumps(base, sort_keys=True, ensure_ascii=False)}
    for _name, generate in AXES:
        for identifier, axis, description, problem in generate(base):
            key = json.dumps(problem, sort_keys=True, ensure_ascii=False)
            if key in seen:
                continue
            seen.add(key)
            fingerprint = fingerprint_problem(problem)
            failures = coherence(problem)
            scenarios.append(
                {
                    "id": identifier,
                    "axis": axis,
                    "description": description,
                    "fingerprint": fingerprint,
                    "expected": "impossible" if failures else "feasible",
                    "coherence": failures,
                    "problem": problem,
                }
            )
    return scenarios


# ── Running ─────────────────────────────────────────────────────────────────


def _run_isolated(
    problem_path: Path,
    output_path: Path,
    *,
    time_limit: float,
    wall_limit: float,
) -> tuple[dict[str, Any], str | None]:
    """One scenario, in its own process, under a hard wall-clock kill.

    The engine's own budget is a set of `remaining()` checks BETWEEN operations,
    so it bounds how many things are attempted, not how long any single one
    takes. The campaign measured a scenario running 551 seconds against a
    60-second budget: a peak raised by one person widened the shift enumeration,
    and that enumeration is a nested loop with no clock in it.

    That overrun is a finding, not something to paper over — so the harness
    measures it instead of preventing it, and only kills a run once it is clearly
    runaway. A killed scenario is recorded as `wall-clock-exceeded`, never as a
    solver verdict, because "we stopped watching" and "the engine answered" are
    different facts and must not share a status.

    Isolating each run also means a crash costs one scenario rather than the
    campaign.
    """
    command = [
        sys.executable,
        "-X",
        "utf8",
        str(ROOT / "solve_fast.py"),
        str(problem_path),
        "--output",
        str(output_path),
        "--time-limit",
        str(time_limit),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=wall_limit,
            check=False,
        )
    except subprocess.TimeoutExpired:
        result = {
            "status": "wall-clock-exceeded",
            "solution": None,
            "diagnostics": {"wallLimitSeconds": wall_limit, "proof": "none"},
        }
        output_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return result, None

    if output_path.exists():
        return json.loads(output_path.read_text(encoding="utf-8")), None

    detail = (completed.stderr or completed.stdout or "").strip()[:400]
    result = {
        "status": "backend-error",
        "solution": None,
        "diagnostics": {"error": detail, "returnCode": completed.returncode, "proof": "none"},
    }
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result, detail or f"code de retour {completed.returncode}"


def run_oracle(scenarios: list[dict[str, Any]], time_limit: float) -> None:
    """`v3-highs-global` on one scenario per axis, as the standard of comparison.

    A subset, because the oracle asks one enormous question and takes minutes to
    answer it — running all fifty-six would cost hours and add nothing. What it
    is here for is to settle the two claims the fast engine cannot settle about
    itself: that a week it called impossible really is, and that a deficit it
    reports is the week's and not its own.

    The first FEASIBLE scenario of each axis, in campaign order. Deterministic,
    and chosen without looking at any result.
    """
    from shiftos_highs import solve

    def fast_result(scenario: dict[str, Any]) -> dict[str, Any]:
        path = RESULTS / f"{scenario['id']}-fast.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    chosen: dict[str, dict[str, Any]] = {}
    reasons: dict[str, str] = {}

    def pick(key: str, scenario: dict[str, Any], reason: str) -> None:
        if key not in chosen:
            chosen[key] = scenario
            reasons[key] = reason

    # One representative per axis, chosen without looking at any result.
    for scenario in scenarios:
        if scenario["expected"] == "feasible":
            pick(f"axe::{scenario['axis']}", scenario, "représentant d'axe")

    for scenario in scenarios:
        result = fast_result(scenario)
        status = result.get("status")
        diagnostics = result.get("diagnostics") or {}

        # Every week the fast engine called impossible. A false one of those is
        # the most expensive answer this engine can give — it tells a manager
        # their shop cannot open.
        if status == "infeasible-proven":
            pick(f"infaisable::{scenario['id']}", scenario, "infaisabilité contestée")

        # And every week arithmetic says is staffable where the fast engine came
        # back with nothing. Not a false claim, but a silent one, and only the
        # oracle can say whether the week or the search ran out.
        if scenario["expected"] == "feasible" and status not in {
            "feasible-zero-deficit",
            "feasible-best-effort",
        }:
            pick(f"muet::{scenario['id']}", scenario, "aucune solution rendue")

    # The worst measured shortfall of each axis, so the quality gap is measured
    # where it is widest rather than where it happens to be comfortable.
    worst_by_axis: dict[str, tuple[tuple[int, int], dict[str, Any]]] = {}
    for scenario in scenarios:
        diagnostics = fast_result(scenario).get("diagnostics") or {}
        slots = diagnostics.get("referenceShortSlots")
        minutes = diagnostics.get("referenceDeficitMinutes")
        if not slots:
            continue
        key = (int(slots), int(minutes))
        current = worst_by_axis.get(scenario["axis"])
        if current is None or key > current[0]:
            worst_by_axis[scenario["axis"]] = (key, scenario)
    for axis, (_gap, scenario) in sorted(worst_by_axis.items()):
        pick(f"pire::{axis}", scenario, "pire écart de l'axe")

    comparisons: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for key, scenario in sorted(chosen.items()):
        if scenario["id"] in seen_ids:
            continue
        seen_ids.add(scenario["id"])
        started = time.perf_counter()
        result = solve(scenario["problem"], time_limit_seconds=time_limit)
        seconds = time.perf_counter() - started
        (RESULTS / f"{scenario['id']}-oracle.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        fast_path = RESULTS / f"{scenario['id']}-fast.json"
        fast = json.loads(fast_path.read_text(encoding="utf-8")) if fast_path.exists() else {}
        evaluation = result.get("evaluation") or {}
        entry = {
            "id": scenario["id"],
            "axis": scenario["axis"],
            "reason": reasons[key],
            "oracleStatus": result["status"],
            "oracleSeconds": round(seconds, 2),
            "oracleShortSlots": evaluation.get("underCoveredSlots"),
            "oracleDeficitMinutes": evaluation.get("totalDeficitMinutes"),
            "fastStatus": fast.get("status"),
            "fastSeconds": (fast.get("diagnostics") or {}).get("totalSeconds"),
            "fastShortSlots": (fast.get("diagnostics") or {}).get("referenceShortSlots"),
            "fastDeficitMinutes": (fast.get("diagnostics") or {}).get("referenceDeficitMinutes"),
        }
        comparisons.append(entry)
        print(
            f"  {scenario['id']:44} oracle {entry['oracleStatus']:20} "
            f"{entry['oracleShortSlots']}/{entry['oracleDeficitMinutes']} en "
            f"{entry['oracleSeconds']:7.2f}s | rapide {entry['fastShortSlots']}/"
            f"{entry['fastDeficitMinutes']}",
            flush=True,
        )

    (RESULTS / "oracle-comparison.json").write_text(
        json.dumps(
            {"oracleTimeLimitSeconds": time_limit, "comparisons": comparisons},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Campagne de perturbations autour de Drive")
    parser.add_argument("--time-limit", type=float, default=60.0)
    parser.add_argument("--only", type=str, default=None, help="n'exécuter qu'un axe")
    parser.add_argument("--list", action="store_true", help="lister sans exécuter")
    parser.add_argument(
        "--oracle", action="store_true", help="comparer un sous-ensemble à v3-highs-global"
    )
    parser.add_argument("--oracle-time-limit", type=float, default=300.0)
    parser.add_argument(
        "--wall-limit",
        type=float,
        default=240.0,
        help="arrêt matériel par scénario, bien au-dessus du budget annoncé",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="réutiliser les résultats déjà écrits, rejouer seulement les runs tués",
    )
    args = parser.parse_args()

    base = json.loads((ROOT / "fixtures/drive-canonical-problem.json").read_text(encoding="utf-8"))
    scenarios = build_scenarios(base)
    if args.only:
        scenarios = [s for s in scenarios if s["axis"] == args.only]

    FIXTURES.mkdir(parents=True, exist_ok=True)
    RESULTS.mkdir(parents=True, exist_ok=True)

    if args.list:
        for scenario in scenarios:
            print(f"{scenario['id']:44} {scenario['axis']:16} {scenario['expected']}")
        print(f"\n{len(scenarios)} scénarios")
        return 0

    if args.oracle:
        run_oracle(scenarios, args.oracle_time_limit)
        return 0

    # Wall times from a previous pass, so `--resume` can rebuild the summary
    # without re-measuring what already has an artefact.
    previous: dict[str, dict[str, Any]] = {}
    summary_path = RESULTS / "summary.json"
    if args.resume and summary_path.exists():
        for row in json.loads(summary_path.read_text(encoding="utf-8"))["scenarios"]:
            previous[row["id"]] = row

    summary: list[dict[str, Any]] = []
    for index, scenario in enumerate(scenarios, start=1):
        problem = scenario["problem"]
        (FIXTURES / f"{scenario['id']}-problem.json").write_text(
            json.dumps(problem, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        cached = None
        output_path = RESULTS / f"{scenario['id']}-fast.json"
        if args.resume and output_path.exists():
            candidate = json.loads(output_path.read_text(encoding="utf-8"))
            # A wall-clock kill or a crash is not an answer, so those are always
            # re-run. Anything the solver actually said is kept.
            if candidate.get("status") not in {"wall-clock-exceeded", "backend-error"}:
                cached = candidate

        started = time.perf_counter()
        if cached is not None:
            result, crash = cached, None
            earlier = previous.get(scenario["id"])
            engine = (result.get("diagnostics") or {}).get("totalSeconds")
            # The stored wall time is only reused when the status still matches.
            # A run that was killed and has since been re-measured must not carry
            # the killed run's clock — that clock includes a system sleep and is
            # not a measurement of anything.
            if earlier is not None and earlier.get("status") == result.get("status"):
                seconds = float(earlier["seconds"])
            else:
                seconds = float(engine or 0.0)
        else:
            result, crash = _run_isolated(
                FIXTURES / f"{scenario['id']}-problem.json",
                output_path,
                time_limit=args.time_limit,
                wall_limit=args.wall_limit,
            )
            seconds = time.perf_counter() - started

        diagnostics = result.get("diagnostics", {})
        entry = {
            "id": scenario["id"],
            "axis": scenario["axis"],
            "description": scenario["description"],
            "fingerprint": scenario["fingerprint"],
            "expected": scenario["expected"],
            "coherence": scenario["coherence"],
            "status": result["status"],
            "seconds": round(seconds, 2),
            "engineSeconds": diagnostics.get("totalSeconds"),
            "referenceShortSlots": diagnostics.get("referenceShortSlots"),
            "referenceDeficitMinutes": diagnostics.get("referenceDeficitMinutes"),
            "adaptedShortSlots": diagnostics.get("adaptedTargetShortSlots"),
            "adaptedDeficitMinutes": diagnostics.get("adaptedTargetDeficitMinutes"),
            "proof": diagnostics.get("proof"),
            "solutionFingerprint": result.get("solutionFingerprint"),
            "usedFallback": diagnostics.get("usedAllocationFirstFallback"),
            "probeDisagreements": diagnostics.get("probeDisagreements"),
            # Wall clock against the budget the engine was GIVEN. Anything above
            # it is the engine overrunning its own limit, which is a robustness
            # figure in its own right and never gets rounded away here.
            "budgetOverrunSeconds": round(max(0.0, seconds - args.time_limit), 2),
            "crash": crash,
        }
        summary.append(entry)
        print(
            f"[{index:2}/{len(scenarios)}] {scenario['id']:44} {entry['status']:24} "
            f"{entry['referenceShortSlots']}/{entry['referenceDeficitMinutes']} "
            f"{entry['seconds']:6.2f}s  attendu={scenario['expected']}",
            flush=True,
        )

    (RESULTS / "summary.json").write_text(
        json.dumps(
            {"timeLimitSeconds": args.time_limit, "scenarios": summary},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\n{len(summary)} scénarios écrits dans {RESULTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
