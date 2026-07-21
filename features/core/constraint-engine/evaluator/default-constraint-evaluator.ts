import type {
  Constraint,
  ConstraintContext,
  ConstraintViolation,
} from "@/features/core/constraint-engine/models"
import type { ConstraintRegistry } from "@/features/core/constraint-engine/registry"
import type { ConstraintEvaluator } from "@/features/core/constraint-engine/evaluator/constraint-evaluator"
import type {
  ConstraintEvaluationReport,
  ConstraintScore,
  EvaluatedConstraint,
} from "@/features/core/constraint-engine/evaluator/constraint-evaluation-report"

function aggregate(
  constraints: readonly EvaluatedConstraint[],
  executionTimeMs: number,
  evaluatedAt: string
): ConstraintEvaluationReport {
  const passed = constraints.filter((c) => c.outcome === "pass")
  const warnings = constraints.filter((c) => c.outcome === "warning")
  const failed = constraints.filter((c) => c.outcome === "fail")

  const hardViolations: ConstraintViolation[] = constraints
    .filter((c) => c.type === "hard")
    .flatMap((c) => [...c.violations])
  const softViolations: ConstraintViolation[] = constraints
    .filter((c) => c.type === "soft")
    .flatMap((c) => [...c.violations])

  const score: ConstraintScore = {
    total: constraints.length,
    passed: passed.length,
    warnings: warnings.length,
    failed: failed.length,
    hardViolationCount: hardViolations.length,
    softViolationCount: softViolations.length,
  }

  const feasible = !constraints.some((c) => c.type === "hard" && c.outcome === "fail")

  return {
    score,
    feasible,
    hardViolations,
    softViolations,
    warnings,
    passed,
    constraints,
    executionTimeMs,
    evaluatedAt,
  }
}

/**
 * The default, plugin-driven constraint evaluator.
 *
 * It iterates the registry's enabled constraints — there is no switch/case and
 * no per-constraint branching. Each constraint is timed and wrapped in a
 * try/catch so a throwing constraint is isolated (recorded as a failure) and
 * never prevents the others from being evaluated.
 */
export const constraintEvaluator: ConstraintEvaluator = {
  evaluateOne(
    constraint: Constraint,
    context: ConstraintContext
  ): EvaluatedConstraint {
    const start = performance.now()
    try {
      const result = constraint.evaluate(context)
      return {
        constraintId: constraint.id,
        category: constraint.category,
        type: constraint.type,
        priority: constraint.priority,
        outcome: result.outcome,
        violations: result.violations,
        message: result.message,
        durationMs: performance.now() - start,
        errored: false,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const violation: ConstraintViolation = {
        constraintId: constraint.id,
        severity: constraint.type === "hard" ? "blocking" : "minor",
        message: `Constraint "${constraint.id}" threw during evaluation: ${reason}`,
        target: { scope: "planning", planningId: context.planning.id },
      }
      return {
        constraintId: constraint.id,
        category: constraint.category,
        type: constraint.type,
        priority: constraint.priority,
        outcome: "fail",
        violations: [violation],
        message: "Evaluation error.",
        durationMs: performance.now() - start,
        errored: true,
      }
    }
  },

  evaluate(
    registry: ConstraintRegistry,
    context: ConstraintContext
  ): ConstraintEvaluationReport {
    const start = performance.now()
    const evaluated = registry
      .enabled()
      .map((constraint) => this.evaluateOne(constraint, context))
    const executionTimeMs = performance.now() - start
    return aggregate(evaluated, executionTimeMs, new Date().toISOString())
  },
}
