import type { ScoreDimension } from "@/features/core/scoring-engine/types"

/**
 * DimensionScore — the score of ONE dimension plus the tally that produced it,
 * so every number can be explained (a founding Planiteo principle).
 *
 * `score` is normalized to `[0, 1]` (higher is better). `weight` is the share
 * of the quality blend this dimension actually carried, in `[0, 1]` — `0` for
 * the `hard` dimension, which gates the score instead of contributing to it.
 * The `evaluated / passed / warned / failed` counts describe how many items
 * (constraints, or coverage requirements) fed the score.
 */
export interface DimensionScore {
  readonly dimension: ScoreDimension
  readonly score: number
  readonly weight: number
  readonly evaluated: number
  readonly passed: number
  readonly warned: number
  readonly failed: number
}
