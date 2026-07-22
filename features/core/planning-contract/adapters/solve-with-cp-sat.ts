import { PlanningEngineNotImplementedError } from "@/features/core/planning-contract/errors"
import type { EnginePreservationSupport } from "@/features/core/planning-contract/adapters/from-audited-v3"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type {
  PlanningSolveAdapter,
  SolvePlanningResponse,
} from "@/features/core/planning-contract/types/solve-response"

/**
 * CP-SAT, behind the neutral contract. Not wired up.
 *
 * The spike in `experiments/planning-v3-cpsat/` proves the model: it reads a
 * JSON snapshot of the V3 problem, returns a schedule the independent validator
 * accepts, and its optimum is pinned by tests. What does not exist yet is the
 * transport — a process boundary, a serialisation of the request, a deadline,
 * a way to cancel — and none of that can be faked from here.
 *
 * So it raises `engine-not-implemented`, which is a different claim from V2's
 * `unsupported-request-contract`: this engine CAN express the request, it is
 * simply not plugged in. It does NOT quietly hand the request to the DFS
 * prototype — a caller that asked for a proven optimum and silently received a
 * best-effort search would publish a schedule believing something false about
 * it. There is no fallback between engines anywhere in V3, and this is the
 * exact place that rule earns its keep.
 */
export const solveWithCpSat: PlanningSolveAdapter = async (
  request: SolvePlanningRequest
): Promise<SolvePlanningResponse> => {
  void request
  throw new PlanningEngineNotImplementedError(
    "cp-sat",
    "le modèle est démontré par le spike mais aucun transport (service, sérialisation, délai, annulation) n'est encore branché."
  )
}

/**
 * What CP-SAT will be able to preserve once it is wired in.
 *
 * Declared here, unused for now, because it is the reason CP-SAT is worth the
 * transport work: locks and manual edits become hard constraints, stability
 * becomes an objective term — and with no unmet preservation left, a run may
 * finally claim `optimal` on a regeneration, which the prototype never can.
 */
export const CP_SAT_PRESERVATION_TARGET: EnginePreservationSupport = {
  locks: true,
  manualEdits: true,
  minimizeOtherChanges: true,
}
