/**
 * FairnessPolicy — the DECISIONS the engine needs that are not computations. It
 * carries no domain data. Every value is configurable so the engine hardcodes
 * no business threshold (a founding ShiftOS rule).
 *
 * Note: the policy tunes MEASUREMENT (weights, thresholds). It never expresses
 * business policy about what a fair planning "should" be — the engine measures,
 * it never decides.
 */
export interface FairnessPolicy {
  /**
   * Relative weight of each dimension in the overall score, keyed by dimension
   * name. A PARTIAL map: a dimension absent from it defaults to weight `1`.
   * Weights are normalized at runtime, so only their ratios matter. Set a
   * weight to `0` to report a dimension without letting it affect the overall
   * score.
   */
  readonly dimensionWeights: Readonly<Record<string, number>>

  /**
   * Relative deviation from the mean, in `[0, ∞)`, at or beyond which an
   * employee is flagged as an imbalance. `0.5` = 50% above or below the mean.
   */
  readonly imbalanceThreshold: number

  /**
   * A dimension whose fairness falls below this value (in `[0, 1]`) raises a
   * warning. `0.75` = warn once fairness drops under 75%.
   */
  readonly warningFairnessThreshold: number

  /**
   * Minimum cohort size for fairness to be meaningful. Below it, dimensions are
   * still reported but a `cohort_too_small` warning is raised and no imbalance
   * is flagged.
   */
  readonly minCohortSize: number
}
