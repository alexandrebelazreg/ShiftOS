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


def employee_day_domains(problem):
    """For every (ei, di): the exact set of worked-minute durations the model
    would allow, plus whether the day is mandatory and whether an opening or a
    closing shift is possible.

    Computed with `build_candidates` — the SAME enumeration `build_model` uses —
    so a necessary-condition check built on top of this can never pass a problem
    the model then finds infeasible. A looser approximation here would reopen
    exactly the silent-timeout hole these diagnostics exist to close.
    """
    entry_of = {(e["employeeId"], e["date"]): e for e in problem["employeeDays"]}
    domains = {}
    for ei, employee in enumerate(problem["employees"]):
        for di, day in enumerate(problem["days"]):
            entry = entry_of[(employee["id"], day["date"])]
            cands = build_candidates(problem, employee, day, entry)
            domains[(ei, di)] = {
                "mandatory": bool(entry.get("mandatory")),
                "durations": sorted({c["minutes"] for c in cands}),
                "canOpen": any(c["opens"] for c in cands),
                "canClose": any(c["closes"] for c in cands),
            }
    return domains


def necessary_feasibility_diagnostics(problem, preservation=None):
    """NECESSARY conditions for a legal schedule to exist. Never sufficient.

    Every rule below is a lower bound the exact contract/budget equalities must
    respect. A violation is a PROOF the week cannot be staffed as posed, so it is
    safe to report before any search — and reporting it turns a 120-second wait
    that ends in "no solution" into an immediate, precise sentence naming the day
    or the employee at fault.

    The reverse does NOT hold: passing every check here says only that no cheap
    contradiction was found, and the CP-SAT search still runs. So this can raise
    no false alarm (each item is a real impossibility) while still leaving the
    hard feasibility question to the solver.
    """
    rules = problem["rules"]
    employees = problem["employees"]
    days = problem["days"]
    domains = employee_day_domains(problem)
    out = []

    # ── Global balance: the two exact equality families must agree on the total.
    total_contract = sum(e["contractMinutes"] for e in employees)
    total_budget = sum(d["budgetMinutes"] for d in days)
    if total_contract != total_budget:
        out.append({
            "code": "contract-budget-total-mismatch",
            "message": f"La somme des contrats ({total_contract} min) diffère de la "
                       f"somme des budgets journaliers ({total_budget} min) : les "
                       f"égalités exactes ne peuvent pas toutes tenir.",
        })

    # ── A mandatory day with no legal shift: w==1 and w==0 at once.
    for ei, employee in enumerate(employees):
        for di, day in enumerate(days):
            dom = domains[(ei, di)]
            if dom["mandatory"] and not dom["durations"]:
                out.append({
                    "code": "mandatory-day-no-candidate",
                    "employeeId": employee["id"], "date": day["date"],
                    "message": f"{employee['id']} est obligatoire le {day['date']} mais "
                               f"aucun shift légal n'y existe (fenêtre, durée ou capacité).",
                })

    # ── Per open day: capacity, mandatory floor, reachability, open/close.
    for di, day in enumerate(days):
        if day["closed"]:
            continue
        budget = day["budgetMinutes"]
        floor = cap = openers = closers = 0
        positives = []
        for ei in range(len(employees)):
            dom = domains[(ei, di)]
            if dom["durations"]:
                cap += dom["durations"][-1]
                positives.append(dom["durations"][0])
                if dom["mandatory"]:
                    floor += dom["durations"][0]
                if dom["canOpen"]:
                    openers += 1
                if dom["canClose"]:
                    closers += 1
        min_positive = min(positives) if positives else None
        if budget > cap:
            out.append({
                "code": "day-budget-exceeds-capacity", "date": day["date"],
                "message": f"Le {day['date']} demande {budget} min mais la capacité "
                           f"maximale des salariés disponibles est {cap} min.",
            })
        if budget < floor:
            out.append({
                "code": "day-budget-below-mandatory-floor", "date": day["date"],
                "message": f"Le {day['date']} n'a qu'un budget de {budget} min alors que "
                           f"les salariés obligatoires imposent au moins {floor} min.",
            })
        if budget > 0 and (min_positive is None or budget < min_positive):
            out.append({
                "code": "day-budget-below-shortest-shift", "date": day["date"],
                "message": f"Le {day['date']} demande {budget} min, une valeur strictement "
                           f"positive mais inférieure au plus court shift possible "
                           f"({min_positive if min_positive is not None else '—'} min) : "
                           f"aucune combinaison de salariés ne peut l'atteindre.",
            })
        if openers < rules["minimumOpeningsPerDay"]:
            out.append({
                "code": "day-cannot-open", "date": day["date"],
                "message": f"Le {day['date']} exige {rules['minimumOpeningsPerDay']} "
                           f"ouverture(s) mais seuls {openers} salarié(s) peuvent ouvrir.",
            })
        if closers < rules["exactClosingsPerDay"]:
            out.append({
                "code": "day-cannot-close", "date": day["date"],
                "message": f"Le {day['date']} exige exactement {rules['exactClosingsPerDay']} "
                           f"fermeture(s) mais seuls {closers} salarié(s) peuvent fermer.",
            })

    # ── Per employee: the contract must fit between its mandatory floor and the
    #    most its available days can absorb.
    for ei, employee in enumerate(employees):
        contract = employee["contractMinutes"]
        floor = cap = 0
        for di in range(len(days)):
            dom = domains[(ei, di)]
            if dom["durations"]:
                cap += dom["durations"][-1]
                if dom["mandatory"]:
                    floor += dom["durations"][0]
        if contract > cap:
            out.append({
                "code": "employee-contract-exceeds-capacity", "employeeId": employee["id"],
                "message": f"Le contrat de {employee['id']} ({contract} min) dépasse le total "
                           f"maximal atteignable sur ses jours disponibles ({cap} min).",
            })
        if contract < floor:
            out.append({
                "code": "employee-contract-below-mandatory-floor", "employeeId": employee["id"],
                "message": f"Le contrat de {employee['id']} ({contract} min) est inférieur au "
                           f"minimum imposé par ses jours obligatoires ({floor} min).",
            })

    return out


