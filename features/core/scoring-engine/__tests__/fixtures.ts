import type {
  ConstraintEvaluationReport,
  EvaluatedConstraint,
} from "@/features/core/constraint-engine"
import type {
  ConstraintCategory,
  ConstraintOutcome,
  ConstraintType,
} from "@/features/core/constraint-engine/types"
import type { Coverage } from "@/features/core/demand-engine"
import type { CoverageStatistics } from "@/features/core/demand-engine"
import type { DemandId } from "@/features/core/demand-engine"

/** Fixed timestamp so every score is reproducible in time (determinism). */
export const EVALUATED_AT = "2026-07-18T00:00:00.000Z"

interface ConstraintSpec {
  readonly id: string
  readonly type: ConstraintType
  readonly category: ConstraintCategory
  readonly outcome: ConstraintOutcome
}

/** Build one evaluated constraint with sensible, irrelevant-to-scoring defaults. */
export function constraint(spec: ConstraintSpec): EvaluatedConstraint {
  return {
    constraintId: spec.id,
    category: spec.category,
    type: spec.type,
    priority: "medium",
    outcome: spec.outcome,
    violations: [],
    durationMs: 0,
    errored: false,
  }
}

/**
 * Build a `ConstraintEvaluationReport` from a list of constraints, deriving the
 * aggregate counts, the feasibility flag and the outcome buckets — exactly as
 * the real evaluator would, but deterministically.
 */
export function report(
  constraints: readonly EvaluatedConstraint[]
): ConstraintEvaluationReport {
  const passed = constraints.filter((c) => c.outcome === "pass")
  const warnings = constraints.filter((c) => c.outcome === "warning")
  const failed = constraints.filter((c) => c.outcome === "fail")
  const hardFailed = failed.filter((c) => c.type === "hard")
  const softFailed = failed.filter((c) => c.type === "soft")

  return {
    score: {
      total: constraints.length,
      passed: passed.length,
      warnings: warnings.length,
      failed: failed.length,
      hardViolationCount: hardFailed.length,
      softViolationCount: softFailed.length + warnings.length,
    },
    feasible: hardFailed.length === 0,
    hardViolations: [],
    softViolations: [],
    warnings,
    passed,
    constraints,
    executionTimeMs: 0,
    evaluatedAt: EVALUATED_AT,
  }
}

/**
 * Build a `Coverage` from statistics only (results/gaps are irrelevant to the
 * scoring engine, which reads `statistics`).
 */
export function coverage(stats: Partial<CoverageStatistics> = {}): Coverage {
  const statistics: CoverageStatistics = {
    totalRequirements: 0,
    covered: 0,
    underCovered: 0,
    overCovered: 0,
    requirementsWithMissingCapabilities: 0,
    totalRequiredMin: 0,
    totalAssigned: 0,
    overallCoveragePercentage: 1,
    ...stats,
  }

  return {
    demandId: "demand_test" as DemandId,
    results: [],
    gaps: [],
    statistics,
  }
}

/** Perfect coverage over `n` requirements. */
export function perfectCoverage(n = 4): Coverage {
  return coverage({
    totalRequirements: n,
    covered: n,
    totalRequiredMin: n,
    totalAssigned: n,
    overallCoveragePercentage: 1,
  })
}
