/**
 * Relative importance of a constraint. Used to order evaluation, break ties and
 * derive violation severity. Ordered from most to least important.
 */
export const CONSTRAINT_PRIORITIES = ["critical", "high", "medium", "low"] as const
export type ConstraintPriority = (typeof CONSTRAINT_PRIORITIES)[number]

/**
 * Severity of a produced violation. Derived (by the future evaluator) from the
 * constraint's `type` and `priority` — e.g. a hard constraint yields
 * `blocking`, a soft one yields `major` / `minor` / `info`.
 */
export const CONSTRAINT_SEVERITIES = ["blocking", "major", "minor", "info"] as const
export type ConstraintSeverity = (typeof CONSTRAINT_SEVERITIES)[number]
