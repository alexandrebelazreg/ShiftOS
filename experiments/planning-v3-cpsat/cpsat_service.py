"""
EXPERIMENT — the CP-SAT side of the Planning V3 solve contract.

Reads ONE request envelope on stdin, writes ONE response envelope on stdout,
exits. No server, no port, no framework: a subprocess boundary is the smallest
thing that keeps OR-Tools out of the Node process while still being a real
process boundary, which is what this sprint needs to learn from.

It never raises past `main`. Every failure — a malformed envelope, a missing
dependency, a model error, no solution — comes back as a structured envelope,
because the caller must be able to tell "the week is impossible" from "the
solver fell over", and an exception on stderr cannot make that distinction.

The model itself lives in `cpsat_model.py`, shared with the reference spike.

Usage (the adapter does this; a human can too, for debugging):
    echo '<request json>' | python cpsat_service.py
"""

import json
import platform
import sys
import time

PROTOCOL_VERSION = "planning-v3-cpsat/1"

# ── The two CP-SAT profiles ────────────────────────────────────────────────
#
# A profile bundles a BUDGET and the SEARCH options, and nothing else. Neither
# one adds, removes or reorders an objective, and both enumerate exactly the
# same candidate space — so a schedule found under one profile is legal under
# the other, and the lexicographic meaning of every figure is unchanged.
#
# `fast` is what a manager clicking "Générer" gets: a short budget, hints on,
# one worker. `thorough` is a deliberate act — the same search given room to
# finish proving the lower objectives.
#
# Both keep `workers: 1`. Eight workers were measured on the Drive week and
# bought 4% of wall time for twice the CPU, while making the returned schedule
# differ from one run to the next; the objectives stayed identical, but a
# planning that changes shape on every click is not worth 4%.
#
# The `fast` budget of 120 seconds is measured rather than chosen. On the Drive
# week:
#
#   60 s  — pass 1 never finishes proving. Three identical runs returned
#           `underCoveredSlots` of 13, 1 and 1: a wall-clock cutoff lands
#           wherever the search happens to be, so quality varied per click.
#   90 s  — pass 1 proves 1, three times out of three, schedule identical.
#           But pass 2 starts and does not finish, leaving 180 minutes of
#           deficit on the table.
#   120 s — pass 1 proves 1 every time; pass 2 proved 60 in three runs of a
#           quiet campaign and was cut off in a fourth on a busier machine.
#
# So 120 s buys the second objective OFTEN, not always, and the downside is
# bounded: when pass 2 runs out, the answer is exactly the 90 s answer, never
# worse, because the gate below keeps pass 1's proven schedule. Raising this
# further would trade a longer wait for a guarantee nobody has asked for yet.
#
# The lower bound is about PROOF, not patience: below the point where a pass can
# prove its level, the answer stops being reproducible.
CPSAT_PROFILES = {
    "fast": {"timeoutSeconds": 120.0, "useHints": True, "workers": 1},
    "thorough": {"timeoutSeconds": 300.0, "useHints": True, "workers": 1},
}
DEFAULT_PROFILE = "fast"
# The largest budget any profile may be pushed to.
MAX_TIMEOUT_SECONDS = 300.0

# A pass needs room to be worth starting. Below this, the remaining budget is
# spent reporting what is already proven rather than on a search that cannot
# finish — and a pass that cannot finish would leave an UNPROVEN level that the
# next one is forbidden to freeze anyway.
MIN_PASS_SECONDS = 5.0

# Where the individual-daily-distribution objective may sit in the ladder.
#
#   off             — not stated; the model is the one measured before it existed.
#   after-deficit   — rung 3, ahead of the business cost.
#   after-business  — rung 4, behind it.
#
# The placement is a MEASURED decision: ahead of the business cost the objective
# actually runs in the everyday budget, behind it the fast profile would almost
# never reach it. `after-business` is kept as the control that shows exactly
# that.
DISTRIBUTION_PASS_PLACEMENTS = ("off", "after-deficit", "after-business")

# Import guarded so "OR-Tools is not installed" is a structured answer rather
# than a traceback the adapter would have to parse.
try:
    from ortools.sat.python import cp_model
    import ortools

    ORTOOLS_ERROR = None
