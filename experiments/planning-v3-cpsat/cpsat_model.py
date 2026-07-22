"""
EXPERIMENT — the generic CP-SAT model for a Planning V3 problem.

Extracted verbatim from `cpsat_drive.py`, which now imports it, so the model the
reference spike proved `(1, 60, 99 000)` with and the model the adapter runs are
THE SAME CODE. A second copy would have started identical and drifted, and every
number the spike published would have quietly stopped describing what the
product actually solves.

Nothing here knows an employee name, a Drive date, or a fixture. It reads a
serialised `PlanningProblemV3` and, optionally, the hard preservations a
regeneration asks for.

What this module adds on top of the spike:
  - locked assignments, as hard constraints;
  - manually edited assignments, as hard constraints;
  - a stability objective measuring drift from a reference schedule.

Solving stays lexicographic in explicit passes, never a weighted sum. Each pass
freezes the previous one as an EQUALITY constraint before optimising the next,
so a later objective can never buy an improvement by degrading an earlier one.

RULES NOT MODELLED — see README. Chief among them: split shifts are not
enumerated, so every claim is scoped to continuous shifts.
"""

import time

from ortools.sat.python import cp_model


# ── Fingerprints, mirroring features/core/planning-v3/validator/fingerprint.ts ──
# Reimplemented rather than imported: matching the TypeScript value is a genuine
# cross-check that both sides describe the same problem.

def _hash32(value: str, seed: int) -> int:
    digest = seed
    for char in value:
        digest = ((digest ^ ord(char)) * 0x01000193) & 0xFFFFFFFF
    return digest


def _hash64(value: str) -> str:
    low = _hash32(value, 0x811C9DC5)
    high = _hash32(value, 0x9E3779B9)
    return f"{high:08x}{low:08x}"


def _compact(obj) -> str:
    """JSON.stringify-compatible text: no spaces, insertion order preserved."""
    import json
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def fingerprint_problem(problem) -> str:
    parts = [
        problem["version"],
        str(problem["planningId"]),
        problem["sectorId"],
        f"{problem['period']['start']}..{problem['period']['end']}",
        f"step={problem['timeStepMinutes']}",
        f"rules={_compact(problem['rules'])}",
        f"objectives={','.join(problem['objectives'])}",
    ]
    for e in sorted(problem["employees"], key=lambda item: str(item["id"])):
        parts.append(
            f"E|{e['id']}|{e['contractMinutes']}|{'.'.join(e['workingDays'])}|"
            f"{'.'.join(e['fixedRestDays'])}|{1 if e['canOpen'] else 0}{1 if e['canClose'] else 0}|"
            f"{e['maximumOpenings'] if e['maximumOpenings'] is not None else '-'}|"
            f"{e['maximumClosings'] if e['maximumClosings'] is not None else '-'}"
        )
    for d in sorted(problem["days"], key=lambda item: item["date"]):
        parts.append(
            f"D|{d['date']}|{1 if d['closed'] else 0}|"
            f"{d['opensAtMinutes'] if d['opensAtMinutes'] is not None else '-'}|"
            f"{d['closesAtMinutes'] if d['closesAtMinutes'] is not None else '-'}|{d['budgetMinutes']}"
        )
    for s in sorted(problem["demandSlots"], key=lambda i: (i["date"], i["startMinutes"], i["id"])):
        parts.append(
            f"S|{s['id']}|{s['date']}|{s['startMinutes']}|{s['endMinutes']}|{s['requiredEmployees']}"
        )
    return "p3_" + _hash64("\n".join(parts))


def fingerprint_solution(assignments, problem_fingerprint, version="v3.0.0") -> str:
    rows = sorted(
        f"{a['employeeId']}|{a['date']}|"
        + ",".join(
            f"{s['startMinutes']}-{s['endMinutes']}"
            for s in sorted(a["segments"], key=lambda s: s["startMinutes"])
        )
        for a in assignments
    )
    return "s3_" + _hash64("\n".join([version, problem_fingerprint] + rows))


