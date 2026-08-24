"""
EXPERIMENT — the `v3-highs-fast` side of the Planning V3 solve contract.

Reads ONE request envelope on stdin, writes ONE response envelope on stdout,
exits. Same shape as `cpsat_service.py`, and deliberately so: the Node side
already knows how to spawn a Python process, hand it JSON and refuse anything
that is not a well-formed envelope. A second transport would be a second thing
to get wrong.

It never raises past `main`. Every failure — a malformed envelope, a missing
dependency, a model error, no solution — comes back as a structured envelope,
because the caller must be able to tell "the week is impossible" from "the
solver fell over", and an exception on stderr cannot make that distinction.

What this engine does NOT do
----------------------------
It cannot pin a shift, keep a manual edit, or stay close to a previous
schedule. It solves from scratch every time. That is stated once here and once
in the adapter's `HIGHS_FAST_PRESERVATION_SUPPORT`, and the contract turns it
into unmet preservations a manager can see — never into a silent unlock.

Usage (the adapter does this; a human can too, for debugging):
    echo '<request json>' | python highs_service.py
"""

from __future__ import annotations

import json
import platform
import sys
import time
from typing import Any

PROTOCOL_VERSION = "planning-v3-highs/1"

#: No request may hold a manager's screen longer than this, whatever it asks
#: for. The measured worst case across a fifty-nine scenario perturbation
#: campaign was sixty-two seconds; ninety leaves room without leaving the
#: budget open-ended.
MAX_TIMEOUT_SECONDS = 90.0
DEFAULT_TIMEOUT_SECONDS = 90.0


def _fail(request_id: str, code: str, message: str) -> dict[str, Any]:
    """A structured refusal. Never a schedule, never an infeasibility."""
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "status": "error",
        "assignments": [],
        "diagnostics": {},
        "environment": _environment(),
        "error": {"code": code, "message": message},
        "problemFingerprint": None,
        "solutionFingerprint": None,
    }


def _environment() -> dict[str, Any]:
    environment: dict[str, Any] = {
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
    try:
        import scipy  # noqa: PLC0415

        environment["scipy"] = scipy.__version__
    except Exception:  # the version is a nicety; its absence is not a failure
        environment["scipy"] = None
    return environment


#: How a solver verdict becomes a protocol status.
#:
#: The mapping is the whole point of this file. `feasible-best-effort` carries a
#: legal schedule with a measured shortfall and must read as SOLVED — a week the
#: team cannot fully cover is still a week they will work. Only an impossibility
#: the engine actually proved becomes `infeasible`; exhausting a heuristic
#: neighbourhood becomes `no-solution`, which says "we found nothing" without
#: claiming there was nothing to find.
_STATUS = {
    "feasible-zero-deficit": "solved",
    "feasible-best-effort": "solved",
    "infeasible-proven": "infeasible",
    "timeout-without-solution": "no-solution",
    "invalid-problem": "invalid-problem",
}


def main() -> int:
    # Windows: with stdout attached to a pipe, Python falls back to the system
    # code page and mangles every accented diagnostic on the way out.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    except Exception:
        pass

    try:
        raw = sys.stdin.read()
    except Exception as error:
        print(json.dumps(_fail("", "stdin-unreadable", str(error))))
        return 0

    try:
        request = json.loads(raw)
    except Exception as error:
        print(json.dumps(_fail("", "request-not-json", str(error))))
        return 0

    if not isinstance(request, dict):
        print(json.dumps(_fail("", "request-not-an-object", "Le corps doit être un objet JSON.")))
        return 0

    request_id = str(request.get("requestId") or "")

    if request.get("protocolVersion") != PROTOCOL_VERSION:
        print(
            json.dumps(
                _fail(
                    request_id,
                    "protocol-version-mismatch",
                    f"Protocole attendu {PROTOCOL_VERSION}, reçu {request.get('protocolVersion')!r}.",
                )
            )
        )
        return 0

    problem = request.get("problem")
    if not isinstance(problem, dict):
        print(json.dumps(_fail(request_id, "request-missing-problem", "`problem` absent ou non objet.")))
        return 0

    # Imported here, not at module scope: a missing scipy must come back as a
    # structured `highs-missing` rather than a traceback the adapter would have
    # to guess at.
    try:
        from shiftos_highs.fingerprint import fingerprint_problem, fingerprint_solution
        from shiftos_highs_fast import solve_fast
    except Exception as error:
        print(json.dumps(_fail(request_id, "highs-missing", f"Dépendances Python absentes : {error}")))
        return 0

    options = request.get("options") if isinstance(request.get("options"), dict) else {}
    try:
        timeout = float(options.get("timeoutSeconds", DEFAULT_TIMEOUT_SECONDS))
    except (TypeError, ValueError):
        timeout = DEFAULT_TIMEOUT_SECONDS
    timeout = max(1.0, min(timeout, MAX_TIMEOUT_SECONDS))

    started = time.perf_counter()
    try:
        result = solve_fast(problem, time_limit_seconds=timeout)
    except (KeyError, TypeError, ValueError) as error:
        # A problem this engine cannot read is INVALID, not impossible. The
        # difference decides whether a manager fixes their roster or is told
        # their shop cannot open.
        print(json.dumps(_fail(request_id, "problem-unreadable", str(error))))
        return 0
    except Exception as error:  # defensive: a crash is never a verdict
        print(json.dumps(_fail(request_id, "solver-crashed", repr(error))))
        return 0

    status = _STATUS.get(str(result.get("status")), "error")
    solution = result.get("solution") or {}
    assignments = solution.get("assignments", []) if isinstance(solution, dict) else []
    diagnostics = dict(result.get("diagnostics") or {})
    diagnostics["engineStatus"] = result.get("status")
    diagnostics["wallSeconds"] = round(time.perf_counter() - started, 3)

    response = {
        "protocolVersion": PROTOCOL_VERSION,
        "requestId": request_id,
        "status": status,
        "assignments": assignments if status == "solved" else [],
        "diagnostics": diagnostics,
        "environment": _environment(),
        "error": None
        if status != "error"
        else {"code": "unknown-engine-status", "message": str(result.get("status"))},
        "problemFingerprint": result.get("problemFingerprint") or fingerprint_problem(problem),
        "solutionFingerprint": result.get("solutionFingerprint"),
    }
    _ = fingerprint_solution
    print(json.dumps(response, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