except ImportError as error:  # pragma: no cover - environment guard
    cp_model = None
    ortools = None
    ORTOOLS_ERROR = str(error)


# The base is resolved at import time so this module still loads — and still
# answers `ortools-missing` as a structured envelope — on a machine without
# OR-Tools installed.
class FirstSolutionClock(
    cp_model.CpSolverSolutionCallback if cp_model is not None else object
):
    """Timestamps the first feasible solution of a pass.

    Observation only: a solution callback cannot change the search, the
    objective or the result. It exists so the answer can say how long the week
    went without ANY schedule, which is the number that decides whether a budget
    is usable — quite separate from how long proving took.
    """

    def __init__(self, started):
        super().__init__()
        self._started = started
        self.first_at = None

    def on_solution_callback(self):
        if self.first_at is None:
            self.first_at = round(time.time() - self._started, 1)


def envelope(request_id, status, **fields):
    out = {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "status": status,
        "assignments": [],
        "passes": [],
        "candidateSpace": "incomplete",
        "stopCause": "not-started",
        # Why the ladder stopped where it did, in words. `stopCause` says
        # whether the run was complete; this says what ended it.
        "stopDetail": None,
        # Where the wall time went: model construction, the wait for a first
        # schedule, and the search itself.
        "timings": None,
        "unmatchedPreservations": [],
        "stability": None,
        "environment": environment(),
        "error": None,
    }
    out.update(fields)
    return out


def environment():
    return {
        "python": platform.python_version(),
        "ortools": ortools.__version__ if ortools is not None else None,
        "platform": platform.platform(),
    }


def fail(request_id, code, message):
    return envelope(request_id, "error", error={"code": code, "message": message})


