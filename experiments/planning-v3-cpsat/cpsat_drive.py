"""
EXPERIMENT — CP-SAT spike on a Planning V3 problem.

This is NOT product code and is not wired into the application. It exists to
answer one question and to make the answer reproducible: on the Drive week, how
few under-covered demand slots can an exact solver reach, and how much of that
is actually PROVEN?

The script is problem-agnostic. It reads a serialised `PlanningProblemV3`, so
there is no employee name and no calendar date anywhere in this file. Swap the
JSON and it solves a different week.

Solving is lexicographic in two explicit passes, never a weighted sum:
  pass 1 — minimise the number of under-covered slots;
  pass 2 — freeze that count, then minimise the missing employee-minutes;
  pass 3 — freeze both, then minimise the BUSINESS cost of the shortfall,
           each missing minute weighted by the budget of the day it falls on,
           so that at equal slots and equal minutes the days with the HIGHEST
           daily budget are the ones protected.
Each pass records its own status, objective, bound and duration, because
"optimal on pass 1" says nothing about passes 2 and 3.

Daily budgets are EXACT INPUT CONSTRAINTS, fixed before solving. The solver
chooses employees, durations and start times; it can never move minutes between
days or change a budget.

RULES NOT MODELLED — see README. Chief among them: split shifts are not
enumerated, so every claim here is scoped to continuous shifts.

Usage:
    python cpsat_drive.py <problem.json> <solution.json> [--report r.json]
                          [--timeout 600] [--seed 1] [--workers 1]

Exit codes: 0 success · 1 bad usage/IO · 2 no solution · 3 model error.
"""

import argparse
import json
import platform
import sys
import time

try:
    from ortools.sat.python import cp_model
    import ortools
except ImportError:  # pragma: no cover - environment guard
    print("ERREUR : ortools est introuvable. Voir requirements.txt.", file=sys.stderr)
    sys.exit(1)


# Rules kept as data so the report carries them and no reader has to infer the
# scope of the proof from prose.

COVERED_RULES = [
    "contrats hebdomadaires exacts",
    "budgets journaliers exacts",
    "jours obligatoires et repos fixes",
    "disponibilités par salarié et par date",
    "durées de shift minimale et maximale",
    "pas de temps",
    "capacités d'ouverture et de fermeture",
    "ouvertures par jour ouvert (minimum)",
    "fermetures par jour ouvert (exactes)",
    "plafonds individuels d'ouvertures et de fermetures",
    "repos minimum entre deux journées",
    "couverture des créneaux de besoin",
]

# These change the FEASIBLE SPACE. Modelling them differently can move the
# minimum: the proof of 1 under-covered slot does NOT carry over to a model
# that includes them.
UNCOVERED_RULES_AFFECTING_FEASIBILITY = [
    "shifts avec coupure : non modélisés — seuls les shifts continus sont énumérés",
    "maximumConsecutiveWorkedDays : non contraint ; une vraie règle configurée plus "
    "restrictive que le fallback dérivé restreindrait l'espace",
    "maximumEmployees : ignoré ; s'il constitue une contrainte dure, il restreint l'espace",
]

# These are LOWER-RANK OBJECTIVES, not constraints. Optimising them cannot move
# (1, 60) — provided they are optimised only AFTER fixing underCoveredSlots == 1
# and deficitMinutes == 60 as constraints.
UNOPTIMISED_SECONDARY_OBJECTIVES = [
    "préférences prefersOpening / prefersClosing",
    "équité des ouvertures et des fermetures",
    "écart à la répartition individuelle souhaitée",
    "choix métier du créneau à sacrifier lorsque plusieurs optima existent",
]


# ── Fingerprints, mirroring features/core/planning-v3/validator/fingerprint.ts ──
# Reimplemented here rather than imported: matching the TypeScript value is a
# genuine cross-check that both sides describe the same problem.

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


def build_model(problem):
    """Return (model, handles) for one PlanningProblemV3."""
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
            # With the total deficit already fixed by pass 2, minimising
            # sum(miss_i * budget_i) is a linear objective over a fixed total,
            # so its minimum puts the shortfall on the lowest-budget day that
            # can carry it — i.e. at equal slots and equal minutes it protects
            # the days with the highest daily budget. No day is intrinsically
            # less important: the budget is only a tie-break between solutions
            # already equivalent on the first two objectives.
            business.append((miss, day["budgetMinutes"]))

    return model, {"x": x, "pool": pool, "under": under, "shortfall": shortfall,
                   "business": business, "candidates": total_candidates}


