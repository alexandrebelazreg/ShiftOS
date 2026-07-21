import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"

import type { DimensionScore } from "@/features/core/scoring-engine/models"
import type { ScoringPolicy } from "@/features/core/scoring-engine/policies"
import { tallySatisfaction } from "@/features/core/scoring-engine/calculators/constraint-satisfaction"
import { clamp01, round } from "@/features/core/scoring-engine/utils"

/**
 * Soft dimension — overall satisfaction of SOFT constraints across every
 * category (preferences, fairness, continuity, workload, …). A `warning` earns
 * `warningCredit`, a `fail` earns nothing.
 *
 * `weight` is supplied by the orchestrator (its normalized share of the quality
 * blend).
 */
export function softScore(
  report: ConstraintEvaluationReport,
  weight: number,
  policy: ScoringPolicy
): DimensionScore {
  const tally = tallySatisfaction(
    report.constraints,
    (constraint) => constraint.type === "soft",
    policy.warningCredit
  )

  return {
    dimension: "soft",
    score: round(clamp01(tally.satisfaction)),
    weight,
    evaluated: tally.evaluated,
    passed: tally.passed,
    warned: tally.warned,
    failed: tally.failed,
  }
}
