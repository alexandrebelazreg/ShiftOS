/**
 * FairnessWeights — the configurable weight of each shipped fairness dimension.
 * Relative magnitudes; the fairness engine normalizes them.
 */
export interface FairnessWeights {
  readonly workedHours: number
  readonly opening: number
  readonly closing: number
  readonly weekend: number
  /** Weight of preference satisfaction (maps to a `preference` dimension). */
  readonly preferences: number
}

/**
 * FairnessSettings — configuration for the fairness engine.
 *
 * `extraWeights` keeps the model EXTENDABLE: a future dimension (Saturday,
 * Sunday, night, …) is weighted by adding its name here — no change to this
 * interface or the engine is required.
 */
export interface FairnessSettings {
  readonly weights: FairnessWeights
  /** Weights for future / custom dimensions, keyed by dimension name. */
  readonly extraWeights: Readonly<Record<string, number>>
  /** Relative deviation from the mean that flags an imbalance (≥ 0). */
  readonly imbalanceThreshold: number
  /** Fairness below this raises a warning, in `[0, 1]`. */
  readonly warningThreshold: number
  /** Minimum cohort size for fairness to be meaningful. */
  readonly minCohortSize: number
}
