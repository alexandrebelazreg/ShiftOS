import type { ScoringPolicy } from "@/features/core/scoring-engine/policies/scoring-policy"

/**
 * DEFAULT_SCORING_POLICY — sensible starting values, NOT business truths.
 *
 * Every field here is a default meant to be overridden per store / tenant once
 * the product exposes weight configuration. They are gathered in this single
 * object precisely so the calculators stay free of magic numbers. Changing the
 * balance of the engine must never require editing a calculator — only this
 * policy (or a caller-supplied one).
 *
 * Rationale for the defaults:
 * - coverage is weighted highest: meeting demand is the primary purpose of a
 *   planning;
 * - contract and availability matter but rank below raw coverage;
 * - `soft` captures every remaining preference/fairness signal at equal weight;
 * - `warningCredit` 0.5: a soft warning is "half a miss";
 * - `feasibilityThreshold` 0.6: feasible plannings live in [0.6, 1], infeasible
 *   ones in [0, 0.6).
 */
export const DEFAULT_SCORING_POLICY: ScoringPolicy = {
  weights: {
    coverage: 0.4,
    contract: 0.2,
    availability: 0.2,
    soft: 0.2,
  },
  warningCredit: 0.5,
  feasibilityThreshold: 0.6,
  dimensionCategories: {
    contract: ["workload"],
    availability: ["availability"],
  },
}
