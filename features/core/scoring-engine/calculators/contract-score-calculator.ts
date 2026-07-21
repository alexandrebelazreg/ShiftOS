import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"

import type { DimensionScore } from "@/features/core/scoring-engine/models"
import type { ScoringPolicy } from "@/features/core/scoring-engine/policies"
import { categoryScore } from "@/features/core/scoring-engine/calculators/category-score-calculator"

/**
 * Contract dimension — respect of contractual / workload obligations. Sourced
 * from the constraints whose category is listed under
 * `policy.dimensionCategories.contract` (default: `["workload"]`).
 */
export function contractScore(
  report: ConstraintEvaluationReport,
  weight: number,
  policy: ScoringPolicy
): DimensionScore {
  return categoryScore(
    "contract",
    report,
    policy.dimensionCategories.contract,
    weight,
    policy
  )
}
