import type { FairnessPolicy } from "@/features/core/fairness-engine"

import type { StoreConfiguration } from "@/features/store/models"

/**
 * Map a `StoreConfiguration` to the fairness engine's `FairnessPolicy`. Named
 * weights map to their dimension ids; `extraWeights` is spread last so future /
 * custom dimensions are weighted without any code change. A weight for a
 * dimension that has no registered calculator is simply ignored by the engine.
 */
export function toFairnessPolicy(config: StoreConfiguration): FairnessPolicy {
  const { weights, extraWeights, imbalanceThreshold, warningThreshold, minCohortSize } =
    config.fairness

  return {
    dimensionWeights: {
      worked_hours: weights.workedHours,
      opening: weights.opening,
      closing: weights.closing,
      weekend: weights.weekend,
      preference: weights.preferences,
      ...extraWeights,
    },
    imbalanceThreshold,
    warningFairnessThreshold: warningThreshold,
    minCohortSize,
  }
}