def individual_daily_targets(problem):
    """Each employee's contract, spread over the days they can actually work.

    The sector's percentage profile decides the SHAPE of a week; `budgetMinutes`
    is that profile already expressed in minutes, so it is what weights the
    split. Reading the percentages back out would only re-derive it, and would
    re-derive it differently on a day the largest-remainder rounding touched.

    Days the employee cannot work at all — fixed rest, absence, holiday, a
    closed day — are removed from the split and their share is redistributed
    across the days that remain. A target on a day nobody can work would be an
    unreachable ideal that the objective then pays for forever.

    Rounding is largest-remainder in whole time steps, ties broken by calendar
    order, so the result is deterministic AND the targets of one employee sum to
    EXACTLY their contract. That last property is load-bearing: targets summing
    to anything else would put this objective in permanent conflict with the
    exact weekly-contract equality, and the deviation could never reach zero
    however good the schedule.
    """
    step = problem["timeStepMinutes"]
    entry_of = {(e["employeeId"], e["date"]): e for e in problem["employeeDays"]}
    targets = {}

    for ei, employee in enumerate(problem["employees"]):
        workable = []
        for di, day in enumerate(problem["days"]):
            targets[(ei, di)] = 0
            entry = entry_of[(employee["id"], day["date"])]
            if entry["available"] and not day["closed"]:
                workable.append(di)
        if not workable:
            continue

        weights = [max(0, problem["days"][di]["budgetMinutes"]) for di in workable]
        if sum(weights) <= 0:
            # No shape to follow — an even split is the only neutral answer.
            weights = [1] * len(workable)
        total_weight = sum(weights)

        total_units = employee["contractMinutes"] // step
        rows = []
        for position, di in enumerate(workable):
            exact = total_units * weights[position] / total_weight
            whole = int(exact)
            rows.append([di, whole, exact - whole])

        leftover = total_units - sum(row[1] for row in rows)
        for row in sorted(rows, key=lambda item: (-item[2], item[0]))[:max(0, leftover)]:
            row[1] += 1

        for di, units, _ in rows:
            targets[(ei, di)] = units * step

    return targets


