/**
 * The planning solve contract — one request in, one response out.
 *
 * This barrel is the surface the application is meant to import. It exports
 * TYPES, PURE functions and structured errors, and it deliberately does NOT
 * re-export the adapters: pulling a solver into every module that merely wants
 * to name `SolvePlanningResponse` would undo the separation this module exists
 * for. An engine is reached explicitly through
 * `@/features/core/planning-contract/adapters`, by the composition layer, once.
 *
 * Import frontier (enforced by `__tests__/contract-boundaries.test.ts`):
 * - allowed here: Core models, the V3 problem and solution TYPES;
 * - forbidden here: any solver, validator or orchestrator; the V2 generator;
 *   React, Next.js, the DOM, browser storage, and anything under
 *   `features/planning` — the UI depends on the contract, never the reverse.
 */
export * from "@/features/core/planning-contract/types"
export { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
export {
  assertSolvePlanningResponse,
  checkSolvePlanningResponse,
  isPublishableOutcome,
  isValidSolvePlanningResponse,
  SolveContractViolationError,
} from "@/features/core/planning-contract/invariants"
export type { SolveContractViolation } from "@/features/core/planning-contract/invariants"
export {
  PLANNING_CONTRACT_ERROR_CODES,
  PlanningContractError,
  PlanningEngineNotImplementedError,
  toBackendErrorResponse,
  UnsupportedRequestContractError,
} from "@/features/core/planning-contract/errors"
export type { PlanningContractErrorCode } from "@/features/core/planning-contract/errors"
