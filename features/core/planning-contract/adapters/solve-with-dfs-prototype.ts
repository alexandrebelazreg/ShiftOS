import { solveAndValidatePlanningV3 } from "@/features/core/planning-v3/orchestrator/solve-and-validate"
import type { AuditedSolutionV3 } from "@/features/core/planning-v3/orchestrator/solve-and-validate"
import type { PlanningSolverOptionsV3 } from "@/features/core/planning-v3/types/solver"

import { toBackendErrorResponse } from "@/features/core/planning-contract/errors"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type {
  PlanningSolveAdapter,
  SolvePlanningResponse,
} from "@/features/core/planning-contract/types/solve-response"
import type { EnginePreservationSupport } from "@/features/core/planning-contract/adapters/from-audited-v3"
import { toSolvePlanningResponse } from "@/features/core/planning-contract/adapters/from-audited-v3"

/**
 * The V3B depth-first weekly search, behind the neutral contract.
 *
 * The one adapter that answers today. It runs the existing solver untouched,
 * has the independent validator audit the result, and translates both into the
 * shared response — so the caller sees the same shape it will see from CP-SAT,
 * with the same meaning attached to `outcome`, `blocking` and the `respected*`
 * flags. Not a line of the search algorithm changed to make this possible; the
 * whole translation lives in `from-audited-v3`.
 *
 * It solves the problem from scratch every time. It cannot pin a shift, cannot
 * keep a manual move, and does not optimise for stability against a previous
 * schedule; `PROTOTYPE_PRESERVATION_SUPPORT` states that plainly, and the
 * mapper turns it into unmet preservations, diagnostics a manager can act on,
 * and — via the contract invariants — a refusal to ever call such a run
 * `optimal`. A schedule that discards the manager's pinned work is not the
 * optimum of the problem they posed.
 */
export const PROTOTYPE_PRESERVATION_SUPPORT: EnginePreservationSupport = {
  locks: false,
  manualEdits: false,
  minimizeOtherChanges: false,
}

export function createDfsPrototypeAdapter(
  options: PlanningSolverOptionsV3 = {}
): PlanningSolveAdapter {
  return async (request: SolvePlanningRequest): Promise<SolvePlanningResponse> => {
    let audited: AuditedSolutionV3
    try {
      audited = solveAndValidatePlanningV3(request.problem, options)
    } catch (error) {
      // A solver that throws has told us nothing about the problem. Reporting
      // that as `infeasible` would turn a crash into a business verdict; the
      // classifier inside `toBackendErrorResponse` makes that unrepresentable.
      return toBackendErrorResponse("dfs-v3", error, request)
    }

    // Deliberately NOT wrapped: a contract violation raised here is a defect in
    // the translation above, and swallowing it into a `backend-error` response
    // would hide the one bug this boundary exists to catch.
    return toSolvePlanningResponse("dfs-v3", request, audited, PROTOTYPE_PRESERVATION_SUPPORT)
  }
}

/**
 * The adapter with no declared limit.
 *
 * Prefer `createDfsPrototypeAdapter({ timeoutMs })` anywhere a user is waiting:
 * an unbounded search on a large problem does not fail, it simply does not come
 * back, and a timeout is recorded in the outcome rather than hidden.
 */
export const solveWithDfsPrototype: PlanningSolveAdapter = createDfsPrototypeAdapter()