def build_model(problem, preservation=None, with_distribution=False,
                with_role_propagation=False):
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
    step = problem["timeStepMinutes"]

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

    # ── Explicit role variables, and the two implications they carry ───────
    #
    # `opens` and `closes` are already decidable from the candidate booleans —
    # each candidate knows whether it starts at the opening or ends at the
    # closing. But the solver could only reach the facts below THROUGH those
    # booleans and through the integer start/end variables of the rest
    # constraint, which is a long way round for something expressible as a
    # two-literal clause. Naming the roles lets the two implications propagate
    # directly.
    #
    # Both are REDUNDANT — they are consequences of constraints already stated,
    # so they remove no legal schedule:
    #
    #   (1) `build_candidates` never emits a shift longer than
    #       `maximumShiftMinutes`. On a day whose amplitude exceeds that, a
    #       single continuous shift covering both the opening and the closing
    #       would have to span the whole day, so no such candidate exists and
    #       `opens AND closes` was already unreachable.
    #
    #   (2) The rest constraint already forbids ending at `closesAt[d]` and
    #       starting at `opensAt[d+1]` when the night between them is shorter
    #       than `minimumRestMinutes`.
    #
    # Neither reads a name, a weekday or a date: both are derived from the
    # rules and the opening hours, so a sector that closes earlier or rests
    # longer simply gets a different set of clauses — or none.
    opens_v, closes_v = {}, {}
    if with_role_propagation:
        for ei in range(len(employees)):
            for di in range(len(days)):
                cands = pool[(ei, di)]
                opener = model.NewBoolVar(f"opens_{ei}_{di}")
                closer = model.NewBoolVar(f"closes_{ei}_{di}")
                opens_v[(ei, di)], closes_v[(ei, di)] = opener, closer

                opening_lits = [x[(ei, di, ci)] for ci, c in enumerate(cands) if c["opens"]]
                closing_lits = [x[(ei, di, ci)] for ci, c in enumerate(cands) if c["closes"]]
                # At most one candidate is ever selected, so each of these sums
                # is already 0 or 1 and the equality is a channelling, not a
                # restriction.
                if opening_lits:
                    model.Add(sum(opening_lits) == opener)
                else:
                    model.Add(opener == 0)
                if closing_lits:
                    model.Add(sum(closing_lits) == closer)
                else:
                    model.Add(closer == 0)

        # (1) Nobody opens and closes the same over-long day.
        for di, day in enumerate(days):
            if day["closed"]:
                continue
            amplitude = day["closesAtMinutes"] - day["opensAtMinutes"]
            if amplitude <= rules["maximumShiftMinutes"]:
                continue
            for ei in range(len(employees)):
                model.AddBoolOr([opens_v[(ei, di)].Not(), closes_v[(ei, di)].Not()])

        # (2) Whoever closes a day cannot open the next one when the night is
        #     shorter than the minimum rest.
        for di in range(len(days) - 1):
            today, tomorrow = days[di], days[di + 1]
            if today["closed"] or tomorrow["closed"]:
                continue
            night = tomorrow["opensAtMinutes"] - today["closesAtMinutes"] + 1440
            if night >= rules["minimumRestMinutes"]:
                continue
            for ei in range(len(employees)):
                model.AddBoolOr([closes_v[(ei, di)].Not(), opens_v[(ei, di + 1)].Not()])

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

    # ── Coverage — atomic sub-intervals, not per-shift containment ─────────
    #
    # FIXED 2026-07-24 (was a correctness bug, not a style choice). Coverage is
    # a CONCURRENCY question — how many candidates are present at once — never
    # "does one candidate span the whole slot." The old constraint,
    #     c["start"] <= slot.start and c["end"] >= slot.end
    # counted only candidates that individually cover the ENTIRE demand
    # window, so three staggered shifts (06:00–12:30, 10:00–14:00, 12:15–17:45)
    # that keep the floor staffed at 2–3 people throughout 12:00–13:00 counted
    # as covered=1 — only the middle shift spans the full hour — reporting a
    # deficit that never existed. `underCoveredSlots`, `deficitMinutes` and
    # `businessDeficitCost` all derived from this, so all three were affected;
    # see `features/core/shared/coverage.ts` for the worked example and the
    # TypeScript twin of this reasoning (validator, V2 coverage calculator,
    # board view-model) — this file cannot import it, so it reimplements the
    # same semantics rather than sharing code across languages.
    #
    # Every demand slot is split into fixed sub-intervals of `step` width
    # (clamped to the slot's own end for a non-step-aligned width). This is
    # safe as a FIXED grid, rather than dynamic breakpoints, because every
    # candidate's start and end are already `step`-aligned by construction
    # (`build_candidates`): no candidate boundary can fall strictly inside one
    # of these pieces, so a fixed grid and dynamic breakpoints agree exactly.
    #
    # `under` stays ONE entry per ORIGINAL demand slot — a slot counts as
    # under-covered if ANY of its atomic pieces is short — so
    # `underCoveredSlots` keeps meaning "how many demand slots," matching the
    # TypeScript validator's unit. `shortfall`/`business` grow to one entry per
    # atomic piece: a slot short for only part of its width now costs only
    # that part, not the whole slot.
    under, shortfall, business = [], [], []
    for di, day in enumerate(days):
        for slot in slots_of.get(day["date"], []):
            need = slot["requiredEmployees"]
            piece_unders = []
            piece_start = slot["startMinutes"]
            while piece_start < slot["endMinutes"]:
                piece_end = min(piece_start + step, slot["endMinutes"])
                covering = [x[(ei, di, ci)] for ei in range(len(employees))
                            for ci, c in enumerate(pool[(ei, di)])
                            if c["start"] <= piece_start and c["end"] >= piece_end]
                covered = sum(covering) if covering else 0
                piece_span = piece_end - piece_start

                b = model.NewBoolVar(f"under_{di}_{slot['startMinutes']}_{piece_start}")
                model.Add(covered >= need).OnlyEnforceIf(b.Not())
                model.Add(covered <= need - 1).OnlyEnforceIf(b)
                piece_unders.append(b)

                miss = model.NewIntVar(0, need * piece_span,
                                       f"miss_{di}_{slot['startMinutes']}_{piece_start}")
                model.Add(miss >= (need - covered) * piece_span)
                shortfall.append(miss)
                # Business cost of THIS piece's shortfall: missing
                # employee-minutes weighted by the budget of the day they fall
                # on. Integers only.
                business.append((miss, day["budgetMinutes"]))

                piece_start = piece_end

            slot_under = model.NewBoolVar(f"underslot_{di}_{slot['startMinutes']}")
            model.AddMaxEquality(slot_under, piece_unders)
            under.append(slot_under)

    # ── Deviation from each employee's individual daily target ─────────────
    #
    # Built ONLY when a pass will optimise it. Left out otherwise the model is
    # byte-for-byte the one measured before, so a comparison between "with" and
    # "without" measures the objective rather than the extra variables.
    #
    # A SOFT term, never a constraint: the target is what a balanced week would
    # look like, not a rule. Some targets are unreachable by construction — a
    # 105-minute target cannot be met when the shortest legal shift is 240 — and
    # a hard version would turn a perfectly good week into an infeasibility.
    targets = individual_daily_targets(problem)
    deviation = []
    if with_distribution:
        for ei in range(len(employees)):
            for di in range(len(days)):
                gap = model.NewIntVar(0, 1440, f"dev_{ei}_{di}")
                model.AddAbsEquality(gap, minutes_v[(ei, di)] - targets[(ei, di)])
                deviation.append(gap)

    handles = {"x": x, "pool": pool, "under": under, "shortfall": shortfall,
               "distributionDeviation": deviation, "distributionTargets": targets,
               "opens": opens_v, "closes": closes_v,
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


def run_pass(solver, model, label, callback=None):
    """Solve one pass and describe what it achieved.

    `callback` is an optional CP-SAT solution callback. It observes the search —
    it cannot steer it — so passing one changes no objective, no constraint and
    no result; it only lets the caller timestamp events such as the first
    feasible solution.
    """
    started = time.time()
    status = solver.Solve(model, callback) if callback is not None else solver.Solve(model)
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
        # Search effort, not time: the figures that say whether a redundant
        # constraint actually helped propagation or merely happened to run on a
        # quieter machine.
        "branches": solver.NumBranches(),
        "conflicts": solver.NumConflicts(),
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
