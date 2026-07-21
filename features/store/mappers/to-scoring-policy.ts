import type { ScoringPolicy } from "@/features/core/scoring-engine"
import { DEFAULT_SCORING_POLICY } from "@/features/core/scoring-engine"

import type { StoreConfiguration } from "@/features/store/models"

/**
 * Map a `StoreConfiguration` to the scoring engine's `ScoringPolicy`. The store
 * config is the single source of the weights and thresholds; the dimension →
 * category mapping stays the engine's own default (not a store-level setting).
 */
export function toScoringPolicy(config: StoreConfiguration): ScoringPolicy {
  const { weights, warningCredit, feasibilityThreshold } = config.scoring
  return {
    weights: {
      coverage: weights.coverage,
      contract: weights.contract,
      availability: weights.availability,
      soft: weights.soft,
    },
    warningCredit,
    feasibilityThreshold,
    dimensionCategories: DEFAULT_SCORING_POLICY.dimensionCategories,
  }
}
