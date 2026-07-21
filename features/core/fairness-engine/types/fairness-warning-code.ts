/**
 * Stable codes for fairness warnings. Open set so future dimensions / business
 * packs can add their own without touching the engine.
 *
 * - `dimension_imbalance` — one dimension's fairness fell below the policy's
 *   warning threshold.
 * - `cohort_too_small`    — fewer members than `minCohortSize`; fairness is not
 *   statistically meaningful.
 */
export const FAIRNESS_WARNING_CODES = [
  "dimension_imbalance",
  "cohort_too_small",
] as const
export type KnownFairnessWarningCode = (typeof FAIRNESS_WARNING_CODES)[number]
export type FairnessWarningCode = KnownFairnessWarningCode | (string & {})
