/**
 * The lexicographic objective of the decomposed engine.
 *
 * A TUPLE, never a weighted sum. A weighted sum lets a cheap gain on a low
 * priority pay for a loss on a high one, which is exactly what "une priorité
 * inférieure ne peut jamais dégrader une priorité supérieure" forbids. With a
 * tuple, component `k` is only ever consulted when `0..k-1` are equal.
 *
 * The components are also kept NAMED and separate rather than compressed into
 * one number as early as possible: a run that reports "objective 8" tells a
 * reader nothing, while "8 under-covered slots, 0 deficit minutes" tells them
 * what to change. `describeObjective` is what the technical panel shows.
 *
 * Components 0–5 are ADDITIVE over days and never negative, which is what makes
 * a partial sum a sound optimistic bound: a branch whose partial tuple already
 * loses to the incumbent can never recover, so cutting it is safe. Components
 * 6–8 are spreads or shapes over the FINISHED week, so they contribute 0 to any
 * bound and are only compared on complete solutions.
 */

export const DECOMPOSED_OBJECTIVE_COMPONENTS = [
  /** Hard-rule breaches. The engine never emits a solution with a non-zero value here. */
  "hard-violations",
  /** Demand slots whose soft target is missed. */
  "soft-under-covered-slots",
  /** Employee-minutes short of the soft targets, summed atomically. */
  "deficit-minutes",
  /** Weighted business cost: avoidable surplus, in minutes. */
  "avoidable-surplus-minutes",
  /** Preservations asked for and not delivered. Always 0 until the engine supports them. */
  "unmet-preservations",
  /** How far each employee's day lands from its allocated target, in minutes. */
  "individual-deviation-minutes",
  /** Spread between the busiest and quietest opener/closer. */
  "opening-closing-fairness",
  /** Distance from a previous schedule. Always 0 until the engine supports stability. */
  "instability",
  /** Tie-breaker: prefer plain hours — fewer splits, rounder start times. */
  "schedule-complexity",
] as const

export type DecomposedObjectiveComponent = (typeof DECOMPOSED_OBJECTIVE_COMPONENTS)[number]

/** Index of the last component a day-by-day accumulation may bound. */
export const LAST_ADDITIVE_INDEX = 5

export type DecomposedObjective = number[]

export function emptyObjective(): DecomposedObjective {
  return DECOMPOSED_OBJECTIVE_COMPONENTS.map(() => 0)
}

/** Negative when `left` is strictly better, positive when worse, 0 when equal. */
export function compareObjective(
  left: readonly number[],
  right: readonly number[]
): number {
  for (let index = 0; index < DECOMPOSED_OBJECTIVE_COMPONENTS.length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Can a branch whose additive components are `partial` still reach or beat the
 * incumbent?
 *
 * Returns true when cutting would be unsound. Only the additive prefix is
 * consulted: the tail is optimistically zero, which is exactly what makes the
 * bound safe rather than merely plausible.
 */
export function couldStillBeat(
  partial: readonly number[],
  incumbent: readonly number[] | null
): boolean {
  if (incumbent === null) return true
  for (let index = 0; index <= LAST_ADDITIVE_INDEX; index++) {
    const difference = (partial[index] ?? 0) - (incumbent[index] ?? 0)
    if (difference < 0) return true
    if (difference > 0) return false
  }
  return true
}

/** The objective as label/value pairs, for the technical panel and the report. */
export function describeObjective(
  objective: readonly number[]
): readonly { readonly label: string; readonly value: number }[] {
  return DECOMPOSED_OBJECTIVE_COMPONENTS.map((label, index) => ({
    label,
    value: objective[index] ?? 0,
  }))
}
