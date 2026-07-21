import type { EmployeeId } from "@/features/core/models"

import type { EmployeeStatistics } from "@/features/core/statistics-engine"
import type {
  DetectedImbalance,
  FairnessDimensionScore,
  FairnessInput,
  FairnessReport,
  FairnessWarning,
} from "@/features/core/fairness-engine/models"
import type { FairnessPolicy } from "@/features/core/fairness-engine/policies"
import { DEFAULT_FAIRNESS_POLICY } from "@/features/core/fairness-engine/policies"
import type { FairnessRegistry } from "@/features/core/fairness-engine/registry"
import { createDefaultFairnessRegistry } from "@/features/core/fairness-engine/registry"
import type { FairnessContext } from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"
import { analyzeDimension } from "@/features/core/fairness-engine/calculators/distribution-analyzer"
import { clamp01, round, toPercentLabel } from "@/features/core/fairness-engine/utils"

/** Optional overrides for a fairness analysis. */
export interface FairnessOptions {
  /** Measurement tuning. Defaults to `DEFAULT_FAIRNESS_POLICY`. */
  readonly policy?: FairnessPolicy
  /** Dimension catalogue. Defaults to the shipped dimensions. */
  readonly registry?: FairnessRegistry
}

/**
 * FairnessEngine — measures how fairly work is distributed across a team and
 * produces a structured `FairnessReport`. It only ANALYZES: no planning
 * modification, no repair, no optimization, no I/O. Pure and deterministic —
 * the same input always yields the same report.
 *
 * It reads the dimension catalogue from a registry, so it contains no list of
 * dimensions itself: adding one never touches this file.
 */
export interface FairnessEngine {
  analyze(input: FairnessInput, options?: FairnessOptions): FairnessReport
}

export const fairnessEngine: FairnessEngine = {
  analyze(input: FairnessInput, options: FairnessOptions = {}): FairnessReport {
    const policy = options.policy ?? DEFAULT_FAIRNESS_POLICY
    const registry = options.registry ?? createDefaultFairnessRegistry()
    const calculators = registry.all()

    // Cohort = the employees fairness is owed to. Only active members count;
    // those without statistics still participate (value 0).
    const cohort = input.employees.filter((employee) => employee.status === "active")
    const context = buildContext(input)

    const weights = normalizedWeights(calculators.map((c) => c.dimension), policy)

    const dimensions: FairnessDimensionScore[] = []
    const imbalances: DetectedImbalance[] = []
    for (const calculator of calculators) {
      const analysis = analyzeDimension(
        calculator,
        cohort,
        context,
        policy,
        weights.get(calculator.dimension) ?? 0
      )
      dimensions.push(analysis.score)
      imbalances.push(...analysis.imbalances)
    }

    const overall =
      dimensions.length === 0
        ? 1
        : round(
            clamp01(
              dimensions.reduce((sum, dim) => sum + dim.fairness * dim.weight, 0)
            )
          )

    const warnings = buildWarnings(dimensions, cohort.length, policy)

    return {
      overall,
      dimensions,
      warnings,
      imbalances,
      details: {
        cohortSize: cohort.length,
        dimensionCount: dimensions.length,
        periodStart: input.planning.periodStart,
        periodEnd: input.planning.periodEnd,
      },
    }
  },
}

function buildContext(input: FairnessInput): FairnessContext {
  const statisticsByEmployee = new Map<EmployeeId, EmployeeStatistics>(
    input.statistics.map((stat) => [stat.employeeId, stat])
  )
  return {
    planning: input.planning,
    employees: input.employees,
    assignments: input.assignments,
    statistics: input.statistics,
    statisticsByEmployee,
  }
}

/**
 * Normalize the configured dimension weights so they sum to 1 over the ACTIVE
 * dimensions. A dimension absent from the policy defaults to weight 1. If every
 * weight is 0, fall back to equal weights so the overall score stays meaningful.
 */
function normalizedWeights(
  dimensions: readonly string[],
  policy: FairnessPolicy
): Map<string, number> {
  const raw = dimensions.map((dim) => policy.dimensionWeights[dim] ?? 1)
  const total = raw.reduce((sum, w) => sum + w, 0)
  const result = new Map<string, number>()
  dimensions.forEach((dim, i) => {
    if (total > 0) result.set(dim, raw[i] / total)
    else result.set(dim, dimensions.length > 0 ? 1 / dimensions.length : 0)
  })
  return result
}

function buildWarnings(
  dimensions: readonly FairnessDimensionScore[],
  cohortSize: number,
  policy: FairnessPolicy
): FairnessWarning[] {
  const warnings: FairnessWarning[] = []

  if (cohortSize < policy.minCohortSize) {
    warnings.push({
      code: "cohort_too_small",
      severity: "info",
      message: `Only ${cohortSize} active employee(s); fairness is not meaningful below ${policy.minCohortSize}.`,
    })
    // Below the cohort floor, per-dimension warnings would be noise.
    return warnings
  }

  for (const dim of dimensions) {
    if (dim.fairness < policy.warningFairnessThreshold) {
      warnings.push({
        code: "dimension_imbalance",
        severity: dim.fairness < 0.5 ? "major" : "minor",
        dimension: dim.dimension,
        message: `Unfair ${dim.dimension} distribution (fairness ${toPercentLabel(
          dim.fairness
        )}).`,
      })
    }
  }

  return warnings
}
