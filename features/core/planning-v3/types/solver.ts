import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type {
  PlanningInfeasibilityV3,
  PlanningSolverProofV3,
} from "@/features/core/planning-v3/types/validation"

/**
 * Planning V3 solver contract.
 *
 * The four statuses are deliberately not collapsible into a boolean. A solver
 * that cannot tell "proven optimal" from "best found before the clock ran out"
 * is a solver whose output cannot be trusted to publish, which is the whole
 * reason V3 exists.
 */
export type PlanningSolverStatusV3 =
  /** The declared space was fully explored or safely bounded away. */
  | "optimal"
  /** A legal solution was found, but a declared limit stopped the search. */
  | "feasible-timeout"
  /** No legal solution exists — proven, or reported with diagnostics. */
  | "infeasible"
  /** The problem itself is malformed; nothing was searched. */
  | "invalid-problem"

export interface PlanningSolverOptionsV3 {
  /** Wall-clock budget. Reaching it forbids `optimal`. */
  readonly timeoutMs?: number
  /**
   * Hard ceiling on explored search states. This is a DECLARED stop, never a
   * silent one: reaching it is recorded in the proof and forbids `optimal`.
   */
  readonly maximumStates?: number
  /** Cooperative cancellation, polled between states. */
  readonly signal?: { readonly aborted: boolean }
  readonly collectStatistics?: boolean
}

export interface PlanningSolverStatisticsV3 {
  readonly candidatesGenerated: number
  /** Complete day assignments examined. */
  readonly dailyPatternsEvaluated: number
  /** Search nodes expanded, all depths combined. */
  readonly weeklyStatesEvaluated: number
  /** Nodes cut by an optimistic bound that could not beat the incumbent. */
  readonly branchesPrunedByBound: number
  /** Nodes cut because a constraint could no longer be satisfied. */
  readonly branchesPrunedByFeasibility: number
  readonly durationMs: number
  readonly peakOpenNodes: number
}

export interface PlanningSolverResultV3 {
  readonly status: PlanningSolverStatusV3
  /** The best legal solution found, or null when there is none. */
  readonly solution: PlanningSolutionV3 | null
  /** Lexicographic objective of `solution`, in the problem's declared order. */
  readonly objective: readonly number[] | null
  readonly proof: PlanningSolverProofV3
  readonly statistics: PlanningSolverStatisticsV3
  /** Structured reasons when the problem admits no solution. */
  readonly diagnostics: readonly PlanningInfeasibilityV3[]
}
