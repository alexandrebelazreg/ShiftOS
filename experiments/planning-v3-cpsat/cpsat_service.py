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


def envelope(request_id, status, **fields):
    out = {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "status": status,
        "assignments": [],
        "passes": [],
        "candidateSpace": "incomplete",
        "stopCause": "not-started",
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
    """Run the lexicographic passes and describe exactly what was proven."""
    from cpsat_model import (
        build_model,
        candidate_space,
        extract_assignments,
        fingerprint_problem,
        fingerprint_solution,
        run_pass,
    )

    request_id = request.get("requestId", "")
    problem = request["problem"]
    preservation = request.get("preservation") or {}
    options = request.get("options") or {}

    timeout = float(options.get("timeoutSeconds", 600.0))
    seed = int(options.get("seed", 1))
    # One worker by default: the CP-SAT portfolio is not reproducible across
    # runs, so a result that claims determinism must be single-threaded.
    workers = int(options.get("workers", 1))

    try:
        model, handles = build_model(problem, preservation)
    except (KeyError, TypeError, ValueError) as error:
        return envelope(request_id, "invalid-problem",
                        error={"code": "model-error", "message": f"{type(error).__name__}: {error}"})

    solver = cp_model.CpSolver()
    solver.parameters.random_seed = seed
    solver.parameters.num_search_workers = workers

    started = time.time()
    passes = []

    def remaining():
        return max(0.1, timeout - (time.time() - started))

    # ── Pass 1 — minimise the number of under-covered slots ────────────────
    solver.parameters.max_time_in_seconds = remaining()
    model.Minimize(sum(handles["under"]))
    first = run_pass(solver, model, "1-under-covered-slots")
    passes.append(first)
    if first["objective"] is None:
        # INFEASIBLE is a proof about the problem; UNKNOWN is a statement about
        # the clock. Collapsing them would let a slow machine declare a week
        # impossible, which is the single most expensive lie this file can tell.
        proven_infeasible = first["status"] == "INFEASIBLE"
        return envelope(
            request_id,
            "infeasible" if proven_infeasible else "no-solution",
            passes=passes,
            candidateSpace=candidate_space(problem),
            stopCause="exhausted" if proven_infeasible else "timeout",
            unmatchedPreservations=handles["unmatchedPreservations"],
        )

    # ── Pass 2 — freeze that count, minimise the missing minutes ───────────
    # Equality, not "<=": pass 2 answers "given exactly this many short slots,
    # how few minutes can be missing", a different question from "how few
    # minutes overall".
    model.Add(sum(handles["under"]) == first["objective"])
    solver.parameters.max_time_in_seconds = remaining()
    model.Minimize(sum(handles["shortfall"]))
    second = run_pass(solver, model, "2-deficit-minutes")
    passes.append(second)
    if second["objective"] is None:
        return envelope(request_id, "no-solution", passes=passes,
                        candidateSpace=candidate_space(problem), stopCause="timeout",
                        unmatchedPreservations=handles["unmatchedPreservations"])

    # ── Pass 3 — freeze both, minimise the business cost of the shortfall ──
    model.Add(sum(handles["shortfall"]) == second["objective"])
    solver.parameters.max_time_in_seconds = remaining()
    model.Minimize(sum(miss * budget for miss, budget in handles["business"]))
    third = run_pass(solver, model, "3-business-deficit-cost")
    passes.append(third)
    if third["objective"] is None:
        return envelope(request_id, "no-solution", passes=passes,
                        candidateSpace=candidate_space(problem), stopCause="timeout",
                        unmatchedPreservations=handles["unmatchedPreservations"])

    # ── Pass 4 — freeze all three, minimise drift from the baseline ────────
    #
    # Stated LAST and only after the three business levels are pinned as
    # equality constraints. Stability is a comfort; coverage is not. A stability
    # term allowed to speak earlier — or folded into a weighted sum — could buy
    # a calmer-looking week by leaving one more slot short, and no manager asked
    # for that trade.
    stability = None
    if preservation.get("minimizeOtherChanges") and handles["drift"] is not None:
        model.Add(sum(miss * budget for miss, budget in handles["business"])
                  == third["objective"])
        solver.parameters.max_time_in_seconds = remaining()
        model.Minimize(sum(handles["drift"]))
        fourth = run_pass(solver, model, "4-stability-drift-minutes")
        passes.append(fourth)
        if fourth["objective"] is None:
            return envelope(request_id, "no-solution", passes=passes,
                            candidateSpace=candidate_space(problem), stopCause="timeout",
                            unmatchedPreservations=handles["unmatchedPreservations"])
        stability = {"driftMinutes": fourth["objective"]}

    assignments = extract_assignments(problem, handles, solver)
    if stability is not None:
        stability.update(drift_breakdown(preservation.get("baselineAssignments", []), assignments))

    problem_fingerprint = fingerprint_problem(problem)
    all_proven = all(p["proven"] for p in passes)
    return envelope(
        request_id,
        "solved",
        assignments=assignments,
        passes=passes,
        candidateSpace=candidate_space(problem),
        # `exhausted` means every stated pass was proven optimal. Anything less
        # is a declared stop, and the contract forbids calling it an optimum.
        stopCause="exhausted" if all_proven else "timeout",
        unmatchedPreservations=handles["unmatchedPreservations"],
        stability=stability,
        problemFingerprint=problem_fingerprint,
        solutionFingerprint=fingerprint_solution(assignments, problem_fingerprint),
        model={"candidates": handles["candidates"], "shiftBooleans": len(handles["x"]),
               "demandSlots": len(handles["under"])},
    )


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
