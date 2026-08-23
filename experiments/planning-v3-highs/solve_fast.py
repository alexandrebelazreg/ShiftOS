from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from shiftos_highs_fast import solve_fast


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Planiteo Planning V3 — moteur decompose v3-highs-fast"
    )
    parser.add_argument("problem", type=Path, help="PlanningProblemV3 JSON file")
    parser.add_argument("--output", type=Path, help="Write the full result JSON here")
    parser.add_argument("--time-limit", type=float, default=60.0)
    parser.add_argument("--skeletons", type=int, default=24)
    parser.add_argument("--swaps", type=int, default=400)
    parser.add_argument("--generations", type=int, default=6)
    parser.add_argument("--repair-pairs", type=int, default=10)
    args = parser.parse_args()

    try:
        problem = json.loads(args.problem.read_text(encoding="utf-8"))
        result = solve_fast(
            problem,
            time_limit_seconds=args.time_limit,
            skeletons_per_allocation=args.skeletons,
            swap_limit=args.swaps,
            max_generations=args.generations,
            repair_pairs=args.repair_pairs,
        )
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

    if result["status"] in {"feasible-zero-deficit", "feasible-best-effort"}:
        return 0
    if result["status"] == "infeasible-proven":
        return 1
    if result["status"] == "timeout-without-solution":
        return 4
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
