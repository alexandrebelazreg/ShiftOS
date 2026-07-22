import type { EmployeeId, IsoDate } from "@/features/core/models"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"

import type {
  SolveCandidateSpace,
  SolvePlanningOptimality,
  SolvePlanningOutcome,
  SolvePreservation,
  SolveStopCause,
} from "@/features/core/planning-contract/types/solve-outcome"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"

/**
 * The single answer shape every engine must produce.
 *
 * The point is subtraction: once this exists, no caller may branch on which
 * engine ran. A component that asks "is this CP-SAT?" is a component that will
 * break the day CP-SAT is swapped out, and it is also a component that quietly
 * encodes an engine's quirks in the view layer. Everything the UI legitimately
 * needs — what happened, is it publishable, what must a human accept, was my
 * local work kept, is anything proven — is answered here, identically, whoever
 * answered.
 */

/**
 * Which implementation produced the response.
 *
 * Reporting only. It exists so a support log can say what ran; it is NOT a
 * switch any caller is allowed to branch on for behaviour. `outcome` is.
 */
export const SOLVE_PLANNING_ENGINES = ["v2", "dfs-v3", "cp-sat"] as const
export type SolvePlanningEngine = (typeof SOLVE_PLANNING_ENGINES)[number]

/**
 * - `blocking`    — a hard constraint is broken; the schedule may not be published.
 * - `degradation` — legal, but measurably worse than it should be.
 * - `information` — a neutral fact worth surfacing.
 */
export type SolveDiagnosticSeverity = "blocking" | "degradation" | "information"

/**
 * One reported fact about the answer, in vocabulary the UI can render without
 * knowing which engine minted it.
 *
 * `code` is a free string rather than a closed union on purpose: CP-SAT will
 * report reasons a DFS search cannot, and a closed union would force every new
 * engine reason through a change to this file — which is exactly the coupling
 * the contract removes. The UI keys its rendering off `severity`, never `code`.
 */
export interface SolveDiagnostic {
  readonly code: string
  readonly severity: SolveDiagnosticSeverity
  readonly message: string
  /** True when a human must knowingly accept THIS entry before publishing. */
  readonly requiresExplicitAcceptance: boolean
  readonly employeeId?: EmployeeId
  readonly date?: IsoDate
  /** The value the rule requires, when the rule is numeric. */
  readonly expected?: number
  /** The value measured on the returned solution. */
  readonly actual?: number
}

/**
 * Diagnostic codes that mean THE ENGINE failed, not that the problem is hard.
 *
 * Declared rather than left implicit because one contract invariant is written
 * in terms of them: a response carrying any of these may never be reported as
 * `infeasible`. An outage is not a statement about the business.
 */
export const BACKEND_FAILURE_DIAGNOSTIC_CODES = [
  "unsupported-request-contract",
  "engine-not-implemented",
  "engine-transport-failure",
  "solver-contradicted-by-validator",
] as const
export type BackendFailureDiagnosticCode = (typeof BACKEND_FAILURE_DIAGNOSTIC_CODES)[number]

export function isBackendFailureCode(code: string): boolean {
  return (BACKEND_FAILURE_DIAGNOSTIC_CODES as readonly string[]).includes(code)
}

/** An engine internal worth showing in a technical panel, already worded. */
export interface SolveTechnicalFact {
  readonly label: string
  readonly value: string
}

export interface SolvePlanningDiagnostics {
  /** True when at least one entry is `blocking`. Never publish on true. */
  readonly blocking: boolean
  /**
   * True when at least one entry is itself flagged `requiresExplicitAcceptance`.
   * Never derived from "are there degradations at all": an informative
   * degradation added later must not silently start gating publication.
   */
  readonly requiresExplicitAcceptance: boolean
  readonly entries: readonly SolveDiagnostic[]
  /** Everything a manager never needs; kept for the technical accordion. */
  readonly technical: readonly SolveTechnicalFact[]
}

/**
 * What the engine did with the request, as opposed to what it produced.
 *
 * The `respected*` booleans are the reason this contract earns its keep. An
 * engine that ignores locks is allowed to exist — the DFS prototype does — but
 * it is not allowed to be silent about it. The manager who pinned four shifts
 * learns from `respectedLocks: false` that regenerating will move them, and
 * learns it from the same field regardless of which engine answered.
 */
export interface SolvePlanningMetadata {
  readonly engine: SolvePlanningEngine
  /** The pinned shifts came back exactly where they were. Vacuously true if none were asked for. */
  readonly respectedLocks: boolean
  /** The manual moves and resizes survived. Vacuously true if none were asked for. */
  readonly respectedManualEdits: boolean
  /** The untouched rest of the week was ACTIVELY kept stable. False when it was never asked for. */
  readonly minimizedOtherChanges: boolean
  /**
   * Exactly what was asked for and not delivered.
   *
   * The three booleans above cannot express this on their own:
   * `minimizedOtherChanges: false` means either "never asked" or "asked and
   * refused", and those are opposite facts. The invariant that forbids
   * `optimal` alongside a broken promise needs the difference, and so does any
   * manager reading why a regeneration is about to move their pinned work.
   */
  readonly unmetPreservations: readonly SolvePreservation[]
  readonly optimality: SolvePlanningOptimality
  /**
   * Whether the enumerated space covered every legal shift for the announced
   * rules. `incomplete` forbids `optimal`: an optimum over part of the space is
   * not an optimum, it is a good answer to a smaller question.
   */
  readonly candidateSpace: SolveCandidateSpace
  readonly stopCause: SolveStopCause
}

export interface SolvePlanningResponse {
  /**
   * What happened, normalized. The one field callers branch on.
   *
   * It is not redundant with `solution === null`: five different outcomes carry
   * no schedule, and telling a manager "no schedule exists" when the truth is
   * "the search was cut short" or "the service is down" is the single most
   * costly confusion this contract prevents.
   */
  readonly outcome: SolvePlanningOutcome
  /**
   * Null for every outcome except `optimal` and `feasible`.
   *
   * The sprint brief typed this non-nullable. It cannot be: `infeasible` is a
   * real, expected outcome of a rigid problem, and a non-nullable field would
   * force an adapter to fabricate an empty schedule and pass it off as an
   * answer. `null` with blocking diagnostics is the honest encoding, and it
   * keeps the "no fallback between engines" rule the V3 socle is built on.
   */
  readonly solution: PlanningSolutionV3 | null
  readonly diagnostics: SolvePlanningDiagnostics
  readonly metadata: SolvePlanningMetadata
}

/**
 * The only thing a caller needs to hold to run a planning.
 *
 * Injected, never discovered — same rule as `PlanningEngineSelector`. A screen
 * receives one of these and can no more name CP-SAT than it can name V2.
 *
 * Asynchronous by contract even though the in-process prototype answers
 * immediately: CP-SAT runs out of process, and a synchronous signature would
 * have to break the day it is wired in. Callers await from the start.
 */
export type PlanningSolveAdapter = (
  request: SolvePlanningRequest
) => Promise<SolvePlanningResponse>
