/**
 * The normalized vocabulary every engine answers in.
 *
 * `SolvePlanningResponse.outcome` is the ONE field a caller branches on. It
 * exists because the interesting distinctions are not "did it work": a proven
 * optimum, a legal schedule found before the clock ran out, a proven
 * impossibility, a malformed problem, a search that never found anything, a
 * user cancellation and a crashed backend all demand different words to a
 * manager and different handling in code — and each engine spells them
 * differently. Collapsing them into a boolean, or leaving each adapter to
 * invent its own, is how "the solver failed" ends up meaning seven things.
 */

export const SOLVE_PLANNING_OUTCOMES = [
  /** A genuine optimality certificate over a complete search space. */
  "optimal",
  /** A legal schedule, with no optimality claim attached to it. */
  "feasible",
  /** No legal schedule exists — proven, not assumed. */
  "infeasible",
  /** The problem itself is malformed; nothing was searched. */
  "invalid-problem",
  /** A declared limit stopped the search before any legal schedule was found. */
  "timeout-without-solution",
  /** The caller cancelled before any legal schedule was found. */
  "cancelled",
  /** The engine could not run or answer: transport, contract, or its own defect. */
  "backend-error",
] as const
export type SolvePlanningOutcome = (typeof SOLVE_PLANNING_OUTCOMES)[number]

/**
 * What is PROVEN about the returned solution — never what is hoped.
 *
 * Kept alongside `outcome` and required to agree with it (see
 * `optimalityForOutcome`). It is the narrow question "may the UI say the word
 * optimum", asked without having to enumerate seven outcomes at every call site.
 */
export const SOLVE_PLANNING_OPTIMALITIES = ["none", "feasible", "optimal"] as const
export type SolvePlanningOptimality = (typeof SOLVE_PLANNING_OPTIMALITIES)[number]

/**
 * Why the engine stopped, normalized across engines.
 *
 * `not-started` covers every stop that happened before any search: a malformed
 * problem, an infeasibility proven by necessary conditions, an adapter that
 * refused the request. It is NOT a synonym for "unknown" — an engine that
 * produced a schedule may never report it, which is what invariant
 * `feasible-requires-explicit-stop-cause` enforces.
 */
export const SOLVE_STOP_CAUSES = [
  "exhausted",
  "timeout",
  "state-limit",
  "cancelled",
  "not-started",
  "backend-error",
] as const
export type SolveStopCause = (typeof SOLVE_STOP_CAUSES)[number]

/** The three things a regeneration can ask an engine to protect. */
export const SOLVE_PRESERVATIONS = ["locks", "manual-edits", "stability"] as const
export type SolvePreservation = (typeof SOLVE_PRESERVATIONS)[number]

/** Whether the enumerated search space covers every legal shift for the rules. */
export type SolveCandidateSpace = "complete" | "incomplete"

/** The only two outcomes that carry a schedule. Every other one carries none. */
const OUTCOMES_WITH_SOLUTION: readonly SolvePlanningOutcome[] = ["optimal", "feasible"]

export function outcomeRequiresSolution(outcome: SolvePlanningOutcome): boolean {
  return OUTCOMES_WITH_SOLUTION.includes(outcome)
}

export function outcomeForbidsSolution(outcome: SolvePlanningOutcome): boolean {
  return !outcomeRequiresSolution(outcome)
}

/**
 * The optimality an outcome is allowed to claim. Total, and the only source.
 *
 * Deriving it rather than letting an adapter set both fields is what makes
 * "outcome says timeout, optimality says optimal" unrepresentable.
 */
export function optimalityForOutcome(outcome: SolvePlanningOutcome): SolvePlanningOptimality {
  if (outcome === "optimal") return "optimal"
  if (outcome === "feasible") return "feasible"
  return "none"
}

/**
 * Why a run produced no schedule, in the engine's own terms.
 *
 * Split finely on purpose: the whole risk this classifier removes is an adapter
 * that catches a dead HTTP connection and reports "no schedule exists". Those
 * two are one `catch` block apart and worlds apart in meaning — the first is an
 * outage, the second is a statement about the business that a manager will act
 * on. Only the two kinds that carry an actual proof may reach `infeasible`.
 */
export const ENGINE_FAILURE_KINDS = [
  /** The problem did not typecheck as a problem. Nothing was searched. */
  "malformed-problem",
  /** Necessary conditions proved no schedule can exist, before searching. */
  "proven-infeasible",
  /** The declared space was fully explored and held no legal schedule. */
  "exhausted-without-solution",
  /** A wall-clock budget ran out first. Proves nothing. */
  "timeout",
  /** A declared ceiling on explored states was hit first. Proves nothing. */
  "state-limit",
  /** The caller asked to stop. Proves nothing. */
  "cancelled",
  /** The engine could not be reached or did not answer. */
  "transport",
  /** The adapter cannot express this request for its engine at all. */
  "unsupported-request-contract",
  /** The engine returned a schedule its independent validator rejected. */
  "engine-contradicted-by-validator",
] as const
export type EngineFailureKind = (typeof ENGINE_FAILURE_KINDS)[number]

/**
 * Map a failed run onto the normalized outcome.
 *
 * Total, pure and the single place the mapping lives, so "a backend error never
 * becomes infeasible" is one function to read and one function to test rather
 * than a rule repeated in every adapter and eventually broken in one of them.
 *
 * A state limit reports as `timeout-without-solution` rather than gaining an
 * outcome of its own: both are DECLARED stops that prove nothing, they are told
 * apart by `stopCause`, and a caller that treats them differently would be
 * acting on how the search was budgeted, not on what was learned.
 */
export function outcomeOfEngineFailure(kind: EngineFailureKind): SolvePlanningOutcome {
  switch (kind) {
    case "malformed-problem":
      return "invalid-problem"
    case "proven-infeasible":
    case "exhausted-without-solution":
      return "infeasible"
    case "timeout":
    case "state-limit":
      return "timeout-without-solution"
    case "cancelled":
      return "cancelled"
    case "transport":
    case "unsupported-request-contract":
    case "engine-contradicted-by-validator":
      return "backend-error"
  }
}

/**
 * The failure kinds that carry a proof about the PROBLEM, and may therefore
 * speak about it. Everything else speaks only about the run.
 */
export const PROVING_FAILURE_KINDS: readonly EngineFailureKind[] = [
  "malformed-problem",
  "proven-infeasible",
  "exhausted-without-solution",
]

export function isSolvePlanningOutcome(value: unknown): value is SolvePlanningOutcome {
  return (
    typeof value === "string" && (SOLVE_PLANNING_OUTCOMES as readonly string[]).includes(value)
  )
}
