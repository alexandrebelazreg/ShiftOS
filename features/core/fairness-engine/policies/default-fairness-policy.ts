import type { FairnessPolicy } from "@/features/core/fairness-engine/policies/fairness-policy"

/**
 * DEFAULT_FAIRNESS_POLICY — sensible starting values, NOT business truths.
 *
 * Gathered here so the calculators and the engine stay free of magic numbers.
 * Retuning the engine must never require editing logic — only this policy (or a
 * caller-supplied one).
 *
 * Rationale for the defaults:
 * - `dimensionWeights` empty ⇒ every dimension counts equally;
 * - `imbalanceThreshold` 0.5 ⇒ flag anyone 50% above/below the mean;
 * - `warningFairnessThreshold` 0.75 ⇒ warn once a dimension drops under 75%
 *   fairness;
 * - `minCohortSize` 2 ⇒ a single employee cannot be "unfair" to themselves.
 */
export const DEFAULT_FAIRNESS_POLICY: FairnessPolicy = {
  dimensionWeights: {},
  imbalanceThreshold: 0.5,
  warningFairnessThreshold: 0.75,
  minCohortSize: 2,
}
