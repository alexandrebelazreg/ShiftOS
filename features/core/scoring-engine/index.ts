/**
 * Scoring Engine — public API.
 *
 * A pure, deterministic, sector-agnostic engine that CONVERTS constraint
 * evaluation and coverage into a comparable `PlanningScore`. It scores
 * plannings; it never generates, optimizes, repairs or persists them, and it
 * touches no UI and no database.
 *
 * Typical use:
 *   const score = scoringEngine.score({ report, coverage })
 *   // or with a custom policy:
 *   const score = scoringEngine.score({ report, coverage }, myPolicy)
 *
 * Inputs come from sibling core engines:
 * - `report`   → `@/features/core/constraint-engine` (ConstraintEvaluationReport)
 * - `coverage` → `@/features/core/demand-engine` (Coverage + CoverageStatistics)
 *
 * Guarantee: a hard-constraint failure can never be hidden by excellent soft
 * scores — feasible plannings score `>= feasibilityThreshold`, infeasible ones
 * score below it.
 */
export * from "@/features/core/scoring-engine/types"
export * from "@/features/core/scoring-engine/models"
export * from "@/features/core/scoring-engine/policies"
export * from "@/features/core/scoring-engine/calculators"
export * from "@/features/core/scoring-engine/utils"
