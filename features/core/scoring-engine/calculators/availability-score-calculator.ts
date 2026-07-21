import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"

import type { DimensionScore } from "@/features/core/scoring-engine/models"
import type { ScoringPolicy } from "@/features/core/scoring-engine/policies"
import { categoryScore } from "@/features/core/scoring-engine/calculators/category-score-calculator"

/**
 * Availability dimension — respect of employee availability. Sourced from the
 * constraints whose category is listed under
 * `policy.dimensionCategories.availability` (default: `["availability"]`).
 *
 * Note: availability constraints are typically HARD, so their failures also
 * drive the feasibility gate via the `hard` dimension. This dimension is the
 * category-focused lens on the same facts.
 */
export function availabilityScore(
  report: ConstraintEvaluationReport,
  weight: number,
  policy: ScoringPolicy
): DimensionScore {
  return categoryScore(
    "availability",
    report,
    policy.dimensionCategories.availability,
    weight,
    policy
  )
}
