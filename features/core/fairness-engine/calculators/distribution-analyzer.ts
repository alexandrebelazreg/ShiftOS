import type { Employee } from "@/features/core/models"

import type {
  DetectedImbalance,
  EmployeeValue,
  FairnessDimensionScore,
} from "@/features/core/fairness-engine/models"
import type { FairnessPolicy } from "@/features/core/fairness-engine/policies"
import type {
  FairnessContext,
  FairnessDimensionCalculator,
} from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"
import { describe, fairnessOf, gini, round } from "@/features/core/fairness-engine/utils"

/** The full analysis of one dimension: its score plus any imbalances it found. */
export interface DimensionAnalysis {
  readonly score: FairnessDimensionScore
  readonly imbalances: readonly DetectedImbalance[]
}

/**
 * Analyze ONE dimension across the cohort. This is the shared machinery every
 * calculator reuses: it turns a per-employee value extractor into a fairness
 * score and a list of imbalances. Because all the maths lives here, a new
 * dimension never reimplements any of it.
 *
 * Deterministic: the distribution is sorted by value (desc) then employee id,
 * and imbalances follow the same order.
 */
export function analyzeDimension(
  calculator: FairnessDimensionCalculator,
  cohort: readonly Employee[],
  context: FairnessContext,
  policy: FairnessPolicy,
  weight: number
): DimensionAnalysis {
  const distribution: EmployeeValue[] = cohort
    .map((employee) => ({
      employeeId: employee.id,
      value: calculator.valueOf(employee.id, context),
    }))
    .sort((a, b) =>
      b.value !== a.value ? b.value - a.value : a.employeeId < b.employeeId ? -1 : 1
    )

  const values = distribution.map((entry) => entry.value)
  const stats = describe(values)

  const score: FairnessDimensionScore = {
    dimension: calculator.dimension,
    fairness: round(fairnessOf(values)),
    gini: round(gini(values)),
    weight: round(weight),
    evaluated: stats.count,
    total: stats.total,
    mean: round(stats.mean),
    min: stats.min,
    max: stats.max,
    distribution,
  }

  const imbalances = detectImbalances(calculator, distribution, stats.mean, cohort.length, policy)

  return { score, imbalances }
}

/**
 * Flag members whose relative deviation from the mean meets the policy
 * threshold. Skipped when the cohort is too small or the mean is zero (nothing
 * was distributed, so no one is over- or under-loaded).
 */
function detectImbalances(
  calculator: FairnessDimensionCalculator,
  distribution: readonly EmployeeValue[],
  mean: number,
  cohortSize: number,
  policy: FairnessPolicy
): DetectedImbalance[] {
  if (cohortSize < policy.minCohortSize || mean <= 0) return []

  const imbalances: DetectedImbalance[] = []
  for (const entry of distribution) {
    const deviation = (entry.value - mean) / mean
    if (Math.abs(deviation) < policy.imbalanceThreshold) continue
    imbalances.push({
      dimension: calculator.dimension,
      employeeId: entry.employeeId,
      value: entry.value,
      mean: round(mean),
      deviation: round(deviation),
      direction: deviation > 0 ? "over" : "under",
    })
  }
  return imbalances
}
