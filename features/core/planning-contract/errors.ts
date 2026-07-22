import { requestedPreservations } from "@/features/core/planning-contract/types/solve-request"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type {
  SolvePlanningEngine,
  SolvePlanningResponse,
} from "@/features/core/planning-contract/types/solve-response"
import type {
  EngineFailureKind,
  SolvePreservation,
} from "@/features/core/planning-contract/types/solve-outcome"
import { outcomeOfEngineFailure } from "@/features/core/planning-contract/types/solve-outcome"

/**
 * Structured failures an adapter may raise, and the one way to normalize them.
 *
 * Every error here is a statement about an ENGINE, never about a problem. That
 * separation is the whole design: `toBackendErrorResponse` can therefore be
 * total and unconditional, and there is no branch anywhere in this file that
 * could produce `infeasible`.
 */

export const PLANNING_CONTRACT_ERROR_CODES = [
  /** The adapter cannot express this request for its engine at all. */
  "unsupported-request-contract",
  /** The engine is declared but not wired up yet. */
  "engine-not-implemented",
  /** The engine could not be reached, or did not answer. */
  "engine-transport-failure",
] as const
export type PlanningContractErrorCode = (typeof PLANNING_CONTRACT_ERROR_CODES)[number]

export class PlanningContractError extends Error {
  readonly code: PlanningContractErrorCode
  readonly engine: SolvePlanningEngine

  constructor(code: PlanningContractErrorCode, engine: SolvePlanningEngine, reason: string) {
    super(`[${code}] moteur « ${engine} » : ${reason}`)
    this.name = "PlanningContractError"
    this.code = code
    this.engine = engine
  }
}

/**
 * The adapter cannot translate this request for its engine — at all, ever.
 *
 * Distinct from "not implemented yet", which is a schedule problem. This one is
 * a statement about expressiveness: the request says things the engine has no
 * way to hear, so no amount of work on the adapter fixes it without changing
 * the engine. Raising it is how V2 refuses a V3 request instead of guessing.
 */
export class UnsupportedRequestContractError extends PlanningContractError {
  constructor(engine: SolvePlanningEngine, reason: string) {
    super("unsupported-request-contract", engine, reason)
    this.name = "UnsupportedRequestContractError"
  }
}

/** Declared in the contract, not yet wired to anything that can answer. */
export class PlanningEngineNotImplementedError extends PlanningContractError {
  constructor(engine: SolvePlanningEngine, reason: string) {
    super("engine-not-implemented", engine, reason)
    this.name = "PlanningEngineNotImplementedError"
  }
}

/**
 * Turn any thrown failure into a well-formed response, without a fallback.
 *
 * For callers that want one uniform shape rather than a `try`/`catch` per
 * engine. The outcome is `backend-error` by construction — obtained from
 * `outcomeOfEngineFailure`, never chosen here — so the rule that a failing
 * backend never becomes `infeasible` holds by the structure of this function
 * and not by the vigilance of whoever edits it next.
 *
 * It returns NO schedule and offers NO other engine. A caller that asked for
 * CP-SAT and silently received a depth-first search would publish a week
 * believing something false about it.
 */
export function toBackendErrorResponse(
  engine: SolvePlanningEngine,
  error: unknown,
  request: SolvePlanningRequest
): SolvePlanningResponse {
  const code =
    error instanceof PlanningContractError ? error.code : "engine-transport-failure"
  // Both kinds land on `backend-error`; they are kept apart so the outcome is
  // still READ from the classifier rather than written down here by hand.
  const kind: EngineFailureKind =
    code === "unsupported-request-contract" ? "unsupported-request-contract" : "transport"
  const message = error instanceof Error ? error.message : String(error)
  const requested = requestedPreservations(request)

  const unmetPreservations: SolvePreservation[] = []
  // Nothing ran, so nothing that was asked for was delivered. Reporting the
  // demands as met because the engine never got far enough to break them would
  // be the politest possible lie.
  if (requested.locks) unmetPreservations.push("locks")
  if (requested.manualEdits) unmetPreservations.push("manual-edits")
  if (requested.minimizeOtherChanges) unmetPreservations.push("stability")

  return {
    outcome: outcomeOfEngineFailure(kind),
    solution: null,
    diagnostics: {
      blocking: true,
      requiresExplicitAcceptance: false,
      entries: [
        {
          code,
          severity: "blocking",
          message,
          requiresExplicitAcceptance: false,
        },
      ],
      technical: [
        { label: "Moteur", value: engine },
        { label: "Erreur", value: error instanceof Error ? error.name : "inconnue" },
      ],
    },
    metadata: {
      engine,
      respectedLocks: !requested.locks,
      respectedManualEdits: !requested.manualEdits,
      minimizedOtherChanges: false,
      unmetPreservations,
      optimality: "none",
      candidateSpace: "incomplete",
      stopCause: "backend-error",
    },
  }
}
