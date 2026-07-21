import type { Coverage } from "@/features/core/demand-engine"

import type { DimensionScore } from "@/features/core/scoring-engine/models"
import { clamp01, round } from "@/features/core/scoring-engine/utils"

/**
 * Coverage dimension — how well demand is met. Unlike the constraint-derived
 * dimensions, coverage has an authoritative source: the demand engine's
 * `CoverageStatistics`. We use its `overallCoveragePercentage` directly (share
 * of requirements meeting their minimum) rather than re-deriving it, keeping a
 * single source of truth for coverage.
 *
 * Count mapping (for explainability, not for the score itself):
 * - `passed`  = fully covered requirements;
 * - `warned`  = over-covered requirements (a deviation, not a shortfall);
 * - `failed`  = under-covered requirements (the real problem).
 */
export function coverageScore(coverage: Coverage, weight: number): DimensionScore {
  const stats = coverage.statistics

  return {
    dimension: "coverage",
    score: round(clamp01(stats.overallCoveragePercentage)),
    weight,
    evaluated: stats.totalRequirements,
    passed: stats.covered,
    warned: stats.overCovered,
    failed: stats.underCovered,
  }
}
