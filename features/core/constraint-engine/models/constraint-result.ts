import type {
  ConstraintId,
  ConstraintOutcome,
  ConstraintSeverity,
  ConstraintTarget,
  EntityRef,
} from "@/features/core/constraint-engine/types"

/**
 * A single breach of a constraint. Carries a human-readable `message` so the
 * engine can always explain WHY a decision was made (explainability is a
 * founding principle of Planiteo).
 */
export interface ConstraintViolation {
  readonly constraintId: ConstraintId
  readonly severity: ConstraintSeverity
  /** Human-readable explanation of the breach, surfaced to the manager. */
  readonly message: string
  /** What was being evaluated when the breach occurred. */
  readonly target: ConstraintTarget
  /** Domain entities involved in the breach. */
  readonly affected?: readonly EntityRef[]
  /** Penalty magnitude (soft violations) — informational, not a planning score. */
  readonly penalty?: number
  /** Structured context for tooling (values, thresholds, …). */
  readonly metadata?: Record<string, unknown>
}

/**
 * Outcome of evaluating one constraint against a `ConstraintContext`.
 *
 * `outcome` is the constraint's verdict (`pass` / `warning` / `fail`);
 * `violations` details every breach that produced it (empty on `pass`).
 */
export interface ConstraintResult {
  readonly constraintId: ConstraintId
  readonly outcome: ConstraintOutcome
  readonly violations: readonly ConstraintViolation[]
  /** Optional plain-language summary of the decision. */
  readonly message?: string
}
