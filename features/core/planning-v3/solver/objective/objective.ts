/**
 * The lexicographic objective.
 *
 * Solutions are compared as a VECTOR, never as a weighted sum. A weighted sum
 * lets a cheap gain on a low priority pay for a loss on a high one — exactly
 * what "une priorité inférieure ne peut jamais dégrader une priorité
 * supérieure" forbids. With a vector, component `k` is only ever consulted
 * when components `0..k-1` are equal.
 *
 * Components 1–7 are ADDITIVE over days and never negative. That is what makes
 * a partial sum a valid optimistic bound: a branch whose partial vector already
 * loses to the incumbent can never recover, so it is safe to cut. Component 8
 * (fairness) is a spread over the finished week, so it contributes 0 to any
 * bound.
 */

export const OBJECTIVE_COMPONENTS = [
  "blocking-violations",
  "under-covered-slots",
  "deficit-minutes",
  "closing-deficit",
  "excess-closings",
  "avoidable-surplus-minutes",
  "distribution-deviation-minutes",
  "preference-penalty",
  "fairness-spread",
] as const

export type ObjectiveComponent = (typeof OBJECTIVE_COMPONENTS)[number]

/** Index of the last component that day-by-day accumulation can bound. */
export const LAST_ADDITIVE_INDEX = 7

export type ObjectiveVector = number[]

export function emptyObjective(): ObjectiveVector {
  return OBJECTIVE_COMPONENTS.map(() => 0)
}

/** Negative when `left` is strictly better, positive when worse, 0 when equal. */
export function compareObjective(
  left: readonly number[],
  right: readonly number[]
): number {
  for (let index = 0; index < OBJECTIVE_COMPONENTS.length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Compare a partial vector — the additive components accumulated so far, with
 * every unknown component optimistically 0 — against an incumbent.
 *
 * Returns true when the branch can still produce something at least as good,
 * i.e. when cutting it would be unsound.
 */
export function couldStillBeat(
  partial: readonly number[],
  incumbent: readonly number[] | null
): boolean {
  if (incumbent === null) return true
  for (let index = 0; index <= LAST_ADDITIVE_INDEX; index++) {
    const difference = (partial[index] ?? 0) - (incumbent[index] ?? 0)
    if (difference < 0) return true // strictly better on a higher priority
    if (difference > 0) return false // already worse, and it can only grow
  }
  // Every bounded component ties; the tail decides, so the branch stays open.
  return true
}