def solve(request):
    """Run the lexicographic passes and describe exactly what was proven.

    Two properties this function guarantees, both learned from watching the Drive
    week time out at the application's budget while the 600-second spike solved
    it cleanly:

    1. It NEVER runs a search it can already prove pointless. A set of necessary
       feasibility conditions is checked first; a violation is an immediate
       `invalid-problem` naming the day or employee at fault, not a wait that
       ends in "no solution".

    2. It NEVER discards a schedule it already found. The passes share one time
       budget, and a later pass can exhaust it. When that happens the best
       schedule from the last COMPLETED pass is returned as a feasible answer —
       the previous version returned `no-solution` here and threw away a
       perfectly legal, often already-proven, week.
    """
    from cpsat_model import (
        build_model,
        candidate_space,
        extract_assignments,
        fingerprint_problem,
        fingerprint_solution,
        necessary_feasibility_diagnostics,
        run_pass,
    )

    request_id = request.get("requestId", "")
    problem = request["problem"]
    preservation = request.get("preservation") or {}
    options = request.get("options") or {}

    # A profile supplies the defaults; an explicit option still wins, so a
    # caller can deepen a `fast` run without inventing a third profile.
    profile = CPSAT_PROFILES.get(options.get("profile") or DEFAULT_PROFILE,
                                 CPSAT_PROFILES[DEFAULT_PROFILE])
    timeout = min(float(options.get("timeoutSeconds", profile["timeoutSeconds"])),
                  MAX_TIMEOUT_SECONDS)
    seed = int(options.get("seed", 1))
    # One worker by default: the CP-SAT portfolio is not reproducible across
    # runs, so a result that claims determinism must be single-threaded. The
    # OBJECTIVE values stay deterministic either way (this is exact
    # optimisation), but the exact schedule among equal optima can differ from
    # one worker count to another.
    workers = int(options.get("workers", profile["workers"]))
    # Hints carry each pass's solution forward as a starting point for the next.
    # A hint is only a search suggestion — never a constraint — so it can change
    # how fast a pass converges but never WHICH optimum is admissible. The hints
    # come exclusively from earlier V3 passes; no V2 schedule ever seeds them,
    # and no lock or retouch is ever demoted from constraint to hint.
    use_hints = bool(options.get("useHints", profile["useHints"]))
    # Where the individual-daily-distribution objective sits in the ladder, or
    # whether it is stated at all. `off` keeps the model identical to the one
    # measured before this objective existed.
    distribution_pass = options.get("distributionPass", profile.get("distributionPass", "off"))
    if distribution_pass not in DISTRIBUTION_PASS_PLACEMENTS:
        distribution_pass = "off"

    # ── Necessary conditions, before any search ────────────────────────────
    # Each violation is a proof the week cannot be staffed as posed. Returned as
    # `invalid-problem` with the exact cause, rather than left for the solver to
    # rediscover slowly (or fail to disprove at all, and time out).
    # Everything before the first Solve: candidate enumeration, the necessary
    # conditions and the model itself. Reported separately because it is spent
    # whatever the budget, and a caller comparing budgets needs to know how much
    # of the wall time never reached the solver at all.
    build_started = time.time()
    try:
        diagnostics = necessary_feasibility_diagnostics(problem, preservation)
    except (KeyError, TypeError, ValueError) as error:
        return envelope(request_id, "invalid-problem",
                        error={"code": "model-error", "message": f"{type(error).__name__}: {error}"})
    if diagnostics:
        return envelope(
            request_id, "invalid-problem",
            candidateSpace=candidate_space(problem),
            stopCause="not-started",
            error={"code": "structurally-infeasible",
                   "message": " ; ".join(item["message"] for item in diagnostics)},
            diagnostics=diagnostics,
        )

    try:
        model, handles = build_model(problem, preservation,
                                     with_distribution=distribution_pass != "off")
    except (KeyError, TypeError, ValueError) as error:
        return envelope(request_id, "invalid-problem",
                        error={"code": "model-error", "message": f"{type(error).__name__}: {error}"})

    build_seconds = round(time.time() - build_started, 1)

    solver = cp_model.CpSolver()
    solver.parameters.random_seed = seed
    solver.parameters.num_search_workers = workers

    started = time.time()
    first_solution_seconds = None
    passes = []
    # The best schedule proven so far, extracted the instant a pass completes.
    # `solver` is reused and re-solved between passes, so a schedule not copied
    # out here is gone the moment the next `Solve` starts.
    best_assignments = None
    stability = None
    # Set when the ladder is abandoned before its last rung. It is what keeps a
    # run that proved passes 1 and 2 and never started pass 3 from calling
    # itself `exhausted` — every pass it RAN was proven, which is exactly the
    # shape that would otherwise be mistaken for a completed lexicographic
    # optimum.
    stopped_early = False
    stop_detail = None

    def remaining():
        return max(0.1, timeout - (time.time() - started))

    def solved_so_far():
        """Return the best schedule found, as a feasible (not proven) answer.

        The schedule is real and legal — some pass proved it — so the honest
        outcome is `solved`. `exhausted` is reserved for a run that walked the
        WHOLE ladder and proved every rung; anything abandoned midway reports
        `timeout`, however well the passes it did run went.
        """
        problem_fingerprint = fingerprint_problem(problem)
        complete = not stopped_early and all(p["proven"] for p in passes)
        return envelope(
            request_id, "solved",
            assignments=best_assignments,
            passes=passes,
            candidateSpace=candidate_space(problem),
            stopCause="exhausted" if complete else "timeout",
            stopDetail=stop_detail,
            unmatchedPreservations=handles["unmatchedPreservations"],
            stability=stability,
            problemFingerprint=problem_fingerprint,
            solutionFingerprint=fingerprint_solution(best_assignments, problem_fingerprint),
            model={"candidates": handles["candidates"], "shiftBooleans": len(handles["x"]),
                   "demandSlots": len(handles["under"])},
            timings={"buildSeconds": build_seconds,
                     "firstSolutionSeconds": first_solution_seconds,
                     "searchSeconds": round(time.time() - started, 1)},
        )

    def note_budget_exhausted(interrupted):
        """Record that a pass was cut off mid-search rather than declined.

        Distinct from `may_continue`'s refusals: there the next pass never
        started, here one started and ran out of clock. Both leave the ladder
        incomplete, and a reader deserves to know which happened instead of
        seeing an empty reason next to a `timeout`.
        """
        nonlocal stop_detail
        stop_detail = (
            f"Passe « {interrupted['pass']} » interrompue par le budget "
            f"({interrupted['status']}) : le meilleur planning déjà prouvé est conservé."
        )

    def may_continue(previous):
        """Whether the NEXT lexicographic pass is allowed to start.

        Two conditions, and the first is a correctness rule rather than a budget
        one. Every pass opens by freezing the previous objective as an EQUALITY,
        so starting pass N+1 on an UNPROVEN pass N would pin a value that is only
        the best found so far — locking in, say, two under-covered slots when one
        was reachable, and then optimising the lower levels inside that mistake.
        An unproven level therefore ends the ladder instead of being frozen.

        The second is ordinary economy: a pass with seconds left cannot finish,
        and an unfinished pass produces nothing the next one is allowed to use.
        """
        nonlocal stop_detail
        if not previous["proven"]:
            stop_detail = (
                f"Passe « {previous['pass']} » non prouvée ({previous['status']}) : "
                "le niveau suivant aurait figé une valeur peut-être non optimale, "
                "la recherche s'arrête sur le meilleur planning connu."
            )
            return False
        left = remaining()
        if left < MIN_PASS_SECONDS:
            stop_detail = (
                f"Budget restant ({left:.1f} s) insuffisant pour lancer la passe "
                f"suivante (minimum {MIN_PASS_SECONDS:.0f} s)."
            )
            return False
        return True

    def carry_solution_forward():
        """Seed the next pass with the schedule the current one just found.

        Every finished pass leaves a full feasible schedule (the frozen equality
        makes it feasible for the next pass too), so hinting the shift booleans
        to their current values hands CP-SAT a ready incumbent instead of making
        it rediscover one. Cleared first so a pass is never hinted with a stale
        mix from two earlier passes. Hints on the booleans alone suffice — the
        minute, start and end variables are functionally implied and CP-SAT
        completes them.
        """
        if not use_hints:
            return
        model.ClearHints()
        for var in handles["x"].values():
            model.AddHint(var, solver.Value(var))

    # ── The lexicographic ladder, as data ──────────────────────────────────
    #
    # Each rung is (label, objective expression). The loop below freezes every
    # completed rung as an EQUALITY before stating the next, which is what makes
    # the order meaningful: a later objective can never buy an improvement by
    # degrading an earlier one.
    #
    # The order is data because it VARIES. Where the individual-distribution
    # objective sits — before or after the business cost — changes which weeks
    # come back, and that placement is a measured decision rather than a fixed
    # one. Encoding it as three copies of the sequence would have let them drift.
    coverage_slots = sum(handles["under"])
    deficit_minutes = sum(handles["shortfall"])
    business_cost = sum(miss * budget for miss, budget in handles["business"])
    distribution_gap = sum(handles["distributionDeviation"]) if handles["distributionDeviation"] else None

    ladder = [
        ("1-under-covered-slots", coverage_slots),
        # Equality, not "<=": this rung answers "given exactly this many short
        # slots, how few minutes can be missing", a different question from
        # "how few minutes overall".
        ("2-deficit-minutes", deficit_minutes),
    ]
    if distribution_pass == "after-deficit" and distribution_gap is not None:
        ladder.append(("3-individual-daily-distribution", distribution_gap))
        ladder.append(("4-business-deficit-cost", business_cost))
    elif distribution_pass == "after-business" and distribution_gap is not None:
        ladder.append(("3-business-deficit-cost", business_cost))
        ladder.append(("4-individual-daily-distribution", distribution_gap))
    else:
        ladder.append(("3-business-deficit-cost", business_cost))

    # Stability speaks LAST and only when a baseline exists. It is a comfort;
    # coverage is not. Allowed to speak earlier — or folded into a weighted sum —
    # it could buy a calmer-looking week by leaving one more slot short, and no
    # manager asked for that trade.
    wants_stability = bool(preservation.get("minimizeOtherChanges")) and handles["drift"] is not None
    if wants_stability:
        ladder.append((f"{len(ladder) + 1}-stability-drift-minutes", sum(handles["drift"])))

    previous = None
    for index, (label, objective) in enumerate(ladder):
        if previous is not None:
            # An unproven rung must never be frozen: pinning a value that is only
            # the best found so far would optimise every lower objective inside
            # that mistake.
            if not may_continue(previous[0]):
                stopped_early = True
                return solved_so_far()
            model.Add(previous[1] == previous[0]["objective"])

        solver.parameters.max_time_in_seconds = remaining()
        model.Minimize(objective)
        clock = FirstSolutionClock(started) if index == 0 else None
        outcome = run_pass(solver, model, label, callback=clock)
        if clock is not None:
            first_solution_seconds = clock.first_at
        passes.append(outcome)

        if outcome["objective"] is None:
            if index == 0:
                # INFEASIBLE is a proof about the problem; UNKNOWN is a statement
                # about the clock. Collapsing them would let a slow machine
                # declare a week impossible, the most expensive lie this file
                # can tell.
                proven_infeasible = outcome["status"] == "INFEASIBLE"
                return envelope(
                    request_id,
                    "infeasible" if proven_infeasible else "no-solution",
                    passes=passes,
                    candidateSpace=candidate_space(problem),
                    stopCause="exhausted" if proven_infeasible else "timeout",
                    unmatchedPreservations=handles["unmatchedPreservations"],
                    timings={"buildSeconds": build_seconds,
                             "firstSolutionSeconds": first_solution_seconds,
                             "searchSeconds": round(time.time() - started, 1)},
                )
            note_budget_exhausted(outcome)
            return solved_so_far()

        best_assignments = extract_assignments(problem, handles, solver)
        carry_solution_forward()
        if label.endswith("stability-drift-minutes"):
            stability = {"driftMinutes": outcome["objective"]}
            stability.update(
                drift_breakdown(preservation.get("baselineAssignments", []), best_assignments)
            )
        previous = (outcome, objective)

    return solved_so_far()


