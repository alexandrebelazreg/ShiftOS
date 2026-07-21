/**
 * Hard vs soft.
 *
 * - `hard`: must never be violated. A single violation makes a planning
 *   infeasible.
 * - `soft`: a preference. Violations are allowed but penalize the planning's
 *   score (see `scoring/`).
 */
export const CONSTRAINT_TYPES = ["hard", "soft"] as const
export type ConstraintType = (typeof CONSTRAINT_TYPES)[number]
