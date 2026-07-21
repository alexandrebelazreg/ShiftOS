import type { DimensionScore } from "@/features/core/scoring-engine/models/DimensionScore"

/**
 * CoverageDetail — a flat snapshot of the demand engine's coverage statistics,
 * copied into the score so a consumer can explain the coverage dimension
 * without re-fetching the original `Coverage`.
 */
export interface CoverageDetail {
  readonly totalRequirements: number
  readonly covered: number
  readonly underCovered: number
  readonly overCovered: number
  readonly requirementsWithMissingCapabilities: number
  /** Share of requirements meeting their minimum, in `[0, 1]`. */
  readonly overallCoveragePercentage: number
}

/**
 * ScoreDetails — the full computation trail behind a `PlanningScore`. It carries
 * no verdict of its own; it exists purely for explainability and debugging.
 */
export interface ScoreDetails {
  /** The pre-gate weighted quality blend, in `[0, 1]`. */
  readonly quality: number
  /** The `feasibilityThreshold` that separated feasible from infeasible. */
  readonly feasibilityThreshold: number

  readonly hardConstraintsTotal: number
  readonly hardConstraintsFailed: number
  readonly softConstraintsTotal: number
  /** Soft constraints that returned `warning` or `fail`. */
  readonly softConstraintsUnsatisfied: number

  readonly coverage: CoverageDetail

  /** Every dimension score, in a stable order, for a single explainable table. */
  readonly dimensions: readonly DimensionScore[]

  /** Copied from the source report so the score is reproducible in time. */
  readonly evaluatedAt: string
}
