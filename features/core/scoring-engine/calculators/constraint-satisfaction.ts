import type { EvaluatedConstraint } from "@/features/core/constraint-engine"

/**
 * The raw counts of a set of evaluated constraints, plus the satisfaction they
 * imply. Shared by every constraint-derived dimension (hard, soft, contract,
 * availability) so the credit rule lives in exactly one place.
 */
export interface SatisfactionTally {
  readonly evaluated: number
  readonly passed: number
  readonly warned: number
  readonly failed: number
  /** Satisfaction in `[0, 1]`: `(passed + warned * warningCredit) / evaluated`. */
  readonly satisfaction: number
}

/**
 * Tally the constraints matching `predicate` and turn them into a satisfaction
 * score. A `pass` earns full credit, a `warning` earns `warningCredit`, a
 * `fail` earns nothing.
 *
 * When NO constraint matches, satisfaction is `1`: there is nothing to violate,
 * so the dimension is (vacuously) perfect. This keeps a planning from being
 * punished for rules that simply do not apply to it.
 */
export function tallySatisfaction(
  constraints: readonly EvaluatedConstraint[],
  predicate: (constraint: EvaluatedConstraint) => boolean,
  warningCredit: number
): SatisfactionTally {
  let passed = 0
  let warned = 0
  let failed = 0

  for (const constraint of constraints) {
    if (!predicate(constraint)) continue
    if (constraint.outcome === "pass") passed += 1
    else if (constraint.outcome === "warning") warned += 1
    else failed += 1
  }

  const evaluated = passed + warned + failed
  const satisfaction =
    evaluated === 0 ? 1 : (passed + warned * warningCredit) / evaluated

  return { evaluated, passed, warned, failed, satisfaction }
}
