/**
 * Pure numeric helpers for the scoring engine. No business values live here —
 * only deterministic maths. Keeping them isolated makes every calculator
 * trivially testable and guarantees identical results across runs.
 */

/** Clamp a number to `[0, 1]`. `NaN` collapses to `0` (safe default). */
export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/**
 * Round to a fixed number of decimals to strip floating-point noise, so scores
 * are stable and comparable across runs. Default 4 decimals.
 */
export function round(n: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

/**
 * Weighted average of `[value, weight]` pairs. When the total weight is `0`
 * (all weights zero or no entries with weight), falls back to a plain mean so a
 * misconfigured policy still yields a meaningful score instead of `NaN`.
 */
export function weightedAverage(
  entries: readonly (readonly [value: number, weight: number])[]
): number {
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0)
  if (totalWeight > 0) {
    return entries.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight
  }
  if (entries.length === 0) return 0
  return entries.reduce((sum, [value]) => sum + value, 0) / entries.length
}

/** Format a `[0, 1]` share as a whole-percent string, e.g. `0.75 → "75%"`. */
export function toPercent(share: number): string {
  return `${Math.round(clamp01(share) * 100)}%`
}
