import type { EmployeeId, IsoDate } from "@/features/core/models"

/**
 * Planning V3 solution model — what a solver returns, expressed only in the
 * vocabulary of the problem it answers.
 *
 * A solution carries no verdict about itself. Whether it is legal is decided
 * exclusively by the independent validator, which recomputes every figure from
 * the problem and these assignments.
 */

export const PLANNING_SOLUTION_V3_VERSION = "v3.0.0"
export type PlanningSolutionVersionV3 = typeof PLANNING_SOLUTION_V3_VERSION

/** One continuous worked interval. A split shift has several. */
export interface PlanningSegmentV3 {
  readonly startMinutes: number
  readonly endMinutes: number
}

/** Sous-intervalle travaillé dans un rayon précis. */
export interface PlanningSectorAssignmentV3 {
  readonly sectorId: string
  readonly startMinutes: number
  readonly endMinutes: number
}

/** Everything one employee works on one date. */
export interface PlanningAssignmentV3 {
  readonly employeeId: EmployeeId
  readonly date: IsoDate
  readonly segments: readonly PlanningSegmentV3[]
  /**
   * Couverture exacte des segments par rayon. Absent sur une ancienne solution
   * mono-rayon, auquel cas tout le shift appartient au rayon du problème.
   */
  readonly sectorAssignments?: readonly PlanningSectorAssignmentV3[]
}

/**
 * Figures the SOLVER claims about its own solution.
 *
 * The validator recomputes each of them independently and reports a blocking
 * violation on disagreement. This is the cross-check that stops a single bug
 * from being present in both the generator and its audit: a generator that
 * miscounts its structural surplus is caught precisely because it had to
 * commit to a number here.
 */
export interface PlanningDeclaredMetricsV3 {
  readonly structuralSurplusMinutes?: number
  readonly avoidableSurplusMinutes?: number
  readonly totalDeficitMinutes?: number
}

export interface PlanningSolutionV3 {
  readonly version: PlanningSolutionVersionV3
  /** Fingerprint of the problem this solution answers. */
  readonly problemFingerprint: string
  readonly assignments: readonly PlanningAssignmentV3[]
  readonly declaredMetrics?: PlanningDeclaredMetricsV3
}
