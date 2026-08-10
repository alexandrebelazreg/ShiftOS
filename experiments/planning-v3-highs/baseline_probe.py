"""Mono-sector production probe. Run before and after a change; diff the JSON.

Not a test: a measurement. It records what the fast engine actually produces on
the reference fixtures — status, coverage, solution fingerprint and the final
allocation — so a multi-sector change can be shown not to have moved them.

HOW TO READ A DIFF, because three fields lie and one fixture wanders.

`skeletonsGenerated`, `uniqueAllocations` and `shiftsGenerated` count how much
search happened, not what came out of it. They move with the wall clock alone —
the same code explored 128 allocations in one run and 383 in the next — so a
diff on them means nothing. Compare `solutionFingerprint`, the coverage figures
and `finalAllocation`.

`relax-problem.json` does not settle on one answer. Identical code has returned
120/2 and 150/3 minutes on it. Before calling a difference there a regression,
run that fixture alone three times on the version you suspect; if it reaches the
other version's fingerprint by itself, there is nothing to fix.

And the machine must be idle. Placement runs under a WALL-CLOCK limit, so a
`grep -r` in another window is enough to change the result — it once turned a
planned week into no schedule at all. Run the before and after back to back in
one command, and do nothing else meanwhile.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from shiftos_highs_fast.pipeline import solve_fast

ROOT = Path(__file__).resolve().parent

FIXTURES = [
    "drive-canonical-problem.json",
    "accueil-canonical-problem.json",
    "drive-absences-problem.json",
    "secteur-utilisateur-problem.json",
    "budget-variant-problem.json",
    "relax-problem.json",
]


def main() -> None:
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 60.0
    out: dict[str, object] = {}
    for name in FIXTURES:
        path = ROOT / "fixtures" / name
        if not path.exists():
            continue
        problem = json.loads(path.read_text(encoding="utf-8"))
        answer = solve_fast(problem, time_limit_seconds=seconds)
        diagnostics = answer.get("diagnostics") or {}
        out[name] = {
            "status": answer["status"],
            "reason": diagnostics.get("reason"),
            "problemFingerprint": answer.get("problemFingerprint"),
            "solutionFingerprint": answer.get("solutionFingerprint"),
            "referenceShortSlots": diagnostics.get("referenceShortSlots"),
            "referenceDeficitMinutes": diagnostics.get("referenceDeficitMinutes"),
            "adaptedTargetShortSlots": diagnostics.get("adaptedTargetShortSlots"),
            "adaptedTargetDeficitMinutes": diagnostics.get("adaptedTargetDeficitMinutes"),
            "finalAllocation": diagnostics.get("finalAllocation"),
            "finalAllocationOrigin": diagnostics.get("finalAllocationOrigin"),
            "bestOrigin": diagnostics.get("bestOrigin"),
            "skeletonsGenerated": diagnostics.get("skeletonsGenerated"),
            "uniqueAllocations": diagnostics.get("uniqueAllocations"),
            "shiftsGenerated": diagnostics.get("shiftsGenerated"),
            "adaptedTargetByDate": diagnostics.get("adaptedTargetByDate"),
            "surplusByDate": diagnostics.get("surplusByDate"),
        }
    print(json.dumps(out, indent=1, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
