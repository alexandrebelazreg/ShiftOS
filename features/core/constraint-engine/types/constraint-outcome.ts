/**
 * The verdict a constraint returns for an evaluation.
 * - `pass`    — the constraint is respected.
 * - `warning` — a SOFT constraint is not fully respected (does not block).
 * - `fail`    — a HARD constraint is violated (blocks feasibility).
 */
export const CONSTRAINT_OUTCOMES = ["pass", "warning", "fail"] as const
export type ConstraintOutcome = (typeof CONSTRAINT_OUTCOMES)[number]