def drift_breakdown(baseline_assignments, assignments):
    """The same drift, itemised — for a human, never for the objective.

    Recomputed from the two schedules rather than read off the model, so the
    breakdown is an independent description of the answer instead of a restated
    intention.
    """
    before = {(str(s["employeeId"]), s["date"]): s for s in baseline_assignments}
    after = {}
    for a in assignments:
        first, last = a["segments"][0], a["segments"][-1]
        after[(str(a["employeeId"]), a["date"])] = {
            "startMinutes": first["startMinutes"], "endMinutes": last["endMinutes"]}

    removed = sum(1 for key in before if key not in after)
    added = sum(1 for key in after if key not in before)
    start_shift = sum(abs(after[k]["startMinutes"] - before[k]["startMinutes"])
                      for k in before if k in after)
    end_shift = sum(abs(after[k]["endMinutes"] - before[k]["endMinutes"])
                    for k in before if k in after)
    return {"removedShifts": removed, "addedShifts": added,
            "startShiftMinutes": start_shift, "endShiftMinutes": end_shift}


def main():
    # The envelope is UTF-8 on BOTH sides, and it has to be said out loud on
    # Windows: with stdout attached to a pipe, Python falls back to the system
    # code page (cp1252 here) while the Node adapter decodes strictly as UTF-8.
    # Every accented French diagnostic crossing that pipe came back mangled, and
    # a message carrying « » or é could break the parse outright rather than
    # merely look wrong.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):  # pragma: no cover - very old interpreters
        pass

    request_id = ""
    try:
        raw = sys.stdin.read()
    except OSError as error:
        print(json.dumps(fail("", "stdin-unreadable", str(error))))
        return 0

    try:
        request = json.loads(raw)
    except ValueError as error:
        print(json.dumps(fail("", "request-not-json", str(error))))
        return 0

    if not isinstance(request, dict):
        print(json.dumps(fail("", "request-not-an-object", "Le corps doit être un objet JSON.")))
        return 0

    request_id = request.get("requestId", "")
    received = request.get("protocolVersion")
    if received != PROTOCOL_VERSION:
        # Refused rather than best-effort: an envelope from another version may
        # differ in exactly the field whose absence would be read as "nothing
        # to preserve", and silently solving the wrong request is worse than
        # not solving it.
        print(json.dumps(fail(
            request_id, "protocol-version-mismatch",
            f"Attendu {PROTOCOL_VERSION}, reçu {received!r}.")))
        return 0

    if ORTOOLS_ERROR is not None:
        print(json.dumps(fail(request_id, "ortools-missing", ORTOOLS_ERROR)))
        return 0

    if "problem" not in request:
        print(json.dumps(fail(request_id, "request-missing-problem",
                              "L'enveloppe ne contient aucun problème.")))
        return 0

    try:
        response = solve(request)
    except Exception as error:  # noqa: BLE001 - the boundary must not leak
        response = fail(request_id, "solver-crashed", f"{type(error).__name__}: {error}")

    print(json.dumps(response, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
