from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from shiftos_highs import solve


def main() -> int:
    parser = argparse.ArgumentParser(description="Planiteo Planning V3 parity solver using SciPy/HiGHS")
    parser.add_argument("problem", type=Path, help="PlanningProblemV3 JSON file")
    parser.add_argument("--output", type=Path, help="Write the full result JSON to this path")
    parser.add_argument("--time-limit", type=float, default=45.0)
    args = parser.parse_args()

    try:
        problem = json.loads(args.problem.read_text(encoding="utf-8"))
        result = solve(problem, time_limit_seconds=args.time_limit)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "invalid-problem", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:  # defensive CLI boundary
        print(json.dumps({"status": "backend-error", "error": repr(exc)}, ensure_ascii=False), file=sys.stderr)
        return 3

    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)

    # Exit codes follow what the caller can DO about the answer, not whether the
    # word "optimal" appears. A schedule found under a time limit is a schedule;
    # reporting it as failure would push a caller to discard a usable week.
    if result["status"] in {"optimal", "feasible-time-limit"}:
        return 0
    if result["status"] == "infeasible-proven":
        return 1
    if result["status"] == "timeout-without-solution":
        return 4
    if result["status"] == "invalid-problem":
        return 2
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
