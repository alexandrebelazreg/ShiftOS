/**
 * Pure statistics for measuring how (un)equally a quantity is distributed across
 * a cohort. The fairness measure lives HERE and nowhere else, so every
 * dimension is scored the same way and a new dimension only has to provide the
 * per-employee value — never its own maths.
 */

/** Clamp a number to `[0, 1]`. `NaN` collapses to `0`. */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/** Round to a fixed number of decimals to strip floating-point noise. */
export function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

/** Format a `[0, 1]` share as a whole-percent string, e.g. `0.75 → "75%"`. */
export function toPercentLabel(share: number): string {
  return `${Math.round(clamp01(share) * 100)}%`
}

/** Basic descriptive stats over a set of values. */
export interface DistributionStats {
  readonly count: number
  readonly total: number
  readonly mean: number
  readonly min: number
  readonly max: number
}

export function describe(values: readonly number[]): DistributionStats {
  const count = values.length
  if (count === 0) {
    return { count: 0, total: 0, mean: 0, min: 0, max: 0 }
  }
  let total = 0
  let min = values[0]
  let max = values[0]
  for (const v of values) {
    total += v
    if (v < min) min = v
    if (v > max) max = v
  }
  return { count, total, mean: total / count, min, max }
}

/**
 * Gini coefficient of a distribution, in `[0, 1]`.
 * - `0` = perfect equality (everyone equal, or everyone at zero).
 * - `1` = maximal inequality (one person holds everything).
 *
 * Deterministic (values are sorted ascending first). For a single member the
 * result is `0` (a lone member cannot be treated unequally). Assumes
 * non-negative values (counts, minutes); the result is clamped to `[0, 1]` for
 * safety.
 */
export function gini(values: readonly number[]): number {
  const n = values.length
  if (n <= 1) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const total = sorted.reduce((sum, v) => sum + v, 0)
  if (total === 0) return 0 // everyone at zero → perfectly equal

  let weighted = 0
  for (let i = 0; i < n; i += 1) {
    weighted += (i + 1) * sorted[i]
  }
  const g = (2 * weighted) / (n * total) - (n + 1) / n
  return clamp01(g)
}

/**
 * Fairness of a distribution, in `[0, 1]` — simply `1 - gini`. `1` is perfectly
 * fair. This is the canonical conversion used by every dimension.
 */
export function fairnessOf(values: readonly number[]): number {
  return clamp01(1 - gini(values))
}