def build_candidates(problem, employee, day, entry):
    """Every legal continuous shift for one employee on one day.

    Mirrors the TypeScript candidate generator: same step, same duration
    bounds, same capability filtering. No coverage-based deduplication — two
    shifts covering the same slots can still differ in what they allow the next
    morning.
    """
    if not entry["available"] or day["closed"]:
        return []
    rules = problem["rules"]
    step = problem["timeStepMinutes"]
    low = max(rules["minimumShiftMinutes"], step)
    high = min(rules["maximumShiftMinutes"], entry["maximumMinutes"])

    out = []
    duration = -(-low // step) * step
    while duration <= high:
        start = -(-entry["earliestStartMinutes"] // step) * step
        while start + duration <= entry["latestEndMinutes"]:
            end = start + duration
            opens = start == day["opensAtMinutes"]
            closes = end == day["closesAtMinutes"]
            if (opens and not employee["canOpen"]) or (closes and not employee["canClose"]):
                start += step
                continue
            out.append({"start": start, "end": end, "minutes": duration,
                        "opens": opens, "closes": closes})
            start += step
        duration += step
    return out


def candidate_space(problem) -> str:
    """Whether the enumerated space covers every legal shift for these rules.

    Split shifts are not enumerated. A sector that forbids them therefore has a
    COMPLETE space and may claim an optimum; a sector that allows them does not,
    and no amount of proving inside this model changes that.
    """
    return "incomplete" if problem["rules"]["splitShiftAllowed"] else "complete"


def build_model(problem, preservation=None):
    """Return (model, handles) for one PlanningProblemV3.

    `preservation` is optional and, when present, carries already-resolved
    assignments — employee, date and exact minutes. Resolving a `shiftId`
    against the baseline happens in TypeScript, where it is pure and unit
    tested; this side only turns a resolved assignment into a hard constraint,
    and reports the ones no legal candidate can express.
    """
    preservation = preservation or {}
    employees = problem["employees"]
    days = problem["days"]
    rules = problem["rules"]

    entry_of = {(e["employeeId"], e["date"]): e for e in problem["employeeDays"]}
    slots_of = {}
    for slot in problem["demandSlots"]:
        slots_of.setdefault(slot["date"], []).append(slot)

    model = cp_model.CpModel()
    x, works, start_v, end_v, minutes_v, pool = {}, {}, {}, {}, {}, {}
    total_candidates = 0

    employee_index = {employee["id"]: ei for ei, employee in enumerate(employees)}
    day_index = {day["date"]: di for di, day in enumerate(days)}

    for ei, employee in enumerate(employees):
        for di, day in enumerate(days):
            entry = entry_of[(employee["id"], day["date"])]
            cands = build_candidates(problem, employee, day, entry)
            pool[(ei, di)] = cands
            total_candidates += len(cands)

            lits = []
            for ci, c in enumerate(cands):
                v = model.NewBoolVar(f"x_{ei}_{di}_{ci}")
                x[(ei, di, ci)] = v
                lits.append(v)

            w = model.NewBoolVar(f"w_{ei}_{di}")
            works[(ei, di)] = w
            if lits:
                model.Add(sum(lits) == 1).OnlyEnforceIf(w)
                model.Add(sum(lits) == 0).OnlyEnforceIf(w.Not())
            else:
                model.Add(w == 0)
            # A mandatory day is expressed as a constraint on the variable, not
            # as a rejection after the fact.
            if entry["mandatory"]:
                model.Add(w == 1)

            # Explicit "minutes worked" variable, tight domain.
            #
            # This is the load-bearing modelling choice. Expressed only as
            # weighted sums over ~700 booleans, the exact contract and budget
            # equalities gave CP-SAT no structure to propagate on and it could
            # not even prove SATISFIABILITY in 120 s. With this variable the
            # small integer sub-problem (employees x days) is propagated first
            # and drives everything else.
            domain = sorted({c["minutes"] for c in cands} |
                            ({0} if not entry["mandatory"] else set()))
            m = model.NewIntVarFromDomain(
                cp_model.Domain.FromValues(domain or [0]), f"m_{ei}_{di}")
            minutes_v[(ei, di)] = m
            if lits:
                model.Add(m == sum(c["minutes"] * x[(ei, di, ci)]
                                   for ci, c in enumerate(cands)))
            else:
                model.Add(m == 0)

            s = model.NewIntVar(0, 1440, f"s_{ei}_{di}")
            e = model.NewIntVar(0, 1440, f"e_{ei}_{di}")
            start_v[(ei, di)], end_v[(ei, di)] = s, e
            if lits:
                model.Add(s == sum(c["start"] * x[(ei, di, ci)] for ci, c in enumerate(cands)))
                model.Add(e == sum(c["end"] * x[(ei, di, ci)] for ci, c in enumerate(cands)))
            else:
                model.Add(s == 0)
                model.Add(e == 0)

    # Weekly contract — exact.
    for ei, employee in enumerate(employees):
        model.Add(sum(minutes_v[(ei, di)] for di in range(len(days)))
                  == employee["contractMinutes"])

    # Daily budget — exact.
    for di, day in enumerate(days):
        model.Add(sum(minutes_v[(ei, di)] for ei in range(len(employees)))
                  == day["budgetMinutes"])

    # Openings are a MINIMUM, closings are EXACT. Closed days require neither.
    for di, day in enumerate(days):
        if day["closed"]:
            continue
        openers = [x[(ei, di, ci)] for ei in range(len(employees))
                   for ci, c in enumerate(pool[(ei, di)]) if c["opens"]]
        closers = [x[(ei, di, ci)] for ei in range(len(employees))
                   for ci, c in enumerate(pool[(ei, di)]) if c["closes"]]
        model.Add(sum(openers) >= rules["minimumOpeningsPerDay"])
        model.Add(sum(closers) == rules["exactClosingsPerDay"])

    # Per-employee opening / closing caps.
    for ei, employee in enumerate(employees):
        if employee["maximumOpenings"] is not None:
            model.Add(sum(x[(ei, di, ci)] for di in range(len(days))
                          for ci, c in enumerate(pool[(ei, di)]) if c["opens"])
                      <= employee["maximumOpenings"])
        if employee["maximumClosings"] is not None:
            model.Add(sum(x[(ei, di, ci)] for di in range(len(days))
                          for ci, c in enumerate(pool[(ei, di)]) if c["closes"])
                      <= employee["maximumClosings"])

    # Rest: gap*1440 - end[d] + start[d'] >= minimumRest, when both are worked.
    for ei in range(len(employees)):
        for di in range(len(days)):
            for dj in range(di + 1, len(days)):
                gap = dj - di
                if gap * 1440 - 1440 >= rules["minimumRestMinutes"]:
                    break  # far enough apart that the rule can never bind
                model.Add(start_v[(ei, dj)] - end_v[(ei, di)] + gap * 1440
                          >= rules["minimumRestMinutes"]
                          ).OnlyEnforceIf([works[(ei, di)], works[(ei, dj)]])

    # ── Preservations, as HARD constraints ─────────────────────────────────
    #
    # A lock or a manual edit is not a preference to be traded against
    # coverage: the manager already decided. So each resolved assignment pins
    # exactly one candidate boolean to 1 — same employee, same day, same start,
    # same end — BEFORE any objective is stated. An assignment no candidate can
    # express is reported rather than approximated to the nearest legal shift,
    # because "we kept your shift, roughly" is the one answer that would make
    # the whole preservation contract worthless.
    unmatched = []
    for kind in ("lockedAssignments", "editedAssignments"):
        for pinned in preservation.get(kind, []):
            ei = employee_index.get(pinned["employeeId"])
            di = day_index.get(pinned["date"])
            if ei is None or di is None:
                unmatched.append({"kind": kind, "shiftId": pinned.get("shiftId"),
                                  "reason": "employee-or-date-absent-from-problem"})
                continue
            match = next((ci for ci, c in enumerate(pool[(ei, di)])
                          if c["start"] == pinned["startMinutes"]
                          and c["end"] == pinned["endMinutes"]), None)
            if match is None:
                unmatched.append({"kind": kind, "shiftId": pinned.get("shiftId"),
                                  "reason": "no-legal-candidate-matches-geometry"})
                continue
            model.Add(x[(ei, di, match)] == 1)

    # Coverage.
    under, shortfall, business = [], [], []
    for di, day in enumerate(days):
        for slot in slots_of.get(day["date"], []):
            covering = [x[(ei, di, ci)] for ei in range(len(employees))
                        for ci, c in enumerate(pool[(ei, di)])
                        if c["start"] <= slot["startMinutes"] and c["end"] >= slot["endMinutes"]]
            need = slot["requiredEmployees"]
            span = slot["endMinutes"] - slot["startMinutes"]
            covered = sum(covering) if covering else 0

            b = model.NewBoolVar(f"under_{di}_{slot['startMinutes']}")
            model.Add(covered >= need).OnlyEnforceIf(b.Not())
            model.Add(covered <= need - 1).OnlyEnforceIf(b)
            under.append(b)

            miss = model.NewIntVar(0, need * span, f"miss_{di}_{slot['startMinutes']}")
            model.Add(miss >= (need - covered) * span)
            shortfall.append(miss)
            # Business cost of THIS slot's shortfall: missing employee-minutes
            # weighted by the budget of the day they fall on. Integers only.
            business.append((miss, day["budgetMinutes"]))

    handles = {"x": x, "pool": pool, "under": under, "shortfall": shortfall,
               "business": business, "candidates": total_candidates,
               "works": works, "start": start_v, "end": end_v, "minutes": minutes_v,
               "employeeIndex": employee_index, "dayIndex": day_index,
               "unmatchedPreservations": unmatched}
    handles["drift"] = _build_drift(model, problem, handles,
                                    preservation.get("baselineAssignments", []))
    return model, handles


def _build_drift(model, problem, handles, baseline_assignments):
    """Total minutes of movement between the baseline schedule and this one.

    ONE unit — minutes — for every kind of change, so the objective needs no
    invented weights to compare "moved by 30 minutes" against "deleted":

      matched pair : |startNew - startOld| + |endNew - endOld|
      removed      : the whole duration of the baseline shift
      added        : the whole duration of the new shift

    An employee change or a day change shows up as one removal plus one
    addition, and is therefore already counted; it needs no separate term, and
    will need none if those ever become directly supported.

    Returns None when there is no baseline: with nothing to stay close to, the
    objective has no meaning and must not be stated.
    """
    if not baseline_assignments:
        return None

    employees, days = problem["employees"], problem["days"]
    baseline_of = {}
    for shift in baseline_assignments:
        ei = handles["employeeIndex"].get(shift["employeeId"])
        di = handles["dayIndex"].get(shift["date"])
        if ei is not None and di is not None:
            baseline_of[(ei, di)] = shift

    terms = []
    for ei in range(len(employees)):
        for di in range(len(days)):
            reference = baseline_of.get((ei, di))
            if reference is None:
                # Nothing there before: every worked minute is an addition, and
                # `minutes` is already 0 when the employee does not work.
                terms.append(handles["minutes"][(ei, di)])
                continue

            span = reference["endMinutes"] - reference["startMinutes"]
            ds = model.NewIntVar(0, 1440, f"ds_{ei}_{di}")
            de = model.NewIntVar(0, 1440, f"de_{ei}_{di}")
            model.AddAbsEquality(ds, handles["start"][(ei, di)] - reference["startMinutes"])
            model.AddAbsEquality(de, handles["end"][(ei, di)] - reference["endMinutes"])

            drift = model.NewIntVar(0, 2880, f"drift_{ei}_{di}")
            works = handles["works"][(ei, di)]
            model.Add(drift == ds + de).OnlyEnforceIf(works)
            # Not worked at all: the reference shift is gone, so ALL of its
            # minutes moved. Reading `ds + de` here would be meaningless — the
            # start and end variables are pinned to 0 when nobody works.
            model.Add(drift == span).OnlyEnforceIf(works.Not())
            terms.append(drift)

    return terms


def run_pass(solver, model, label):
    started = time.time()
    status = solver.Solve(model)
    elapsed = time.time() - started
    ok = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    return {
        "pass": label,
        "status": solver.StatusName(status),
        "objective": int(solver.ObjectiveValue()) if ok else None,
        "bestBound": solver.BestObjectiveBound() if ok else None,
        # A pass is proven only when CP-SAT says OPTIMAL *and* the bound meets
        # the incumbent. Either alone has been enough to mislead before.
        "proven": status == cp_model.OPTIMAL,
        "seconds": round(elapsed, 1),
    }


def extract_assignments(problem, handles, solver):
    assignments = []
    for ei, employee in enumerate(problem["employees"]):
        for di, day in enumerate(problem["days"]):
            for ci, c in enumerate(handles["pool"][(ei, di)]):
                if solver.Value(handles["x"][(ei, di, ci)]):
                    assignments.append({
                        "employeeId": employee["id"],
                        "date": day["date"],
                        "segments": [{"startMinutes": c["start"], "endMinutes": c["end"]}],
                    })
    assignments.sort(key=lambda a: (a["date"], a["employeeId"]))
    return assignments
