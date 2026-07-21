import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"
import type { ConstraintCategory } from "@/features/core/constraint-engine/types"

import type { DimensionScore } from "@/features/core/scoring-engine/models"
import type { ScoreDimension } from "@/features/core/scoring-engine/types"
import type { ScoringPolicy } from "@/features/core/scoring-engine/policies"
import { tallySatisfaction } from "@/features/core/scoring-engine/calculators/constraint-satisfaction"
import { clamp01, round } from "@/features/core/scoring-engine/utils"

/**
 * Score one CATEGORY-derived dimension (e.g. `contract`, `availability`) from
 * the constraints whose category is in `categories`. Both category dimensions
 * share this so the credit rule and the "no matching constraint ⇒ perfect"
 * convention are defined once.
 */
export function categoryScore(
  dimension: ScoreDimension,
  report: ConstraintEvaluationReport,
  categories: readonly ConstraintCategory[],
  weight: number,
  policy: ScoringPolicy
): DimensionScore {
  const wanted = new Set<ConstraintCategory>(categories)
  const tally = tallySatisfaction(
    report.constraints,
    (constraint) => wanted.has(constraint.category),
    policy.warningCredit
  )

  return {
    dimension,
    score: round(clamp01(tally.satisfaction)),
    weight,
    evaluated: tally.evaluated,
    passed: tally.passed,
    warned: tally.warned,
    failed: tally.failed,
  }
}