def make_solver(args):
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(args.timeout)
    solver.parameters.random_seed = args.seed
    # One worker: the portfolio is not reproducible across runs, so a
    # reference run that claims determinism must be single-threaded.
    solver.parameters.num_search_workers = args.workers
    return solver


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
        "proven": status == cp_model.OPTIMAL,
        "seconds": round(elapsed, 1),
    }


def main():
    parser = argparse.ArgumentParser(description="CP-SAT spike on a PlanningProblemV3")
    parser.add_argument("problem")
    parser.add_argument("solution")
    parser.add_argument("--report")
    parser.add_argument("--timeout", type=float, default=600.0)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args()

    try:
        problem = json.load(open(args.problem, encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"ERREUR : lecture de {args.problem} impossible : {error}", file=sys.stderr)
        return 1

    try:
        model, h = build_model(problem)
    except (KeyError, TypeError) as error:
        print(f"ERREUR : problème mal formé : {error}", file=sys.stderr)
        return 3

    solver = make_solver(args)
    problem_fingerprint = fingerprint_problem(problem)
    environment = {
        "python": platform.python_version(),
        "ortools": ortools.__version__,
        "platform": platform.platform(),
        "machine": platform.machine(),
    }
    params = {
        "random_seed": args.seed,
        "num_search_workers": args.workers,
        "max_time_in_seconds": args.timeout,
    }
    print(f"python            : {environment['python']}")
    print(f"plateforme        : {environment['platform']}")
    print(f"empreinte probleme: {problem_fingerprint}")
    print(f"or-tools          : {environment['ortools']}")
    print(f"parametres        : seed={args.seed} workers={args.workers} timeout={args.timeout}s")
    print(f"candidats generes : {h['candidates']}")
    print(f"booleens de shift : {len(h['x'])}")
    print(f"creneaux de besoin: {len(h['under'])}")

    # ── Pass 1 — minimise the number of under-covered slots ────────────────
    model.Minimize(sum(h["under"]))
    first = run_pass(solver, model, "1-under-covered-slots")
    print(f"\n[passe 1] statut={first['status']} objectif={first['objective']} "
          f"borne={first['bestBound']} prouve={first['proven']} {first['seconds']}s")
    if first["objective"] is None:
        print("ERREUR : aucune solution sur la passe 1.", file=sys.stderr)
        return 2

    # ── Pass 2 — freeze that count, minimise the missing minutes ───────────
    # Equality, not "<=": pass 2 answers "given exactly this many short slots,
    # how few minutes can be missing", which is a different question from
    # "how few minutes overall".
    model.Add(sum(h["under"]) == first["objective"])
    model.Minimize(sum(h["shortfall"]))
    second = run_pass(solver, model, "2-deficit-minutes")
    print(f"[passe 2] statut={second['status']} objectif={second['objective']} "
          f"borne={second['bestBound']} prouve={second['proven']} {second['seconds']}s")
    if second["objective"] is None:
        print("ERREUR : aucune solution sur la passe 2.", file=sys.stderr)
        return 2

    # ── Pass 3 — freeze both, minimise the business cost of the shortfall ──
    # Only now, with the two proven levels pinned as CONSTRAINTS, may a business
    # preference speak. Weighting earlier — or folding all three into a single
    # weighted sum — would let a cheap business gain pay for a worse shortfall.
    model.Add(sum(h["shortfall"]) == second["objective"])
    model.Minimize(sum(miss * budget for miss, budget in h["business"]))
    third = run_pass(solver, model, "3-business-deficit-cost")
    print(f"[passe 3] statut={third['status']} objectif={third['objective']} "
          f"borne={third['bestBound']} prouve={third['proven']} {third['seconds']}s")
    if third["objective"] is None:
        print("ERREUR : aucune solution sur la passe 3.", file=sys.stderr)
        return 2

    # Each pass carries its own proof, or none. The claim is ALWAYS scoped: an
    # optimum for the serialised problem, continuous shifts and the rules
    # currently modelled — never a "globally optimal Drive week".
    first_proven = first["proven"] and first["bestBound"] == first["objective"]
    second_proven = second["proven"] and second["bestBound"] == second["objective"]
    third_proven = third["proven"] and third["bestBound"] == third["objective"]
    print("\n=== portee de la preuve ===")
    levels = "trois" if (first_proven and second_proven and third_proven) else "deux"
    print(f"Optimum lexicographique prouve sur les {levels} premiers objectifs, pour le")
    print("probleme serialise, avec shifts continus et regles actuellement modelisees.")
    print(f"  niveau 1 - underCoveredSlots = {first['objective']} : "
          + ("PROUVE" if first_proven
             else f"NON PROUVE (meilleure valeur trouvee : {first['objective']})"))
    print(f"  niveau 2 - deficitMinutes = {second['objective']} parmi les solutions a "
          f"{first['objective']} creneau(x) : "
          + ("PROUVE" if second_proven
             else f"NON PROUVE (meilleure valeur trouvee : {second['objective']})"))
    print(f"  niveau 3 - businessDeficitCost = {third['objective']} a "
          f"({first['objective']}, {second['objective']}) fixes : "
          + ("PROUVE" if third_proven
             else f"NON PROUVE (meilleure valeur trouvee : {third['objective']})"))
    print("Le planning retourne est une solution de reference reproductible,")
    print("PAS l'unique optimum : plusieurs plannings peuvent atteindre ces valeurs.")

    assignments = []
    for ei, employee in enumerate(problem["employees"]):
        for di, day in enumerate(problem["days"]):
            for ci, c in enumerate(h["pool"][(ei, di)]):
                if solver.Value(h["x"][(ei, di, ci)]):
                    assignments.append({
                        "employeeId": employee["id"],
                        "date": day["date"],
                        "segments": [{"startMinutes": c["start"], "endMinutes": c["end"]}],
                    })
    assignments.sort(key=lambda a: (a["date"], a["employeeId"]))

    try:
        with open(args.solution, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(assignments, handle, indent=2)
            handle.write("\n")
    except OSError as error:
        print(f"ERREUR : ecriture de {args.solution} impossible : {error}", file=sys.stderr)
        return 1

    report = {
        "environment": environment,
        "solverParameters": params,
        "problemFingerprint": problem_fingerprint,
        "solutionFingerprint": fingerprint_solution(assignments, problem_fingerprint),
        "model": {"candidates": h["candidates"], "shiftBooleans": len(h["x"]),
                  "demandSlots": len(h["under"])},
        "passes": [first, second, third],
        "proof": {
            "statement": "Optimum lexicographique prouve sur les deux premiers "
                         "objectifs, pour le probleme serialise, avec shifts continus "
                         "et regles actuellement modelisees.",
            "level1_underCoveredSlots": {"value": first["objective"], "proven": first_proven},
            "level2_deficitMinutes": {"value": second["objective"], "proven": second_proven,
                                      "conditionedOn": "underCoveredSlots == "
                                                       f"{first['objective']}"},
            "level3_businessDeficitCost": {
                "objectiveCode": "business-deficit-cost",
                "incumbentValue": third["objective"],
                "bestBound": third["bestBound"],
                "status": third["status"],
                "provenOptimal": third_proven,
                "elapsedSeconds": third["seconds"],
                "definition": "somme sur les creneaux deficitaires de "
                              "(deficitEmployeeMinutes x dailyBudgetMinutes)",
                "conditionedOn": f"underCoveredSlots == {first['objective']} ET "
                                 f"deficitMinutes == {second['objective']}",
            },
            "objectivesProven": (3 if (first_proven and second_proven and third_proven)
                                 else 2 if (first_proven and second_proven)
                                 else 1 if first_proven else 0),
            "solutionIsUnique": False,
            "canonicalTieBreak": "Aucun quatrieme critere metier. L'ordre des "
                                 "affectations dans le fichier est un departage "
                                 "canonique TECHNIQUE (tri par date puis identifiant), "
                                 "jamais une preference metier.",
            "remainingBusinessChoice": "Si plusieurs solutions restent equivalentes "
                                       "apres la passe 3, le choix revient au manager "
                                       "dans l'interface, pas au solveur.",
            "note": "Solution de reference reproductible a parametres fixes, pas "
                    "l'unique optimum.",
        },
        "coveredRules": COVERED_RULES,
        "uncoveredRulesAffectingFeasibility": UNCOVERED_RULES_AFFECTING_FEASIBILITY,
        "unoptimisedSecondaryObjectives": UNOPTIMISED_SECONDARY_OBJECTIVES,
        "secondaryObjectivesCaveat": "Ces objectifs ne conservent (1, 60) que s'ils "
                                     "sont optimises APRES avoir fixe explicitement "
                                     "underCoveredSlots == 1 et deficitMinutes == 60.",
        "assignments": len(assignments),
    }
    if args.report:
        with open(args.report, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(report, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
    print(f"\naffectations ecrites : {len(assignments)} -> {args.solution}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
