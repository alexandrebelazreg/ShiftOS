import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"

import type { DimensionScore } from "@/features/core/scoring-engine/models"
import type { ScoringPolicy } from "@/features/core/scoring-engine/policies"
import { tallySatisfaction } from "@/features/core/scoring-engine/calculators/constraint-satisfaction"
import { clamp01, round } from "@/features/core/scoring-engine/utils"

/**
 * Hard dimension — respect of HARD constraints. This is the FEASIBILITY GATE:
 * its `weight` is always `0` (it never joins the quality blend), and its score
 * is what caps an infeasible planning below the feasibility threshold.
 *
 * `score` = share of hard constraints that passed (`1` when none exist).
 * `warningCredit` is irrelevant here (hard constraints never `warning`) but is
 * passed through for a single, uniform tally implementation.
 */
export function hardScore(
  report: ConstraintEvaluationReport,
  policy: ScoringPolicy
): DimensionScore {
  const tally = tallySatisfaction(
    report.constraints,
    (constraint) => constraint.type === "hard",
    policy.warningCredit
  )

  return {
    dimension: "hard",
    score: round(clamp01(tally.satisfaction)),
    weight: 0,
    evaluated: tally.evaluated,
    passed: tally.passed,
    warned: tally.warned,
    failed: tally.failed,
  }
}
