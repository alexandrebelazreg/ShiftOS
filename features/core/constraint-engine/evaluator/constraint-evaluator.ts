import type { Constraint, ConstraintContext } from "@/features/core/constraint-engine/models"
import type { ConstraintRegistry } from "@/features/core/constraint-engine/registry"
import type {
  ConstraintEvaluationReport,
  EvaluatedConstraint,
} from "@/features/core/constraint-engine/evaluator/constraint-evaluation-report"

/**
 * The evaluator runs constraints against a context and aggregates their results
 * into a report. It contains NO scheduling, generation or optimization — it only
 * evaluates.
 *
 * Constraints are evaluated independently: a constraint that throws is isolated
 * (recorded as a failure) and never stops the others.
 */
export interface ConstraintEvaluator {
  /** Evaluate one constraint, capturing timing and isolating errors. */
  evaluateOne(
    constraint: Constraint,
    context: ConstraintContext
  ): EvaluatedConstraint

  /** Evaluate every enabled constraint of a registry against the context. */
  evaluate(
    registry: ConstraintRegistry,
    context: ConstraintContext
  ): ConstraintEvaluationReport
}
