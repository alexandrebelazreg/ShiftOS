import type { DimensionScore } from "@/features/core/scoring-engine/models/DimensionScore"
import type { ScoreDetails } from "@/features/core/scoring-engine/models/ScoreDetails"
import type { ScoreWarning } from "@/features/core/scoring-engine/models/ScoreWarning"

/**
 * PlanningScore — the structured verdict of the scoring engine.
 *
 * Deliberately NOT a single number: a planning's quality is multi-dimensional
 * and must stay explainable. `overall` is the one comparable figure, but it is
 * always accompanied by the breakdown that produced it.
 *
 * Score range and the feasibility guarantee:
 * - `overall` is in `[0, 1]` (higher is better);
 * - a FEASIBLE planning always scores `>= feasibilityThreshold`;
 * - an INFEASIBLE planning always scores `< feasibilityThreshold`.
 *   Therefore a hard-constraint failure can NEVER be hidden by excellent soft
 *   scores — the core rule of this engine.
 */
export interface PlanningScore {
  /** The single comparable figure, in `[0, 1]`. Gated by feasibility. */
  readonly overall: number
  /** `false` as soon as one hard constraint fails. */
  readonly feasible: boolean

  /** Feasibility gate (respect of hard constraints). Caps `overall`. */
  readonly hard: DimensionScore
  /** Overall satisfaction of soft constraints, all categories. */
  readonly soft: DimensionScore
  /** How well demand is met (from the demand engine). */
  readonly coverage: DimensionScore
  /** Respect of contractual / workload obligations. */
  readonly contract: DimensionScore
  /** Respect of employee availability. */
  readonly availability: DimensionScore

  /** Human-readable notes explaining the lost points. */
  readonly warnings: readonly ScoreWarning[]
  /** The full computation trail (weights, tallies, coverage snapshot). */
  readonly details: ScoreDetails
}
