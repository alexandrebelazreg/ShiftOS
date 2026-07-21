/**
 * ScoringWeights — the configurable weight of each scoring quality dimension.
 * Relative magnitudes; the scoring engine normalizes them. `hard` is absent by
 * design — it is the feasibility gate, never a weighted term.
 */
export interface ScoringWeights {
  readonly coverage: number
  readonly contract: number
  readonly availability: number
  readonly soft: number
}

/**
 * ScoringSettings — configuration for the scoring engine. Present so a
 * `StoreConfiguration` can drive the scoring policy, even though scoring is not
 * a "store setting" a manager edits directly.
 */
export interface ScoringSettings {
  readonly weights: ScoringWeights
  /** Partial credit for a soft `warning` outcome, in `[0, 1]`. */
  readonly warningCredit: number
  /** Feasible plannings score ≥ this, infeasible ones below it, in `[0, 1]`. */
  readonly feasibilityThreshold: number
}
