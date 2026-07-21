/**
 * The scored dimensions of a planning.
 *
 * - `hard`         — respect of HARD constraints. Acts as a FEASIBILITY GATE:
 *                    it never contributes to the quality blend, it caps it (a
 *                    hard failure can never be hidden by excellent soft scores).
 * - `soft`         — overall satisfaction of SOFT constraints, all categories.
 * - `coverage`     — how well demand is met (from the demand engine).
 * - `contract`     — respect of contractual / workload obligations.
 * - `availability` — respect of employee availability.
 *
 * `hard` and `soft` are cross-cutting views (by constraint TYPE); `coverage`,
 * `contract` and `availability` are category views. They deliberately overlap
 * (a soft contract rule counts in both `soft` and `contract`): each is an
 * independent lens on the same planning, not a partition.
 */
export const SCORE_DIMENSIONS = [
  "hard",
  "soft",
  "coverage",
  "contract",
  "availability",
] as const
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number]

/**
 * The dimensions that participate in the QUALITY blend (weighted average).
 * `hard` is excluded on purpose — it is the feasibility gate, not a weighted
 * quality signal.
 */
export const WEIGHTED_DIMENSIONS = [
  "coverage",
  "contract",
  "availability",
  "soft",
] as const
export type WeightedDimension = (typeof WEIGHTED_DIMENSIONS)[number]

/**
 * Stable codes for score warnings. Open set (`Known | (string & {})`) so future
 * business packs can add their own without touching the engine.
 */
export const SCORE_WARNING_CODES = [
  "infeasible",
  "coverage_gap",
  "missing_capabilities",
  "contract_deviation",
  "availability_conflict",
  "soft_violations",
] as const
export type KnownScoreWarningCode = (typeof SCORE_WARNING_CODES)[number]
export type ScoreWarningCode = KnownScoreWarningCode | (string & {})
