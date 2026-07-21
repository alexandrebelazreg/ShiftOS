import type { ConstraintCategory } from "@/features/core/constraint-engine/types"

/**
 * Relative importance of each weighted dimension in the QUALITY blend. Values
 * are arbitrary magnitudes — they are normalized (divided by their sum) at
 * scoring time, so `{ coverage: 2, contract: 1, … }` and `{ coverage: 0.5,
 * contract: 0.25, … }` behave identically. `hard` is intentionally absent: it
 * is the feasibility gate, never a weighted term.
 */
export interface DimensionWeights {
  readonly coverage: number
  readonly contract: number
  readonly availability: number
  readonly soft: number
}

/**
 * Maps each derived category-dimension to the constraint categories that feed
 * it. Configurable so a business pack can, e.g., route `"legal"` constraints
 * into the availability dimension without changing engine code.
 */
export interface DimensionCategoryMap {
  readonly contract: readonly ConstraintCategory[]
  readonly availability: readonly ConstraintCategory[]
}

/**
 * ScoringPolicy — everything the scoring engine needs that is a DECISION rather
 * than a computation. It carries no domain data. The engine reads it; it never
 * hardcodes any of these values.
 *
 * All values are configurable to satisfy two founding rules:
 * - weights must be reconfigurable in the future;
 * - no business value may be hardcoded in the engine.
 */
export interface ScoringPolicy {
  /** Relative weights of the weighted dimensions (normalized at runtime). */
  readonly weights: DimensionWeights

  /**
   * Partial credit granted when a soft constraint returns `warning` (a soft
   * miss), in `[0, 1]`. `1` = a warning costs nothing; `0` = a warning is as
   * bad as a fail.
   */
  readonly warningCredit: number

  /**
   * The pivot that separates feasible from infeasible plannings, in `[0, 1]`.
   * A FEASIBLE planning scores in `[threshold, 1]`; an INFEASIBLE one scores in
   * `[0, threshold)`. This is what guarantees a hard failure can never be
   * hidden by excellent soft scores.
   */
  readonly feasibilityThreshold: number

  /** Which constraint categories feed each derived dimension. */
  readonly dimensionCategories: DimensionCategoryMap
}
