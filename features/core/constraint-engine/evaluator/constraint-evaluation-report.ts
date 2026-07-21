import type { ConstraintViolation } from "@/features/core/constraint-engine/models"
import type {
  ConstraintCategory,
  ConstraintId,
  ConstraintOutcome,
  ConstraintPriority,
  ConstraintType,
} from "@/features/core/constraint-engine/types"

/**
 * One constraint's evaluated outcome as it appears in the report. Combines the
 * constraint's verdict with engine bookkeeping (timing, whether it threw).
 */
export interface EvaluatedConstraint {
  readonly constraintId: ConstraintId
  readonly category: ConstraintCategory
  readonly type: ConstraintType
  readonly priority: ConstraintPriority
  readonly outcome: ConstraintOutcome
  readonly violations: readonly ConstraintViolation[]
  readonly message?: string
  /** Wall-clock time this constraint took, in milliseconds. */
  readonly durationMs: number
  /** True if the constraint threw (isolated by the engine, counted as a fail). */
  readonly errored: boolean
}

/**
 * The "global score" — an AGGREGATE of constraint outcomes, not a planning
 * quality score (that is deliberately deferred). Pure counts.
 */
export interface ConstraintScore {
  readonly total: number
  readonly passed: number
  readonly warnings: number
  readonly failed: number
  readonly hardViolationCount: number
  readonly softViolationCount: number
}

/**
 * The full result of evaluating a planning against every registered constraint.
 */
export interface ConstraintEvaluationReport {
  /** Aggregate outcome counts. */
  readonly score: ConstraintScore
  /** True when no hard constraint failed. */
  readonly feasible: boolean

  /** Violations produced by hard constraints. */
  readonly hardViolations: readonly ConstraintViolation[]
  /** Violations produced by soft constraints. */
  readonly softViolations: readonly ConstraintViolation[]
  /** Constraints whose outcome was `warning`. */
  readonly warnings: readonly EvaluatedConstraint[]
  /** Constraints whose outcome was `pass`. */
  readonly passed: readonly EvaluatedConstraint[]
  /** Every evaluated constraint, in registration order. */
  readonly constraints: readonly EvaluatedConstraint[]

  /** Total wall-clock evaluation time in milliseconds. */
  readonly executionTimeMs: number
  readonly evaluatedAt: string
}
